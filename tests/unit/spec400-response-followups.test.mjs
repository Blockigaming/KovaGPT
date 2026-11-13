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
test("suggestion buttons submit the next turn through the shared response handler", () => {
  const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.match(source, /onClick=\{\(\) => onFollowUp\(suggestion\)\}/);
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(route, /const clearComposer =\s*!preserveDraft/);
  assert.match(route, /onFollowUp=\{[\s\S]*?void send\(\s*prompt/);
});
test("suggestions stay absent for streaming/failed/stopped and keep mobile wrapping", () => {
  const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.match(source, /!streaming &&\s*!message.generationStatus/);
  assert.match(source, /aria-label="Suggested follow-ups"/);
  const css = readFileSync("src/components/response-output-blocks.css", "utf8");
  assert.match(css, /\.kova-response-followups span \{[\s\S]*?overflow-wrap: anywhere/);
});
