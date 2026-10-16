import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";
test("draft cache scopes every chat and invalidates old account callbacks", () => {
  const h = createHookHarness();
  const hook = loadUiModule("src/lib/use-chat-rule-drafts.ts", {
    react: h.react,
  }).useChatRuleDrafts;
  const a = h.render(() => hook("account-a"));
  a.write("chat-a", { instructions: "A", enabled: true });
  a.write("chat-b", { instructions: "B", enabled: false });
  assert.equal(h.render(() => hook("account-a")).read("chat-a").instructions, "A");
  assert.equal(a.read("chat-b").instructions, "B");
  const b = h.render(() => hook("account-b"));
  assert.equal(b.read("chat-a"), null);
  a.write("chat-a", { instructions: "Late A", enabled: true });
  assert.equal(b.read("chat-a"), null);
  assert.equal(h.render(() => hook("account-a")).read("chat-a"), null);
});
test("acknowledged drafts can be cleared without clearing another chat", () => {
  const h = createHookHarness();
  const hook = loadUiModule("src/lib/use-chat-rule-drafts.ts", {
    react: h.react,
  }).useChatRuleDrafts;
  const d = h.render(() => hook("actor"));
  d.write("one", { instructions: "one", enabled: true });
  d.write("two", { instructions: "two", enabled: true });
  d.write("one", null);
  assert.equal(d.read("one"), null);
  assert.equal(d.read("two").instructions, "two");
});
