import assert from "node:assert/strict";
import test from "node:test";
import {
  developerComputerFields,
  validDeveloperComputerRequest,
  validateDeveloperComputerResult,
  readDeveloperComputerResponse,
} from "../../src/lib/pricing/developer-computer-policy.mjs";

const screenshot =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=";
const body = {
  model: "test",
  ...developerComputerFields({ input: "Inspect test UI.", screenshot, max_output_tokens: 100 }),
};
const call = {
  type: "computer_call",
  status: "completed",
  pending_safety_checks: [],
  actions: [{ type: "click", x: 0, y: 0, button: "left" }],
};
const value = {
  id: "resp_test",
  status: "completed",
  model: "test",
  usage: {
    input_tokens: 100,
    output_tokens: 30,
    total_tokens: 130,
    input_tokens_details: { cached_tokens: 20 },
  },
  output: [call],
};
test("computer proposals have exactly one screenshot and a bounded tool policy", () => {
  assert.equal(validDeveloperComputerRequest(body), true);
  for (const patch of [
    { stream: true },
    { store: true },
    { previous_response_id: "other" },
    { tools: [{ type: "computer" }, { type: "web_search" }] },
    { instructions: "untrusted" },
  ])
    assert.equal(validDeveloperComputerRequest({ ...body, ...patch }), false);
  assert.throws(() =>
    developerComputerFields({
      input: "test",
      screenshot: "https://example.com/screenshot.png",
      max_output_tokens: 100,
    }),
  );
});
test("review is mandatory and unsupported or ambiguous actions are blocked", () => {
  const result = validateDeveloperComputerResult(value, body, ["test"], "public");
  assert.equal(result.requires_human_review, true);
  assert.equal(result.status, "proposed");
  assert.deepEqual(result.actions, call.actions);
  for (const patch of [
    { pending_safety_checks: [{ id: "review" }] },
    { pending_safety_checks: undefined },
    { actions: [{ type: "type", text: "secret" }] },
    { actions: [{ ...call.actions[0], x: 1 }] },
    { actions: [{ ...call.actions[0], keys: ["Control"] }] },
    { actions: [...call.actions, ...call.actions] },
  ]) {
    const blocked = validateDeveloperComputerResult(
      { ...value, output: [{ ...call, ...patch }] },
      body,
      ["test"],
      "public",
    );
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(blocked.actions, []);
  }
});
test("result reading preserves usage and rejects the wrong provider model", async () => {
  const result = await readDeveloperComputerResponse(Response.json(value), body, ["test"], "public");
  assert.equal(result.model, "public");
  assert.equal(result.usage.cached_input_tokens, 20);
  await assert.rejects(
    readDeveloperComputerResponse(Response.json(value), body, ["other"], "public"),
    /computer_invalid/,
  );
});
