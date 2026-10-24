import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeResponseFollowups,
  appendFollowupToDraft,
} from "../../src/lib/response-followups.mjs";
test("only bounded supplied suggestions render, never inferred from prose", () => {
  assert.deepEqual(normalizeResponseFollowups(undefined), []);
  assert.deepEqual(
    normalizeResponseFollowups([" one ", "one", {}, "", "x".repeat(241), "two", "three", "four"]),
    ["one", "two", "three"],
  );
});
test("choosing suggestion preserves the existing draft exactly and never sends", () => {
  assert.equal(
    appendFollowupToDraft("Keep this\n draft ", "Explain more"),
    "Keep this\n draft \n\nExplain more",
  );
  assert.equal(appendFollowupToDraft("", "Explain more"), "Explain more");
  const source = readFileSync("src/routes/index.tsx", "utf8");
  const callback = source.slice(
    source.indexOf("onSelectSuggestion="),
    source.indexOf("temporary={Boolean(active.temporary)}"),
  );
  assert.match(callback, /prepareResponseDraft\(suggestion\)\?\.\(\)/);
  assert.doesNotMatch(callback, /send\(/);
  assert.match(source, /restoreDialogFocus\(target, responseDraftUrl\)/);
});
test("suggestions stay absent for streaming/failed/stopped and keep mobile wrapping", () => {
  const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.match(source, /!streaming &&\s*!message.generationStatus/);
  assert.match(source, /aria-label="Suggested follow-ups"/);
  const css = readFileSync("src/components/response-output-blocks.css", "utf8");
  assert.match(css, /\.kova-response-followups span \{[\s\S]*?overflow-wrap: anywhere/);
});
