import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { KOVA_WORK_ROUTES } from "../../src/lib/kova-work-policy.mjs";
import {
  hasKovaWorkSelection,
  kovaWorkSubmissionBoundary,
} from "../../src/lib/kova-work-submission.mjs";

const input = (family = "cosmo", effort = "light") => ({
  mutationId: "f04b438d-5571-4855-b74f-c1393586da65",
  objective: "Explain the selected result.",
  source: "work",
  kovaModel: { family, effort },
});

test("all 18 Kova Work selections fail closed after tier admission", () => {
  for (const route of KOVA_WORK_ROUTES) {
    const choice = input(route.familyId, route.effortId);
    assert.equal(hasKovaWorkSelection(choice), true);
    for (const tier of [null, "free", "business", "enterprise"])
      assert.deepEqual(kovaWorkSubmissionBoundary(choice, tier), {
        error: "work_kova_entitlement_required", status: 403,
      });
    for (const tier of ["plus", "pro"])
      assert.deepEqual(kovaWorkSubmissionBoundary(choice, tier), {
        error: "work_kova_runtime_unverified", status: 503,
      });
  }
});

test("malformed, forged and mixed legacy selections cannot reach admission", () => {
  for (const invalid of [
    { ...input(), kovaModel: { family: "nova", effort: "fast" } },
    { ...input(), kovaModel: { family: "nova", effort: "ultra", model: "legacy" } },
    { ...input(), kovaModel: { family: "unknown", effort: "light" } },
    { ...input(), mode: "thinking" },
    { ...input(), reasoningEffort: "high" },
    { ...input(), model: "provider-override" },
    { ...input(), mutationId: "bad" },
    { ...input(), objective: "" },
  ])
    assert.throws(() => kovaWorkSubmissionBoundary(invalid, "pro"), /^(?:Error: )?work_/);
});

test("authenticated API checks Kova Work before the provider submit path", () => {
  const route = readFileSync("src/routes/api/work/execution.ts", "utf8");
  const auth = route.indexOf("const auth = await requireVerifiedUser(request);");
  const boundary = route.indexOf("if (hasKovaWorkSelection(body.input))");
  const providerSubmit = route.indexOf("return json(await submitWorkExecution(auth, body.input));");
  assert.ok(auth >= 0 && boundary > auth && providerSubmit > boundary);
  assert.match(route.slice(boundary, providerSubmit), /getAgentEntitlement\(auth\)/);
  assert.match(
    route.slice(boundary, providerSubmit),
    /kovaWorkSubmissionBoundary\(body.input, tier\)/,
  );
});
