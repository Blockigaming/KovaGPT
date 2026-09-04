import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Google request limits use isolated distributed user and operation buckets", () => {
  const limiter = readFileSync("src/lib/google-rate-limit.server.ts", "utf8");
  assert.match(limiter, /consumeApplicationRateLimit/);
  assert.match(limiter, /identity: `user:\$\{userId\}`/);
  assert.match(limiter, /action: `google_\$\{operation\}`/);
  assert.match(limiter, /windowSeconds: 60/);
  assert.match(limiter, /Retry-After/);
  assert.match(limiter, /result\.status === "limited" \? 429 : 503/);
  assert.doesNotMatch(limiter, /new Map/);
});

test("every Google route awaits protection before provider work", () => {
  for (const path of [
    "src/routes/api/google/auth.ts",
    "src/routes/api/google/calendar.ts",
    "src/routes/api/google/status.ts",
    "src/routes/api/google/drive.ts",
    "src/routes/api/google/gmail.ts",
    "src/routes/api/chat/confirm.ts",
  ]) {
    const route = readFileSync(path, "utf8");
    assert.match(route, /await enforceGoogleRateLimit/);
  }
});
