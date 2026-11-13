import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
const transcript = readFileSync(
  new URL("../../src/components/ActiveChatTranscript.tsx", import.meta.url),
  "utf8",
);

test("chat omits the jump arrow and still follows replies when the reader is near the bottom", () => {
  assert.doesNotMatch(route, /jumpToLatestButton|Jump to latest message/);
  assert.match(transcript, /if \(nearBottomRef.current\)/);
  assert.match(transcript, /scrollTo\(\{ top: el.scrollHeight, behavior: "auto" \}\)/);
});
