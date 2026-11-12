import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/ChatHistorySync.tsx", "utf8");

test("routine multi-tab ownership remains safe without a noisy connection-check prompt", () => {
  assert.match(source, /navigator\.locks\.request\(/);
  assert.match(source, /event\("other_tab"\)/);
  assert.match(source, /await readOnlyRefresh\(\)/);
  assert.doesNotMatch(source, /function checkConnection|const checkConnection/);
  assert.doesNotMatch(source, /Check sync connection|Chat editing is open in another tab/);
});

test("real chat-history recovery conditions remain visible", () => {
  for (const phase of ["device_error", "blocked", "auth_required", "cleared", "conflict"]) {
    assert.ok(source.includes(phase), phase);
  }
});
