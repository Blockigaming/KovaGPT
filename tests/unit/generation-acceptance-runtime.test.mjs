import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createAcceptanceFixture } from "../helpers/generation-acceptance.mjs";

const compiled = ts.transpileModule(
  readFileSync("src/lib/generation-acceptance-runtime.server.ts", "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
function fixture(overrides = {}) {
  const f = createAcceptanceFixture();
  const env = {
    KOVA_GENERATION_ACCEPTANCE_ENABLED: "true",
    AZURE_ENVIRONMENT: "staging",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    KOVA_SOURCE_TREE: f.plan.target.tree,
    KOVA_IMAGE_DIGEST: f.plan.target.imageDigest,
    CONTAINER_APP_REVISION: f.plan.target.revision,
    KOVA_GENERATION_ACCEPTANCE_PLAN: JSON.stringify(f.plan),
    KOVA_GENERATION_ACCEPTANCE_APPROVAL: JSON.stringify(f.config.approvalReceipt),
    KOVA_GENERATION_ACCEPTANCE_PLAN_SHA256: f.config.expectedPlanSha256,
    KOVA_GENERATION_ACCEPTANCE_APPROVAL_SHA256: f.config.expectedApprovalReceiptSha256,
    ...overrides,
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) =>
      ({
        "./generation-acceptance.server.mjs": {
          createGenerationAcceptanceGuard: (options) => options,
        },
        "./distributed-rate-limit.server": {
          consumeApplicationRateLimit: () => {
            throw Error("Unexpected database call");
          },
        },
        "./runtime-env.server": { runtimeEnv: (key) => env[key] },
        "./build-identity": { BUILD_IDENTITY: { sha: f.plan.target.commit } },
      })[name],
  });
  return exports.generationAcceptance;
}
test("runtime loads only privately configured exact deployment bindings", () => {
  const guard = fixture();
  assert.equal(guard.getConfig().enabled, true);
});
test("absent or explicitly disabled mode preserves ordinary behavior", () => {
  for (const flag of [undefined, "false"])
    assert.equal(fixture({ KOVA_GENERATION_ACCEPTANCE_ENABLED: flag }).getConfig().enabled, false);
});
for (const [name, value] of Object.entries({
  KOVA_GENERATION_ACCEPTANCE_ENABLED: "invalid",
  AZURE_ENVIRONMENT: "production",
  KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-prod",
  KOVA_SOURCE_TREE: "e".repeat(40),
  KOVA_IMAGE_DIGEST: `sha256:${"f".repeat(64)}`,
  CONTAINER_APP_REVISION: "other-revision",
  KOVA_GENERATION_ACCEPTANCE_PLAN: "malformed",
  KOVA_GENERATION_ACCEPTANCE_APPROVAL: "malformed",
}))
  test(`runtime rejects ${name} mismatch with a static safe error`, () => {
    assert.throws(() => fixture({ [name]: value }).getConfig(), /generation_acceptance_denied/);
  });
