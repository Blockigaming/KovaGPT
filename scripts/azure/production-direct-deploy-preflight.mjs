#!/usr/bin/env node
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { permissionAllows } from "./production-api-operator.mjs";
import { TARGET } from "./provision-owned-auth.mjs";

const APP = "kovagpt-prod-web";
const ARM = "https://management.azure.com";
const API_VERSION = "2025-07-01";
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const IMAGE =
  /^[a-z0-9][a-z0-9.-]*\.azurecr\.io\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u;
const APP_QUERY =
  "{id:id,name:name,type:type,runningStatus:properties.runningStatus,latestRevisionName:properties.latestRevisionName,latestReadyRevisionName:properties.latestReadyRevisionName,mode:properties.configuration.activeRevisionsMode,ingress:properties.configuration.ingress.{fqdn:fqdn,external:external,allowInsecure:allowInsecure,targetPort:targetPort,additionalPortMappings:additionalPortMappings,traffic:traffic},containers:properties.template.containers[].{name:name,image:image,env:env},secrets:properties.configuration.secrets[].{name:name,keyVaultUrl:keyVaultUrl,identity:identity}}";
const REVISION_QUERY =
  "{id:id,name:name,active:properties.active,healthState:properties.healthState,runningState:properties.runningState,containers:properties.template.containers[].{name:name,image:image}}";
const MAX_BYTES = 512 * 1024;
const targetId = `/subscriptions/${TARGET.subscription}/resourceGroups/${TARGET.group}/providers/Microsoft.App/containerApps/${APP}`;

function valid(condition, code) {
  if (!condition) throw new Error(`direct_preflight_${code}`);
}

export function validateDirectPreflightInput(input) {
  valid(input?.repository === "Blockigaming/KovaGPT", "repository_invalid");
  valid(input.ref === "refs/heads/main" && input.event === "workflow_dispatch", "dispatch_invalid");
  valid(SHA.test(input.sourceSha ?? "") && input.sourceSha === input.workflowSha, "source_invalid");
  valid(input.confirmation === "PREFLIGHT_DIRECT_AZURE", "confirmation_invalid");
  valid(SHA.test(input.currentSha ?? ""), "current_sha_invalid");
  valid(IMAGE.test(input.currentImage ?? ""), "current_image_invalid");
  valid(
    input.currentImage.startsWith(`${input.acrLoginServer}/${input.imageRepository}@sha256:`) &&
      /^[a-z0-9][a-z0-9.-]*\.azurecr\.io$/u.test(input.acrLoginServer ?? "") &&
      /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u.test(input.imageRepository ?? ""),
    "registry_invalid",
  );
  let origin;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new Error("direct_preflight_origin_invalid");
  }
  valid(
    origin.protocol === "https:" &&
      origin.origin === input.origin &&
      !origin.username &&
      !origin.password &&
      !origin.port &&
      /^kovagpt-prod-web\.[a-z0-9-]+\.eastus\.azurecontainerapps\.io$/u.test(origin.hostname),
    "origin_invalid",
  );
  return { ...input, originHost: origin.hostname };
}

