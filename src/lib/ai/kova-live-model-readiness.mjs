/** Read-only model launch preflight. No credentials, provider calls or Azure writes. */
import { HOSTED_MODEL_MAP } from "../kova-foundation-models.mjs";
import { CONSUMER_MODELS } from "../consumer-model-selection.mjs";
import { MODE_IDS_BY_TIER } from "../mode-entitlements.mjs";

export const REQUIRED_MODEL_BINDINGS = Object.freeze({
  KOVA_MODEL_DEFAULT_CHAT: "kova-argon-4.6",
  KOVA_MODEL_ADVANCED_REASONING: "kova-neon-4.6",
  KOVA_MODEL_PREMIUM_REASONING: "kova-xenon-5",
});

export function auditKovaModelConfiguration(app) {
  const blockers = [];
  const warnings = [];
  const id = app?.id ?? "";
  if (
    app?.name !== "kovagpt-prod-web" ||
    !/\/resourceGroups\/rg-kovagpt-prod\/providers\/Microsoft\.App\/containerApps\/kovagpt-prod-web$/i.test(
      id,
    )
  )
    blockers.push("production_app_identity_mismatch");

  const containers = app?.properties?.template?.containers;
  const web = Array.isArray(containers) && containers.length === 1 ? containers[0] : null;
  if (!web) blockers.push("expected_one_web_container");
  const entries = web && Array.isArray(web.env) ? web.env : [];
  const env = new Map(entries.map((item) => [item.name, item]));
  // Inspect values only for known non-secret toggles and role bindings.
  const config = (name) => {
    const value = env.get(name);
    return typeof value?.value === "string" && !value.secretRef ? value.value : null;
  };

  for (const [name, expected] of Object.entries(REQUIRED_MODEL_BINDINGS))
    if (config(name) !== expected) blockers.push(name + "_binding_not_active");
  if (config("KOVA_HOSTED_INFERENCE_ENABLED") !== "true")
    blockers.push("hosted_inference_not_enabled");
  if (config("KOVA_GENERATION_DISABLED") === "true")
    blockers.push("generation_kill_switch_enabled");
  for (const name of ["KOVA_REQUEST_CAPTURE_ENABLED", "KOVA_GENERATION_ACCEPTANCE_ENABLED"]) {
    const value = config(name);
    if (value !== null && value !== "false") blockers.push(name + "_blocks_hosted_inference");
  }

  // Never read or echo secret values, even if an operator accidentally stored
  // one directly in an environment variable.
  const key = env.get("OPENAI_API_KEY");
  if (!key?.secretRef || typeof key.secretRef !== "string")
    blockers.push("openai_api_key_secret_reference_missing");
  const declaredSecrets = app?.properties?.configuration?.secrets;
  if (
    Array.isArray(declaredSecrets) &&
    key?.secretRef &&
    !declaredSecrets.some((item) => item.name === key.secretRef)
  )
    blockers.push("openai_api_key_secret_reference_unresolved");
  if (!Array.isArray(declaredSecrets)) warnings.push("secret_catalog_could_not_be_confirmed");

  const ipHash = env.get("KOVA_IP_HASH_SECRET");
  if (!ipHash?.secretRef) warnings.push("generation_ip_hash_secret_reference_not_confirmed");
  const costCeiling = config("KOVA_MAX_COST_USD_PER_REQUEST");
  if (costCeiling !== null && !(Number(costCeiling) >= 2 && Number(costCeiling) <= 10))
    warnings.push("request_reservation_ceiling_may_block_astra_ultra");

  const expectedIds = CONSUMER_MODELS.map((model) => model.id);
  if (
    expectedIds.length !== 7 ||
    new Set(expectedIds).size !== 7 ||
    expectedIds.some((modelId) => !Object.hasOwn(HOSTED_MODEL_MAP, modelId))
  )
    blockers.push("model_catalog_inconsistent");
  const combinations = {
    free:
      CONSUMER_MODELS.filter((model) => model.tiers.includes("free")).length *
      MODE_IDS_BY_TIER.free.length,
    plus:
      CONSUMER_MODELS.filter((model) => model.tiers.includes("plus")).length *
      MODE_IDS_BY_TIER.plus.length,
    pro:
      CONSUMER_MODELS.filter((model) => model.tiers.includes("pro")).length *
      MODE_IDS_BY_TIER.pro.length,
  };
  if (combinations.free !== 2 || combinations.plus !== 35 || combinations.pro !== 42)
    blockers.push("model_entitlements_inconsistent");

  return {
    configurationReady: blockers.length === 0,
    productionVerified: false, // Must additionally verify active revision and signed-in requests.
    blockers,
    warnings,
    models: expectedIds.length,
    entitlementCombinations: combinations,
    credential: "secret_reference_only",
  };
}
