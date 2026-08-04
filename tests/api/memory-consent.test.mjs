import assert from "node:assert/strict";
import test from "node:test";
import { parseMemoryPayload } from "../../src/lib/endpoint-reliability.mjs";

const messages = [
  { role: "user", content: "one" },
  { role: "assistant", content: "two" },
  { role: "user", content: "three" },
  { role: "assistant", content: "four" },
];

test("memory API accepts only explicit enabled, non-temporary summary requests", () => {
  const accepted = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      memoryEnabled: true,
      temporary: false,
      messages,
    }),
  );
  assert.equal(accepted.ok, true);

  for (const policy of [
    {},
    { memoryEnabled: false, temporary: false },
    { memoryEnabled: true, temporary: true },
    { memoryEnabled: true },
  ]) {
    const rejected = parseMemoryPayload(JSON.stringify({ chatId: "chat-1", messages, ...policy }));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, 400);
  }
});
