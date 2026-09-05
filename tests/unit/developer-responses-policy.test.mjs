import assert from "node:assert/strict";
import test from "node:test";
import { parseDeveloperInput } from "../../src/lib/pricing/developer-platform-policy.mjs";
import { developerJsonSchema } from "../../src/lib/pricing/developer-responses-policy.mjs";
const schema = {
  type: "object",
  properties: { city: { type: ["string", "null"] } },
  required: ["city"],
  additionalProperties: false,
};
const tool = { type: "function", name: "weather", parameters: schema, strict: true };
const input = { model: "kova-fast", input: "Weather?", max_output_tokens: 100 };
test("strict function and output schemas cross the same bounded stateless Responses admission", () => {
  const value = parseDeveloperInput("responses", {
    ...input,
    tools: [tool],
    tool_choice: { type: "function", name: "weather" },
    parallel_tool_calls: false,
    text: { format: { type: "json_schema", name: "answer", strict: true, schema } },
  });
  assert.equal(value.body.store, false);
  assert.deepEqual(value.body.include, ["reasoning.encrypted_content"]);
  assert.deepEqual(value.body.tools, [tool]);
  assert.deepEqual(value.body.text.format.schema, schema);
  assert.notEqual(value.body.tools[0].parameters, schema);
  for (const patch of [
    { tools: [{ type: "web_search" }] },
    { tools: [{ ...tool, strict: false }] },
    { tools: [tool, tool] },
    { tools: [tool], tool_choice: { type: "function", name: "missing" } },
    { tool_choice: "required" },
    { parallel_tool_calls: true },
    { text: { format: { type: "json_object" } } },
    { tools: Array.from({ length: 33 }, (_, i) => ({ ...tool, name: `t${i}` })) },
  ])
    assert.throws(
      () => parseDeveloperInput("responses", { ...input, ...patch }),
      /responses_invalid/,
    );
});
test("a client-owned function round preserves encrypted reasoning and binds its result to the call", () => {
  const history = [
    { role: "user", content: "Weather?" },
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-provider-context" },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "weather",
      arguments: '{"city":"Paris"}',
      status: "completed",
    },
    { type: "function_call_output", call_id: "call_1", output: "18C" },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "It is 18C.", annotations: [] }],
    },
  ];
  const value = parseDeveloperInput("responses", { ...input, input: history, tools: [tool] });
  assert.equal(value.body.input[1].encrypted_content, "opaque-provider-context");
  assert.deepEqual(value.body.input[4], { role: "assistant", content: "It is 18C." });
  for (const records of [
    [history[3]],
    [...history, history[3]],
    [...history, history[2]],
    [{ ...history[2], arguments: "not JSON" }],
    [{ ...history[1], encrypted_content: undefined }],
    [{ role: "user", content: [{ type: "input_image", image_url: "https://private" }] }],
    Array(101).fill(history[0]),
  ])
    assert.throws(
      () => parseDeveloperInput("responses", { ...input, input: records }),
      /responses_invalid/,
    );
});
test("JSON Schema refs remain local, strict and bounded without resolving remote content", () => {
  const linked = {
    type: "object",
    properties: { next: { anyOf: [{ $ref: "#/$defs/item" }, { type: "null" }] } },
    required: ["next"],
    additionalProperties: false,
    $defs: { item: schema },
  };
  assert.deepEqual(developerJsonSchema(linked), linked);
  for (const bad of [
    { ...schema, additionalProperties: true },
    { ...schema, required: [] },
    { ...schema, properties: { city: { $ref: "https://attacker.invalid/schema" } } },
    { ...schema, properties: { city: { $ref: "#/$defs/missing" } } },
    { ...schema, properties: { city: { type: "string", pattern: "(a+)+" } } },
    {
      ...schema,
      properties: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [`p${i}`, { type: "string" }]),
      ),
    },
  ])
    assert.throws(() => developerJsonSchema(bad), /responses_invalid/);
  let deep = { type: "string" };
  for (let i = 0; i < 11; i++) deep = { type: "array", items: deep };
  assert.throws(
    () => developerJsonSchema({ ...schema, properties: { city: deep } }),
    /responses_invalid/,
  );
});
test("schema and tool-result bytes consume the total request bound", () => {
  assert.throws(
    () =>
      parseDeveloperInput("responses", {
        ...input,
        input: Array(3).fill({ role: "user", content: "x".repeat(30000) }),
      }),
    /too_large/,
  );
});
