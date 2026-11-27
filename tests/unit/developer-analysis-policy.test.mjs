import assert from "node:assert/strict";
import test from "node:test";
import {
  developerAnalysisFields,
  validDeveloperAnalysisRequest,
  analysisContainerReceipt,
  validateDeveloperAnalysisResult,
  readDeveloperAnalysisResponse,
} from "../../src/lib/pricing/developer-analysis-policy.mjs";
const body = {
  model: "test",
  ...developerAnalysisFields({ input: "Analyze data.", max_output_tokens: 100 }),
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
  output: [
    {
      type: "code_interpreter_call",
      id: "ci_test",
      container_id: "cntr_test",
      status: "completed",
    },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Result." }] },
  ],
};
test("only isolated bounded auto-container requests are accepted", () => {
  assert.equal(validDeveloperAnalysisRequest(body), true);
  for (const patch of [
    { max_tool_calls: 2 },
    { store: true },
    { stream: true },
    { previous_response_id: "other" },
    { tools: [{ type: "code_interpreter", container: "cntr_other" }] },
  ])
    assert.equal(validDeveloperAnalysisRequest({ ...body, ...patch }), false);
});
test("one completed container receipt is required and provider IDs are hidden", () => {
  assert.equal(analysisContainerReceipt(value.output), "cntr_test");
  assert.equal(analysisContainerReceipt([]), null);
  assert.equal(analysisContainerReceipt([...value.output, value.output[0]]), null);
  const result = validateDeveloperAnalysisResult(value, ["test"], "public");
  assert.equal(result.model, "public");
  assert.equal(result.usage.container_1g_sessions, 1);
  assert.equal(JSON.stringify(result).includes("cntr_test"), false);
});
test("response cleanup completes before returning", async () => {
  const deleted = [];
  const result = await readDeveloperAnalysisResponse(
    Response.json(value),
    ["test"],
    "public",
    async (container) => deleted.push(container),
  );
  assert.deepEqual(deleted, ["cntr_test"]);
  assert.equal(result.text, "Result.");
});
