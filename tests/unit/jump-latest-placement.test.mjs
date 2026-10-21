import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
test("jump control anchors above the growing composer instead of viewport coordinates", () => {
  assert.match(source, /relative shrink-0 lg:pb-2 lg:pt-2[\s\S]*?showJumpToLatest &&/);
  const button = source.slice(
    source.indexOf("{showJumpToLatest && ("),
    source.indexOf("{editingMessage?.conversationId"),
  );
  assert.match(button, /absolute bottom-full/);
  assert.match(button, /mb-2 min-h-11/);
  assert.doesNotMatch(button, /fixed|bottom-28/);
  assert.match(button, /el.scrollTo\(\{ top: el.scrollHeight, behavior: "smooth" \}\)/);
});
