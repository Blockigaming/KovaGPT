import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCostUsd, extractOutputText, runOpenAiCase } from "../../scripts/model-eval-run-openai.mjs";

test("extractOutputText supports Responses API output_text and message content", () => {
  assert.equal(extractOutputText({ output_text: "direct" }), "direct");
  assert.equal(extractOutputText({ output: [{ type: "message", content: [
    { type: "output_text", text: "hello" }, { type: "output_text", text: " world" },
  ] }] }), "hello world");
});

test("estimateCostUsd uses per-million-token prices", () => {
  assert.equal(estimateCostUsd({ input_tokens: 1000, output_tokens: 500 }, 4, 20), 0.014);
  assert.equal(estimateCostUsd({ input_tokens: 1, output_tokens: 1 }, Number.NaN, 20), null);
});

test("runOpenAiCase sends an isolated non-stored Responses request and records usage", async () => {
  let request;
  const fetcher = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: "resp_test", status: "completed", output_text: "answer",
      usage: { input_tokens: 100, output_tokens: 25 } }), { status: 200 });
  };
  const row = await runOpenAiCase({ apiKey: "test-key", item: { id: "case-1", prompt: "test prompt" },
    model: "gpt-5.6-sol", reasoningEffort: "high", maxOutputTokens: 4096, timeoutMs: 1000,
    inputUsdPerMtok: 4, outputUsdPerMtok: 20, fetcher });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.model, "gpt-5.6-sol");
  assert.equal(request.body.store, false);
  assert.deepEqual(request.body.reasoning, { effort: "high" });
  assert.equal(row.output, "answer");
  assert.equal(row.input_tokens, 100);
  assert.equal(row.output_tokens, 25);
  assert.equal(row.cost_usd, 0.0009);
});
