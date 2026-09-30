import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("explicit Kova model requests cannot fall through to the legacy provider route", () => {
  const route = readFileSync("src/routes/api/chat.ts", "utf8");
  const boundary = route.indexOf("if (ingress.kovaModel) {");
  const providerCheck = route.indexOf("const missingProvider = missingAiProviderResponse();");
  const providerRouting = route.indexOf("const routeDecision = routeAiModel(");
  assert.ok(boundary > route.indexOf('preflight.run("plan_entitlement"'));
  assert.ok(boundary < providerCheck);
  assert.ok(providerCheck < providerRouting);
  const earlyReturn = route.slice(boundary, providerCheck);
  assert.match(earlyReturn, /kova_model_not_entitled/);
  assert.match(earlyReturn, /kova_model_runtime_unverified/);
  assert.match(earlyReturn, /return Response\.json\(/);
  assert.doesNotMatch(earlyReturn, /providerFetch|chatCompletions|routeAiModel/);
});
