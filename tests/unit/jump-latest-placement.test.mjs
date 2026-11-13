import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
const transcript = readFileSync(
  new URL("../../src/components/ActiveChatTranscript.tsx", import.meta.url),
  "utf8",
);
test("the transcript remains keyboard-scrollable after removing the jump arrow", () => {
  assert.doesNotMatch(source, /jumpToLatestButton|Jump to latest message/);
  assert.doesNotMatch(transcript, /showJumpToLatest|Jump to latest message/);
  assert.match(transcript, /data-chat-transcript="true"\s+tabIndex=\{-1\}/);
});
