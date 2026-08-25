import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Azure release operations use exact source, immutable images, what-if, evidence, and rollback", () => {
  const production = read("scripts/azure/deploy-production-local.sh");
  const staging = read("scripts/azure/deploy-staging-local.sh");
  const rollback = read("scripts/azure/rollback-production-local.sh");
  for (const source of [production, staging]) {
    assert.match(source, /git rev-parse HEAD/u);
    assert.match(source, /git rev-parse HEAD\^\{tree\}/u);
    assert.match(source, /az deployment group what-if/u);
    assert.match(source, /@\$\{DIGEST\}|@\$DIGEST|@\$\{?DIGEST/u);
    assert.match(source, /KOVA_VERIFY_BROWSER_CONFIG=true/u);
    assert.doesNotMatch(source, /git push|gh workflow run/u);
    assert.doesNotMatch(source, /@lovable\.dev|lovable\.(?:app|dev)|LOVABLE_API_KEY/iu);
  }
  for (const proof of [
    "release:production:verify",
    "cloudflare:edge:verify",
    "azure:production:rbac:verify",
    "azure:production:scheduler:verify",
    "azure:production:observability:verify",
    "KOVA_RUN_GENERATION_SMOKE=1",
    "KOVA_RUN_TOOL_SMOKE=1",
    "KOVA_RUN_RESEARCH_SMOKE=1",
    "KOVA_RUN_IMAGE_SMOKE=1",
  ])
    assert.match(production, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(production, /generationEnabled.*true/su);
  assert.match(production, /bindCustomDomains.*true/su);
  assert.match(production, /deployScheduledJob.*true/su);
  assert.match(rollback, /oldImage/u);
  assert.match(rollback, /@sha256:/u);
  assert.match(rollback, /KOVA_AZURE_PRODUCTION_ROLLBACK=PASS/u);
  assert.doesNotMatch(rollback, /readarray/u, "rollback must work with macOS Bash 3.2");
});

test("live Azure proofs cover RBAC, scheduler, and observability", () => {
  const rbac = read("scripts/azure/verify-rbac-local.sh");
  const scheduler = read("scripts/azure/verify-scheduled-job-local.sh");
  const observability = read("scripts/azure/verify-observability-local.sh");
  assert.match(rbac, /AcrPull/u);
  assert.match(rbac, /Key Vault Secrets User/u);
  assert.match(rbac, /Cognitive Services OpenAI User/u);
  assert.match(scheduler, /containerapp job start/u);
  assert.match(scheduler, /Succeeded/u);
  assert.match(scheduler, /invalid-auth boundary/u);
  assert.match(observability, /app-insights query/u);
  assert.match(observability, /health=countif/u);
});
