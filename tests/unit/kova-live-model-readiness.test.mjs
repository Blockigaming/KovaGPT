import test from "node:test";
import assert from "node:assert/strict";
import { auditKovaModelConfiguration, REQUIRED_MODEL_BINDINGS } from "../../src/lib/ai/kova-live-model-readiness.mjs";

const app = (changes = {}) => ({
  id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/kovagpt-prod-web",
  name: "kovagpt-prod-web",
  properties: {
    template: {
      containers: [{
        name: "web",
        env: [
          ...Object.entries(REQUIRED_MODEL_BINDINGS).map(([name, value]) => ({ name, value })),
          { name: "KOVA_HOSTED_INFERENCE_ENABLED", value: "true" },
          { name: "KOVA_GENERATION_DISABLED", value: "false" },
          { name: "KOVA_REQUEST_CAPTURE_ENABLED", value: "false" },
          { name: "KOVA_GENERATION_ACCEPTANCE_ENABLED", value: "false" },
          { name: "OPENAI_API_KEY", secretRef: "openai-key" },
          { name: "KOVA_IP_HASH_SECRET", secretRef: "ip-hash-key" },
        ],
      }],
    },
    configuration: { secrets: [{ name: "openai-key" }, { name: "ip-hash-key" }] },
  },
  ...changes,
});

test("exact seven OpenAI aliases, 2/35/42 entitlements and protected env are ready", () => {
  const result = auditKovaModelConfiguration(app());
  assert.equal(result.configurationReady, true);
  assert.equal(result.productionVerified, false);
  assert.equal(result.models, 7);
  assert.deepEqual(result.entitlementCombinations, { free: 2, plus: 35, pro: 42 });
  assert.deepEqual(result.blockers, []);
});

test("hosted inference must be explicitly enabled; missing role bindings block", () => {
  const source = app();
  source.properties.template.containers[0].env = source.properties.template.containers[0].env
    .filter((item) => item.name !== "KOVA_MODEL_DEFAULT_CHAT")
    .map((item) => item.name === "KOVA_HOSTED_INFERENCE_ENABLED"
      ? { ...item, value: "false" } : item);
  const result = auditKovaModelConfiguration(source);
  assert.equal(result.configurationReady, false);
  assert(result.blockers.includes("hosted_inference_not_enabled"));
  assert(result.blockers.includes("KOVA_MODEL_DEFAULT_CHAT_binding_not_active"));
});

test("directly set API keys are rejected without echoing values", () => {
  const source = app();
  source.properties.template.containers[0].env = source.properties.template.containers[0].env
    .map((item) => item.name === "OPENAI_API_KEY"
      ? { name: "OPENAI_API_KEY", value: "sk-proj-secret-marker-not-to-print" } : item);
  const result = auditKovaModelConfiguration(source);
  assert.equal(result.configurationReady, false);
  assert(result.blockers.includes("openai_api_key_secret_reference_missing"));
  assert.doesNotMatch(JSON.stringify(result), /sk-proj|secret-marker/);
});

test("kill switch, request capture and acceptance flags cannot be bypassed", () => {
  const source = app();
  source.properties.template.containers[0].env = source.properties.template.containers[0].env
    .map((item) => ["KOVA_GENERATION_DISABLED", "KOVA_REQUEST_CAPTURE_ENABLED",
      "KOVA_GENERATION_ACCEPTANCE_ENABLED"].includes(item.name)
      ? { ...item, value: "true" } : item);
  const result = auditKovaModelConfiguration(source);
  assert.equal(result.configurationReady, false);
  assert(result.blockers.includes("generation_kill_switch_enabled"));
  assert(result.blockers.includes("KOVA_REQUEST_CAPTURE_ENABLED_blocks_hosted_inference"));
  assert(result.blockers.includes("KOVA_GENERATION_ACCEPTANCE_ENABLED_blocks_hosted_inference"));
});

test("a wrong Azure app or unresolved secret fails closed", () => {
  const wrong = app({ name: "ca-kovagpt-staging" });
  wrong.properties.configuration.secrets = [];
  const result = auditKovaModelConfiguration(wrong);
  assert.equal(result.configurationReady, false);
  assert(result.blockers.includes("production_app_identity_mismatch"));
  assert(result.blockers.includes("openai_api_key_secret_reference_unresolved"));
});

test("cost reservation warnings never falsely prove live traffic", () => {
  const source = app();
  source.properties.template.containers[0].env.push({
    name: "KOVA_MAX_COST_USD_PER_REQUEST", value: "0.2",
  });
  const result = auditKovaModelConfiguration(source);
  assert(result.warnings.includes("request_reservation_ceiling_may_block_astra_ultra"));
  assert.equal(result.productionVerified, false);
});
