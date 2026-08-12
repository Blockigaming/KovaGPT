import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("public routes never flush authenticated operational analytics", () => {
  const runtime = readFileSync("src/components/PlatformRuntime.tsx", "utf8");
  assert.match(runtime, /if \(!isLoaded \|\| !isSignedIn\) return/);
  assert.match(runtime, /\[isLoaded, isSignedIn\]/);
});

test("signed-out disclosure describes processing without an unverified training claim", () => {
  const chat = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(chat, /Your input is processed to provide the service/);
  assert.doesNotMatch(chat, /Chats may be reviewed and used to improve our AI models/);
});
