import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/TemporaryChatStartDialog.tsx", "utf8").replace(
  /\s+/g,
  " ",
);

test("temporary confirmation explains the immutable mode and new-chat requirement", () => {
  assert.match(source, /Temporary mode and context stay fixed after your first message/);
  assert.match(source, /Start a new chat to\s+change them/);
  assert.doesNotMatch(
    source,
    /You can save the chat to history|later and continue it as a regular chat/,
  );
});

test("pre-chat temporary banner describes history and when the choice becomes fixed", () => {
  assert.match(source, /Temporary chat · not saved to history/);
  assert.doesNotMatch(source, /Temporary Chat: Not Saved To Library/);
  assert.match(source, /You can change this setting before your first message/);
  assert.match(source, /After that, start a new chat to\s+change it/);
});