// Parse only the subject of an ARM token from this already authenticated CLI
// session. This does not independently verify the token's signature or approve
// any role assignment. The credential itself must never leave process memory.
export function identifyArmPrincipalObjectId(value, azureClientId, now = Date.now()) {
  valid(UUID.test(azureClientId ?? ""), "azure_client_id_invalid");
  valid(
    value?.tokenType === "Bearer" &&
      value.subscription?.toLowerCase() === TARGET.subscription &&
      value.tenant?.toLowerCase() === TARGET.tenant &&
      typeof value.accessToken === "string" &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value.accessToken),
    "principal_token_invalid",
  );
  let claims;
  try {
    claims = JSON.parse(Buffer.from(value.accessToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("direct_preflight_principal_claims_invalid");
  }
  const clientIds = [claims?.appid, claims?.azp].filter((id) => id !== undefined);
  valid(
    UUID.test(claims?.oid ?? "") &&
      claims.oid.toLowerCase() !== "00000000-0000-0000-0000-000000000000" &&
      claims.tid?.toLowerCase() === TARGET.tenant &&
      [ARM, `${ARM}/`].includes(claims.aud) &&
      clientIds.length > 0 &&
      clientIds.every(
        (id) => typeof id === "string" && id.toLowerCase() === azureClientId.toLowerCase(),
      ) &&
      (claims.idtyp === undefined || claims.idtyp === "app") &&
      claims.scp === undefined &&
      Number.isInteger(claims.exp) &&
      Number.isFinite(now) &&
      claims.exp * 1000 > now + 60_000 &&
      claims.exp * 1000 <= now + 2 * 60 * 60_000,
    "principal_claims_invalid",
  );
  return claims.oid.toLowerCase();
}

// Azure CLI output is captured in memory. Neither stdout nor stderr is copied to
// GitHub logs or the receipt; app metadata can contain private env values.
export function createDirectPreflightRunner({ execute = execFile } = {}) {
  return (args) =>
    new Promise((resolve) => {
      execute(
        "az",
        [...args, "--only-show-errors", "--output", "json"],
        {
          encoding: "utf8",
          timeout: 20_000,
          killSignal: "SIGKILL",
          maxBuffer: MAX_BYTES,
          windowsHide: true,
          env: {
            ...process.env,
            AZURE_CORE_ONLY_SHOW_ERRORS: "true",
            AZURE_CORE_COLLECT_TELEMETRY: "false",
            AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
            AZURE_CORE_DISABLE_CONFIRM_PROMPT: "true",
          },
        },
        (error, stdout) => resolve({ ok: !error, stdout: error ? "" : stdout }),
      );
    });
}

function safeCode(error) {
  return /^direct_preflight_[a-z_]+$/u.test(error?.message ?? "")
    ? error.message
    : "direct_preflight_read_failed";
}

function singleEnv(container, name) {
  const found = container?.env?.filter((entry) => entry?.name === name);
  return found?.length === 1 ? found[0] : null;
}

export function validateDirectApp(app, input) {
  valid(
    app?.id?.toLowerCase() === targetId.toLowerCase() &&
      app.name === APP &&
      app.type?.toLowerCase() === "microsoft.app/containerapps",
    "target_mismatch",
  );
  valid(app.runningStatus === "Running", "app_not_running");
  valid(app.mode === "Multiple", "rollback_mode_not_multiple");
  valid(
    app.ingress?.external === true &&
      app.ingress?.allowInsecure === false &&
      app.ingress?.targetPort === 3000 &&
      app.ingress?.fqdn === input.originHost &&
      (!app.ingress.additionalPortMappings || app.ingress.additionalPortMappings.length === 0),
    "direct_ingress_mismatch",
  );
  valid(
    Array.isArray(app.containers) &&
      app.containers.length === 1 &&
      app.containers[0]?.name === "web" &&
      app.containers[0].image === input.currentImage,
    "current_image_mismatch",
  );
  const container = app.containers[0];
  for (const [name, value] of [
    ["AZURE_ENVIRONMENT", "production"],
    ["KOVA_PRODUCTION_ORIGIN_MODE", "azure-direct"],
    ["KOVA_AZURE_PUBLIC_ORIGIN", input.origin],
  ]) {
    const item = singleEnv(container, name);
    valid(item?.value === value && !item.secretRef, "direct_environment_mismatch");
  }
  // Provider values remain secret references, never plain environment values.
  for (const [name, secretName] of [
    ["OPENAI_API_KEY", "openai-api-key"],
    ["ELEVENLABS_API_KEY", "elevenlabs-api-key"],
  ]) {
    const item = singleEnv(container, name);
    const refs = app.secrets?.filter((entry) => entry?.name === secretName);
    valid(
      item?.secretRef === secretName &&
        !item.value &&
        refs?.length === 1 &&
        /^https:\/\/[a-zA-Z0-9-]{3,24}\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]{1,127}\/[a-fA-F0-9]{32}$/u.test(
          refs[0].keyVaultUrl ?? "",
        ) &&
        typeof refs[0].identity === "string" &&
        refs[0].identity.length > 0,
      "provider_reference_mismatch",
    );
  }
  const revisionName = app.latestRevisionName;
  valid(
    typeof revisionName === "string" &&
      revisionName.startsWith(`${APP}--`) &&
      revisionName === app.latestReadyRevisionName,
    "revision_not_ready",
  );
  const traffic = app.ingress.traffic;
  valid(
    Array.isArray(traffic) &&
      traffic.length > 0 &&
      traffic.every((entry) => Number.isInteger(entry?.weight) && entry.weight >= 0) &&
      traffic.reduce((sum, entry) => sum + entry.weight, 0) === 100 &&
      traffic.filter((entry) => entry.weight > 0).length === 1 &&
      traffic.some((entry) => entry.revisionName === revisionName && entry.weight === 100),
    "rollback_traffic_mismatch",
  );
  return revisionName;
}

