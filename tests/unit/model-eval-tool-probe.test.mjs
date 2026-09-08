import assert from "node:assert/strict";
import { test } from "node:test";
import { runToolProbe } from "../../scripts/model-eval-tool-probe.mjs";

const call = (name, args, id = name) => ({
  type: "function_call", name, call_id: id, arguments: JSON.stringify(args),
});
const limit = () => call("get_project_limit", { plan: "plus" });
const count = () => call("count_projects", { workspace: "fixture-workspace" });
const final = (text = '{"remaining":2}') => ({
  type: "message", role: "assistant", content: [{ type: "output_text", text }],
});
const response = (...output) => ({ status: "completed", model: "fixture-model", output });
const scripted = (...steps) => async () => steps.shift();

test("executes both tools and supplies their results before grading the final answer", async () => {
  let turn = 0;
  const result = await runToolProbe(async (request) => {
    assert.equal(request.tools.length, 2);
    assert.ok(request.tools.every((tool) => tool.strict));
    assert.equal(request.store, false);
    turn += 1;
    if (turn === 1) return response(limit());
    if (turn === 2) {
      assert.equal(request.input.at(-1).type, "function_call_output");
      assert.equal(request.input.at(-1).output, '{"limit":20}');
      return response(count());
    }
    assert.equal(request.input.at(-1).output, '{"count":18}');
    return response(final());
  });
  assert.equal(result.score, 1);
  assert.equal(result.trace.length, 2);
  assert.equal(result.turns, 3);
  assert.equal(result.replacement_eligible, false);
});

test("narration and guessing the correct answer do not substitute for executing tools", async () => {
  for (const text of ['{"remaining":2}', "I would look up the limit and count the projects."]) {
    const result = await runToolProbe(scripted(response(final(text))));
    assert.equal(result.score, 0);
    assert.equal(result.reason, "required_tools_not_called");
  }
});

test("correct tool calls with a wrong final result fail", async () => {
  const result = await runToolProbe(scripted(response(limit(), count()), response(final('{"remaining":3}'))));
  assert.equal(result.score, 0);
  assert.equal(result.reason, "wrong_final_answer");
});

for (const [bad, reason] of [
  [call("send_email", {}), "unknown_tool"],
  [call("get_project_limit", { plan: "pro" }), "invalid_tool_arguments"],
  [call("get_project_limit", { plan: "plus", bypass: true }), "invalid_tool_arguments"],
  [{ ...limit(), arguments: "not JSON" }, "invalid_tool_json"],
]) {
  test(`rejects unsafe or malformed tool request: ${reason}`, async () => {
    const result = await runToolProbe(scripted(response(bad)));
    assert.equal(result.reason, reason);
    assert.equal(result.score, 0);
    assert.equal(result.trace.length, 0);
  });
}

test("repeated tool names and reused call IDs fail without repeated execution", async () => {
  const repeated = await runToolProbe(scripted(response(limit()), response({ ...limit(), call_id: "new-id" })));
  assert.equal(repeated.reason, "repeated_tool");
  const duplicate = await runToolProbe(scripted(response(limit()), response({ ...count(), call_id: "get_project_limit" })));
  assert.equal(duplicate.reason, "invalid_or_duplicate_call_id");
  assert.equal(duplicate.trace.length, 1);
});

test("timeouts, provider failures and model changes cannot earn passing scores", async () => {
  const hung = await runToolProbe(() => new Promise(() => {}), { timeoutMs: 5 });
  assert.equal(hung.reason, "timeout");
  const failed = await runToolProbe(async () => { throw new Error("private-error-body"); });
  assert.equal(failed.reason, "responder_error");
  assert.ok(!JSON.stringify(failed).includes("private-error-body"));
  const changed = await runToolProbe(scripted(response(limit()), { ...response(count()), model: "other" }));
  assert.equal(changed.reason, "model_changed");
});

test("responder cannot mutate the evaluator's previous tool evidence", async () => {
  let turn = 0;
  const result = await runToolProbe(async (request) => {
    turn += 1;
    if (turn === 1) return response(limit(), count());
    request.input.at(-1).output = '{"count":0}';
    return response(final());
  });
  assert.equal(result.score, 1);
  assert.equal(result.trace[1].result, '{"count":18}');
});
