import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyContainerProvenance } from "./ci-container-evidence.mjs";
import { validateProductionProvenanceEvidence } from "./production-provenance-audit.mjs";
import {
  acceptanceDigest,
  createGenerationAcceptanceGuard,
} from "../../src/lib/generation-acceptance.server.mjs";

export function generationConfigurationDigest(e) {
  return acceptanceDigest({
    targetId: e.app.id,
    sourceSha: e.sourceSha,
    sourceTree: e.sourceTree,
    imageReference: e.imageReference,
    revision: e.app.properties.latestRevisionName,
    publicOrigin: e.publicOrigin,
    authMode: e.browserProvenance.authMode,
    providerBindings: e.providerBindings,
  });
}

const SHA = /^[a-f0-9]{40}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const IMAGE = /^[-a-z0-9.]+\.azurecr\.io\/[a-z0-9][a-z0-9/_.-]*@sha256:[a-f0-9]{64}$/u;
const fail = (code) => {
  throw new Error(`generation_staging_${code}`);
};

// Pure evidence validation. No cloud calls, secret resolution, image build,
// deployment or generation. Evidence authenticity and original authorization
// must be established by the operator; valid-shaped JSON is not authorization.
export function qualifyGenerationStaging(evidence, { sourceSha, sourceTree, now = Date.now() }) {
  if (!SHA.test(sourceSha ?? "") || !SHA.test(sourceTree ?? "")) fail("source_inputs");
  const e = evidence;
  if (!e || e.sourceSha !== sourceSha || e.sourceTree !== sourceTree) fail("source_mismatch");
  const collected = Date.parse(e.collectedAt);
  if (!Number.isFinite(collected) || collected > now || now - collected > 600_000)
    fail("stale_evidence");
  const app = e.app;
  if (
    app?.name !== "ca-kovagpt-staging" ||
    !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/rg-kovagpt-staging\/providers\/Microsoft.App\/containerApps\/ca-kovagpt-staging$/iu.test(
      app?.id ?? "",
    )
  )
    fail("target");
  if (!IMAGE.test(e.imageReference ?? "")) fail("immutable_image");
  const digest = e.imageReference.split("@")[1];
  if (e.registryManifestDigest !== digest || !e.image?.RepoDigests?.includes(e.imageReference))
    fail("manifest_binding");
  try {
    verifyContainerProvenance(e.image, sourceSha, sourceTree);
  } catch {
    fail("image_source_labels");
  }
  if (
    e.image.Os !== "linux" ||
    e.image.Architecture !== "amd64" ||
    e.image.Config.Labels["com.kovagpt.browser.config-verified"] !== "true"
  )
    fail("image_platform_or_browser");
  const b = e.browserProvenance;
  if (
    b?.verification !== "verified-build-time-browser-config" ||
    !["git-archive", "acr-git"].includes(b.sourceContext) ||
    b.sourceSha !== sourceSha ||
    b.sourceTree !== sourceTree ||
    !HEX.test(b.browserBundleSha256 ?? "") ||
    !["supabase", "kova"].includes(b.authMode)
  )
    fail("browser_provenance");
  const properties = app.properties;
  const containers = properties?.template?.containers;
  if (
    !Array.isArray(containers) ||
    containers.length !== 1 ||
    containers[0].image !== e.imageReference
  )
    fail("container");
  if (
    containers[0].resources?.cpu !== 0.5 ||
    containers[0].resources?.memory !== "1Gi" ||
    properties.template.scale?.minReplicas !== 0 ||
    properties.template.scale?.maxReplicas !== 1
  )
    fail("scale");
  const ingress = properties.configuration?.ingress;
  if (
    ingress?.allowInsecure !== false ||
    !ingress.fqdn ||
    e.publicOrigin !== `https://${ingress.fqdn}`
  )
    fail("origin");
  const runtime = new Map();
  for (const item of containers[0].env ?? []) {
    if (!item || typeof item.name !== "string" || runtime.has(item.name))
      fail("duplicate_runtime_binding");
    runtime.set(item.name, item);
  }
  const value = (name) => runtime.get(name)?.value;
  if (
    value("AZURE_ENVIRONMENT") !== "staging" ||
    value("KOVA_AUTH_MODE") !== b.authMode ||
    value("KOVA_GENERATION_DISABLED") !== "false" ||
    value("AI_GENERATION_ENABLED") !== "true" ||
    value("KOVA_SPEECH_ENABLED") !== "true" ||
    value("KOVA_GENERATION_ACCEPTANCE_ENABLED") !== "true" ||
    value("KOVA_DEPLOYMENT_TARGET") !== "ca-kovagpt-staging" ||
    value("KOVA_SOURCE_TREE") !== sourceTree ||
    value("KOVA_IMAGE_DIGEST") !== digest ||
    value("CONTAINER_APP_REVISION") !== properties.latestRevisionName ||
    value("KOVA_TEXT_PROVIDER") !== "openai"
  )
    fail("runtime_mode");
  const p = e.providerBindings;
  if (
    !p ||
    p.textProvider !== "openai" ||
    p.modelId !== "gpt-5.6-luna" ||
    !/^[A-Za-z0-9_-]{1,80}$/u.test(p.voiceId ?? "") ||
    value("KOVA_INSTANT_MODEL") !== p.modelId ||
    value("KOVA_MODEL_DEFAULT_CHAT") !== p.modelId ||
    value("ELEVENLABS_VOICE_ID") !== p.voiceId ||
    p.speechModelId !== "eleven_multilingual_v2"
  )
    fail("provider_binding");
  const secretNames = new Set((properties.configuration.secrets ?? []).map((item) => item?.name));
  for (const name of [
    "OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
    "KOVA_IP_HASH_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const item = runtime.get(name);
    if (!item?.secretRef || Object.hasOwn(item, "value") || !secretNames.has(item.secretRef))
      fail("provider_secret_reference");
  }
  if (
    !HEX.test(p.privateUsabilityEvidenceSha256 ?? "") ||
    !HEX.test(p.voiceAndEntitlementEvidenceSha256 ?? "") ||
    !HEX.test(p.exactPricingEvidenceSha256 ?? "") ||
    !HEX.test(e.acceptancePlanSha256 ?? "") ||
    !HEX.test(e.generationApprovalReceiptSha256 ?? "")
  )
    fail("provider_or_approval_evidence");
  if (
    value("KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256") !== e.acceptancePlanSha256 ||
    value("KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256") !== e.generationApprovalReceiptSha256
  )
    fail("acceptance_pin");
  try {
    const plan = JSON.parse(value("KOVA_GENERATION_ACCEPTANCE_PLAN") ?? "");
    const approvalReceipt = JSON.parse(value("KOVA_GENERATION_ACCEPTANCE_APPROVAL") ?? "");
    if (
      plan.target.commit !== sourceSha ||
      plan.target.tree !== sourceTree ||
      plan.target.imageDigest !== digest ||
      plan.target.revision !== properties.latestRevisionName ||
      plan.target.configurationEvidenceSha256 !== generationConfigurationDigest(e) ||
      plan.openAI.model !== p.modelId ||
      plan.speech.voiceId !== p.voiceId ||
      plan.quote.pricingEvidenceSha256 !== p.exactPricingEvidenceSha256
    )
      fail("acceptance_plan");
    createGenerationAcceptanceGuard({
      getConfig: () => ({
        enabled: true,
        plan,
        approvalReceipt,
        expectedPlanSha256: e.acceptancePlanSha256,
        expectedApprovalReceiptSha256: e.generationApprovalReceiptSha256,
      }),
      claim: () => {
        throw new Error("No claims permitted during offline qualification");
      },
      now: () => now,
    }).run(
      { ownerId: plan.ownerId, chatId: plan.chatId, operationId: plan.operationId },
      () => true,
    );
  } catch {
    fail("acceptance_plan");
  }
  if (
    e.ci?.sourceSha !== sourceSha ||
    e.ci.sourceTree !== sourceTree ||
    e.ci.requiredChecksPassed !== true ||
    !HEX.test(e.ci.evidenceSha256 ?? "")
  )
    fail("exact_source_ci");
  if (
    !Array.isArray(e.revisions) ||
    e.revisions.filter((r) => r.active).length !== 1 ||
    e.revisions.some((r) => r.traffic > 0 && r.healthState !== "Healthy")
  )
    fail("healthy_revision");
  let running;
  try {
    running = validateProductionProvenanceEvidence(
      {
        image: e.imageReference,
        latestRevision: properties.latestRevisionName,
      },
      e.revisions,
      e.imageReference,
    );
  } catch {
    fail("running_revision_binding");
  }
  if (e.version?.sha !== sourceSha || e.version.origin !== e.publicOrigin)
    fail("application_version_binding");
  return {
    status: "EVIDENCE_BINDINGS_VALID_NO_EXECUTION_AUTHORITY_GRANTED",
    sourceSha,
    sourceTree,
    targetId: app.id,
    imageReference: e.imageReference,
    revision: running.latestRevision,
    publicOrigin: e.publicOrigin,
    authMode: b.authMode,
    modelId: p.modelId,
    voiceId: p.voiceId,
    acceptancePlanSha256: e.acceptancePlanSha256,
    generationApprovalReceiptSha256: e.generationApprovalReceiptSha256,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, sourceSha, sourceTree] = process.argv.slice(2);
    if (!file) fail("evidence_path_required");
    const result = qualifyGenerationStaging(JSON.parse(readFileSync(file, "utf8")), {
      sourceSha,
      sourceTree,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const code = /^generation_staging_[a-z_]+$/u.test(error?.message ?? "")
      ? error.message
      : "generation_staging_invalid_evidence";
    process.stderr.write(code + "\n");
    process.exitCode = 1;
  }
}
