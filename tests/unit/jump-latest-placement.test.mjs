import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
const transcript = readFileSync(
  new URL("../../src/components/ActiveChatTranscript.tsx", import.meta.url),
  "utf8",
);

test("the transcript remains keyboard-scrollable and follows replies near the bottom", () => {
  assert.doesNotMatch(route, /jumpToLatestButton|Jump to latest message/);
  assert.doesNotMatch(transcript, /showJumpToLatest|Jump to latest message/);
  assert.match(transcript, /data-chat-transcript="true"\s+tabIndex=\{-1\}/);
  assert.match(transcript, /if \(nearBottomRef.current\)/);
  assert.match(transcript, /scrollTo\(\{ top: el.scrollHeight, behavior: "auto" \}\)/);
});
