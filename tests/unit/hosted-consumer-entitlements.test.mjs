import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isKovaHostedModelId } from "../../src/lib/ai/kova-hosted-inference.server.mjs";

const catalogSource = readFileSync(
  new URL("../../src/lib/ai/model-catalog.server.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(catalogSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", output)((name) => {
  assert.equal(name, "@/lib/runtime-env.server");
  return { runtimeEnv: () => undefined };
}, exports);
const models = exports.KOVA_HOSTED_TEXT_MODELS;
const source = readFileSync(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
let gate;
function visit(node) {
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(file).includes("isKovaHostedModelId(model)") &&
    node.expression.getText(file).includes("KOVA_HOSTED_TEXT_MODELS")
  )
    gate = node;
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(gate, "resolved hosted alias requires a plan guard");
const end = gate.end;
const guard = new Function(
  "model",
  "callerTier",
  "KOVA_HOSTED_TEXT_MODELS",
  "isKovaHostedModelId",
  gate.getText(file),
);

const entitled = {
  free: ["kova-argon-4.6"],
  plus: ["kova-argon-4.6", "kova-neon-4.6"],
  pro: ["kova-argon-4.6", "kova-neon-4.6", "kova-xenon-5"],
};
for (const [tier, expected] of Object.entries(entitled)) {
  test(`${tier} hosted catalog exposes the exact approved foundation products`, () => {
    assert.deepEqual(
      models.filter((model) => model.tiers.includes(tier)).map((model) => model.id),
      expected,
    );
  });
  test(`${tier} actual chat guard rejects a misconfigured role before external tools`, async () => {
    for (const model of models) {
      const response = guard(model.id, tier, models, isKovaHostedModelId);
      if (expected.includes(model.id)) assert.equal(response, undefined);
      else {
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.deepEqual(await response.json(), {
          error: "This Kova model is unavailable for your plan.",
          code: "kova_model_not_entitled",
          upgradeUrl: "/pricing",
          retryable: false,
        });
      }
    }
  });
}
test("hosted entitlement guard runs before web search and generation reservations", () => {
  for (const marker of [
    "const explicitWebSearch =",
    "let maximumProviderCalls =",
    "estimateMaximumCostUsd(catalogModel",
  ])
    assert.ok(source.indexOf(marker) > end, marker);
});
