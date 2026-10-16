import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync("src/components/ChatInput.tsx", "utf8");
const expression = source.match(/data-compact-guest=\{([\s\S]*?)\n      \}/)?.[1];
assert.ok(expression);
test("compact layout follows resolved guest and actual selector visibility, not tier", () => {
  const base = {
    isLoaded: true,
    user: null,
    showAddMenu: true,
    canChangeAgent: false,
    mode: "instant",
    onModeChange: () => {},
  };
  const value = (next = {}) => vm.runInNewContext(expression, { ...base, ...next });
  assert.equal(value(), "true");
  assert.equal(value({ isLoaded: false }), undefined);
  assert.equal(value({ user: { id: "signed-in" } }), undefined);
  assert.equal(value({ canChangeAgent: true }), undefined);
  assert.equal(value({ canChangeAgent: true, onModeChange: undefined }), "true");
  assert.equal(value({ showAddMenu: false }), undefined);
  assert.equal(value(), "true", "sign-out returns to compact without draft-dependent state");
  assert.match(source, /canChangeAgent && mode && onModeChange &&/);
  assert.match(source, /attachments\.length > 0 &&/);
});
