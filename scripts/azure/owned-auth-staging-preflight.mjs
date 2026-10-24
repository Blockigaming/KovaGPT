import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = "ca-kovagpt-staging";
const GROUP = "rg-kovagpt-staging";
const SHA = /^[a-f0-9]{40}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const fail = (code) => {
  throw new Error(`kova_auth_staging_${code}`);
};
const exactOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
};

// Pure validation of an existing app snapshot and extracted image provenance.
// Never queries Azure, resolves a secret, creates resources, or grants deployment authority.
export function validateOwnedAuthStagingConfiguration({
  app,
  subscriptionId,
  sourceSha,
  sourceTree,
  imageReference,
  publicOrigin,
  browserProvenance,
}) {
  if (!UUID.test(subscriptionId ?? "") || !SHA.test(sourceSha ?? "") || !SHA.test(sourceTree ?? ""))
    fail("identity_inputs");
  const id = `/subscriptions/${subscriptionId}/resourceGroups/${GROUP}/providers/Microsoft.App/containerApps/${APP}`;
  if (
    app?.name !== APP ||
    typeof app.type !== "string" ||
    app.type.toLowerCase() !== "microsoft.app/containerapps" ||
    typeof app.id !== "string" ||
    app.id.toLowerCase() !== id.toLowerCase()
  )
    fail("target");
  if (!exactOrigin(publicOrigin)) fail("origin");
  const host = new URL(publicOrigin).hostname;
  const ingress = app.properties?.configuration?.ingress;
  if (
    ingress?.allowInsecure !== false ||
    (ingress.fqdn !== host &&
      !(
        Array.isArray(ingress.customDomains) &&
        ingress.customDomains.some((entry) => entry?.name === host)
      ))
  )
    fail("ingress");
  if (
    !/^[-a-z0-9.]+\.azurecr\.io\/[a-z0-9][a-z0-9/_.-]*@sha256:[a-f0-9]{64}$/u.test(
      imageReference ?? "",
    )
  )
    fail("immutable_image");
  const containers = app.properties?.template?.containers;
  if (
    !Array.isArray(containers) ||
    containers.length !== 1 ||
    containers[0]?.image !== imageReference
  )
    fail("container_image");
  const environment = containers[0].env;
  if (
    !Array.isArray(environment) ||
    environment.some((entry) => !entry || typeof entry.name !== "string") ||
    new Set(environment.map((entry) => entry.name)).size !== environment.length
  )
    fail("environment");
  const env = new Map(environment.map((entry) => [entry.name, entry]));
  const value = (name) => env.get(name)?.value;
  if (value("AZURE_ENVIRONMENT") !== "staging" || value("KOVA_AUTH_MODE") !== "kova")
    fail("runtime_mode");
  if (
    value("KOVA_AUTH_PUBLIC_ORIGIN") !== publicOrigin ||
    value("KOVA_AUTH_ORIGIN") !== publicOrigin
  )
    fail("runtime_origin");
  if (value("AI_GENERATION_ENABLED") !== "false" || value("KOVA_GENERATION_DISABLED") !== "true")
    fail("generation_enabled");
  if (value("KOVA_EMAIL_QUEUE_ENABLED") !== "true") fail("email_queue");
  for (const name of ["KOVA_AUTH_ENCRYPTION_KEY_SHA256", "KOVA_AUTH_JWT_PUBLIC_KEY_SHA256"])
    if (!HEX.test(value(name) ?? "")) fail("key_fingerprints");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(value("KOVA_AUTH_JWT_KEY_ID") ?? "")) fail("signing_key_id");
  try {
    const issuer = value("KOVA_AUTH_ISSUER");
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      url.href !== issuer ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      fail("issuer");
  } catch {
    fail("issuer");
  }
  const secrets = app.properties?.configuration?.secrets;
  if (!Array.isArray(secrets)) fail("secret_references");
  const secretNames = new Set(secrets.map((entry) => entry?.name));
  for (const name of [
    "KOVA_AUTH_ENCRYPTION_KEY",
    "KOVA_AUTH_JWT_PRIVATE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const entry = env.get(name);
    if (!entry?.secretRef || Object.hasOwn(entry, "value") || !secretNames.has(entry.secretRef))
      fail(`secret_reference_${name.toLowerCase()}`);
  }
  if (
    browserProvenance?.verification !== "verified-build-time-browser-config" ||
    !["git-archive", "acr-git"].includes(browserProvenance.sourceContext) ||
    browserProvenance.sourceSha !== sourceSha ||
    browserProvenance.sourceTree !== sourceTree ||
    browserProvenance.authMode !== "kova" ||
    !HEX.test(browserProvenance.browserBundleSha256 ?? "")
  )
    fail("compiled_browser_mode");
  return {
    targetId: id,
    sourceSha,
    sourceTree,
    imageReference,
    authMode: "kova",
    publicOrigin,
    secretReferencesPresent: true,
    activationVerified: false,
  };
}

// This only checks the reviewed authorization's binding and numeric bounds.
// Original owner approval, current price evidence, and the stop safeguard must
// still be independently inspected; a JSON declaration is not authorization.
export function validateOwnedAuthStagingAuthorization({
  approval,
  configuration,
  now = Date.now(),
}) {
  if (
    !configuration ||
    approval?.environment !== "staging" ||
    approval?.targetId !== configuration.targetId ||
    approval?.sourceSha !== configuration.sourceSha ||
    approval?.imageReference !== configuration.imageReference ||
    approval?.deployAuthorized !== true ||
    approval?.attempts !== 1
  )
    fail("deployment_authorization");
  if (
    !/^[A-Z]{3}$/u.test(approval.currency ?? "") ||
    !Number.isSafeInteger(approval.maximumCostMinor) ||
    approval.maximumCostMinor < 0 ||
    !Number.isSafeInteger(approval.quotedMaximumCostMinor) ||
    approval.quotedMaximumCostMinor < 0 ||
    approval.quotedMaximumCostMinor > approval.maximumCostMinor
  )
    fail("spending_limit");
  const stopAt = Date.parse(approval.stopAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(stopAt) ||
    stopAt <= now ||
    approval.stopSafeguardVerified !== true
  )
    fail("stop_safeguard");
  return { authorizedTarget: APP, attempts: 1, boundedAuthorization: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) fail("arguments");
    const packet = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const configuration = validateOwnedAuthStagingConfiguration(packet);
    validateOwnedAuthStagingAuthorization({ approval: packet.approval, configuration });
    console.log("KOVA_AUTH_STAGING_PREFLIGHT=PASS");
  } catch (error) {
    console.error(
      error instanceof Error && /^kova_auth_staging_[a-z0-9_]+$/u.test(error.message)
        ? error.message
        : "kova_auth_staging_invalid_packet",
    );
    process.exitCode = 1;
  }
}
