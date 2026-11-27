import assert from "node:assert/strict";
import test from "node:test";
import { createDeveloperPlaygroundStream } from "../../src/lib/pricing/developer-playground-stream.mjs";

const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
const delta = (text) => ({ type: "response.output_text.delta", delta: text });
const completed = { type: "response.completed", response: { status: "completed" } };

test("playground stream preserves fragmented text and CRLF boundaries", () => {
  const parser = createDeveloperPlaygroundStream();
  const stream = frame(delta("hello")) + frame(delta(" world")) + frame(completed);
  const crlf = stream.replaceAll("\n", "\r\n");
  for (const character of crlf) parser.push(character);
  assert.deepEqual(parser.finish(), { output: "hello world", status: "completed" });
});

test("playground does not render reasoning events or mislabel incomplete output", () => {
  const parser = createDeveloperPlaygroundStream();
  parser.push(frame({ type: "response.reasoning_summary_text.delta", delta: "ignored" }));
  parser.push(frame(delta("partial")));
  parser.push(frame({ type: "response.incomplete", response: { status: "incomplete" } }));
  assert.deepEqual(parser.finish(), { output: "partial", status: "incomplete" });
});

test("truncated, invalid and failed streams are not marked complete", () => {
  for (const input of [
    frame(delta("partial")),
    frame({ type: "response.failed" }),
    frame({ type: "response.completed", response: { status: "incomplete" } }),
    "data: {\n\n",
    frame(completed) + frame(delta("unexpected")),
    "data: " + "x".repeat(1048577),
  ]) {
    const parser = createDeveloperPlaygroundStream();
    assert.throws(() => {
      parser.push(input);
      parser.finish();
    }, /Check Logs/);
  }
});
