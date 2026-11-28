import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeResponseFollowups,
  appendFollowupToDraft,
  extractResponseFollowups,
} from "../../src/lib/response-followups.mjs";
test("only bounded supplied suggestions render, never inferred from prose", () => {
  assert.deepEqual(normalizeResponseFollowups(undefined), []);
  assert.deepEqual(
    normalizeResponseFollowups([" one ", "one", {}, "", "x".repeat(241), "two", "three", "four"]),
    ["one", "two", "three"],
  );
});
test("draft-only response actions still append without replacing the draft", () => {
  assert.equal(
    appendFollowupToDraft("Keep this draft ", "Explain more"),
    "Keep this draft \n\nExplain more",
  );
  const source = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(source, /restoreDialogFocus\(target, responseDraftUrl\)/);
});
test("only terminal metadata is removed from a finished answer", () => {
  const block = '\n```kova-followups\n["Show an example","Compare the options"]\n```';
  assert.deepEqual(extractResponseFollowups("An answer" + block + "\n"), {
    content: "An answer",
    followups: ["Show an example", "Compare the options"],
  });
  for (const content of [
    block,
    "An answer" + block + "\nMore text",
    "An answer" + block.replace("[", ""),
  ]) {
    assert.deepEqual(extractResponseFollowups(content), { content, followups: [] });
  }
});
test("response followups are retired without disabling interactive response actions", () => {
  const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.doesNotMatch(source, /kova-response-followups|normalizeResponseFollowups/);
  assert.match(source, /const submitInteractive = onFollowUp/);
  const route = readFileSync("src/routes/api/chat.ts", "utf8");
  assert.doesNotMatch(route, /RESPONSE_FOLLOWUP_INSTRUCTIONS|X-Kova-Response-Followups/);
  const headers = readFileSync("src/lib/chat-summary-snapshot.mjs", "utf8");
  assert.doesNotMatch(headers, /X-Kova-Response-Followups/);
});