export function validateDirectRevision(revision, input, revisionName) {
  valid(
    revision?.id?.toLowerCase() === `${targetId}/revisions/${revisionName}`.toLowerCase() &&
      revision.name === revisionName &&
      revision.active === true &&
      revision.healthState === "Healthy" &&
      revision.runningState === "Running" &&
      Array.isArray(revision.containers) &&
      revision.containers.length === 1 &&
      revision.containers[0]?.name === "web" &&
      revision.containers[0].image === input.currentImage,
    "rollback_revision_unhealthy",
  );
}

async function getJson(fetcher, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    valid(response.status === 200, "public_status_invalid");
    valid(
      /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""),
      "public_content_invalid",
    );
    valid(
      /(?:^|,)\s*no-store(?:\s*,|$)/iu.test(response.headers.get("cache-control") ?? ""),
      "public_cache_invalid",
    );
    valid(response.body, "public_response_invalid");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        valid(bytes <= 64 * 1024, "public_response_too_large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("direct_preflight_public_response_invalid");
    }
    return { body, build: response.headers.get("x-kova-build") };
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightDirectAzureRelease(
  rawInput,
  { run = createDirectPreflightRunner(), fetcher = fetch } = {},
) {
  const input = validateDirectPreflightInput(rawInput);
  const receipt = {
    version: 1,
    sourceSha: input.sourceSha,
    targetId,
    currentImage: input.currentImage,
    currentSha: input.currentSha,
    origin: input.origin,
    status: "BLOCKED",
    rollbackRevision: null,
    principalObjectId: null,
    principalDiagnosticCode: null,
    checks: {
      account: false,
      principalIdentity: false,
      effectiveWrite: false,
      targetAndConfig: false,
      rollbackRevision: false,
      publicBuild: false,
      stableTarget: false,
    },
    azureMutations: 0,
    providerRequests: 0,
    liveAuthVerified: false,
    providerGenerationVerified: false,
    failureCode: null,
    failureCodes: [],
  };
  const recordFailure = (error) => {
    const code = safeCode(error);
    receipt.failureCode ??= code;
    receipt.failureCodes.push(code);
  };
  const checkIndependently = async (check) => {
    try {
      await check();
    } catch (error) {
      recordFailure(error);
    }
  };
  const arm = async (path, apiVersion, query, exactUrl = "", readFailure = "azure_read_failed") => {
    const result = await run([
      "rest",
      "--method",
      "get",
      "--url",
      exactUrl || `${ARM}${path}?api-version=${apiVersion}`,
      "--subscription",
      TARGET.subscription,
      ...(query ? ["--query", query] : []),
    ]);
    valid(result?.ok === true && typeof result.stdout === "string", readFailure);
    valid(Buffer.byteLength(result.stdout) <= MAX_BYTES, "azure_response_too_large");
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("direct_preflight_azure_response_invalid");
    }
  };
  // The Azure account boundary must hold before reading any resource metadata.
  try {
    const account = await run(["account", "show", "--query", "{id:id,tenantId:tenantId}"]);
    valid(account?.ok === true, "azure_read_failed");
    let identity;
    try {
      identity = JSON.parse(account.stdout);
    } catch {
      throw new Error("direct_preflight_azure_response_invalid");
    }
    valid(
      identity.id?.toLowerCase() === TARGET.subscription &&
        identity.tenantId?.toLowerCase() === TARGET.tenant,
      "azure_account_mismatch",
    );
    receipt.checks.account = true;
  } catch (error) {
    recordFailure(error);
    return receipt;
  }

  // The Azure CLI rejects --subscription and --tenant together. The account
  // was already fenced to both values above; the token claims are checked too.
  try {
    valid(UUID.test(input.azureClientId ?? ""), "azure_client_id_invalid");
    const result = await run([
      "account",
      "get-access-token",
      "--subscription",
      TARGET.subscription,
      "--resource",
      `${ARM}/`,
    ]);
    valid(result?.ok === true && typeof result.stdout === "string", "principal_token_unavailable");
    let token;
    try {
      token = JSON.parse(result.stdout);
    } catch {
      throw new Error("direct_preflight_principal_token_invalid");
    }
    receipt.principalObjectId = identifyArmPrincipalObjectId(token, input.azureClientId);
    receipt.checks.principalIdentity = true;
  } catch (error) {
    // Identity enrichment supports an independently reviewed role proposal.
    // Its absence does not change the release readiness result.
    receipt.principalDiagnosticCode = safeCode(error);
  }

  // A missing write role must not hide independent read-only app, rollback or
  // public-build findings. Every check below remains incapable of mutation.
  await checkIndependently(async () => {
    const permissionPath = `${targetId}/providers/Microsoft.Authorization/permissions`;
    const permissionBase = `${ARM}${permissionPath}?api-version=2022-04-01`;
    let next = permissionBase;
    const permissions = [];
    for (let i = 0; i < 5 && next; i++) {
      const page = await arm(permissionPath, "2022-04-01", "", next, "permission_read_failed");
      valid(Array.isArray(page?.value), "permissions_invalid");
      permissions.push(...page.value);
      next = page.nextLink ?? null;
      valid(
        !next ||
          (new URL(next).origin === ARM &&
            new URL(next).pathname.toLowerCase() === permissionPath.toLowerCase()),
        "permissions_page_invalid",
      );
    }
    valid(!next, "permissions_page_limit");
    valid(
      permissionAllows(permissions, "Microsoft.App/containerApps/write"),
      "app_write_permission_missing",
    );
    receipt.checks.effectiveWrite = true;
  });

  let app;
  let revisionName;
  await checkIndependently(async () => {
    app = await arm(targetId, API_VERSION, APP_QUERY, "", "app_read_failed");
    revisionName = validateDirectApp(app, input);
    receipt.rollbackRevision = revisionName;
    receipt.checks.targetAndConfig = true;
  });
  if (revisionName)
    await checkIndependently(async () => {
      const revision = await arm(
        `${targetId}/revisions/${revisionName}`,
        API_VERSION,
        REVISION_QUERY,
        "",
        "revision_read_failed",
      );
      validateDirectRevision(revision, input, revisionName);
      receipt.checks.rollbackRevision = true;
    });

  await checkIndependently(async () => {
    const health = await getJson(fetcher, `${input.origin}/api/health`);
    const version = await getJson(fetcher, `${input.origin}/api/version`);
    valid(
      health.body?.ok === true &&
        health.body.app === "KovaGPT" &&
        health.body.status === "ok" &&
        health.body.service === "kovagpt-web" &&
        health.body.build === input.currentSha &&
        version.body?.sha === input.currentSha &&
        version.build === input.currentSha,
      "public_build_mismatch",
    );
    receipt.checks.publicBuild = true;
  });

  if (app)
    await checkIndependently(async () => {
      const stable = await arm(targetId, API_VERSION, APP_QUERY, "", "app_reread_failed");
      valid(JSON.stringify(stable) === JSON.stringify(app), "target_changed_during_preflight");
      receipt.checks.stableTarget = true;
    });
  if (receipt.failureCodes.length === 0) receipt.status = "READY_FOR_SEPARATE_DEPLOY_REVIEW";
  return receipt;
}

export async function directPreflightMain(args = process.argv.slice(2), env = process.env) {
  valid(args.length === 1 && args[0] === "--check", "explicit_check_required");
  const receipt = await preflightDirectAzureRelease({
    repository: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    workflowSha: env.GITHUB_SHA,
    sourceSha: env.KOVA_PREFLIGHT_SOURCE_SHA,
    confirmation: env.KOVA_PREFLIGHT_CONFIRMATION,
    currentSha: env.KOVA_PREFLIGHT_CURRENT_SHA,
    currentImage: env.KOVA_PREFLIGHT_CURRENT_IMAGE,
    acrLoginServer: env.KOVA_PRODUCTION_ACR_LOGIN_SERVER,
    imageRepository: env.KOVA_PRODUCTION_IMAGE_REPOSITORY,
    azureClientId: env.KOVA_PREFLIGHT_AZURE_CLIENT_ID,
    origin: env.KOVA_PREFLIGHT_ORIGIN,
  });
  console.log(JSON.stringify(receipt));
  return receipt.status === "READY_FOR_SEPARATE_DEPLOY_REVIEW" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  directPreflightMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(safeCode(error));
      process.exitCode = 1;
    });
}
