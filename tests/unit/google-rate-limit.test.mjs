import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Google request limits are isolated by user and operation and return Retry-After", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { enforceGoogleRateLimit } from './src/lib/google-rate-limit.server.ts';
       const first = enforceGoogleRateLimit('user-a', 'gmail', 1);
       const blocked = enforceGoogleRateLimit('user-a', 'gmail', 1);
       const otherUser = enforceGoogleRateLimit('user-b', 'gmail', 1);
       const otherOperation = enforceGoogleRateLimit('user-a', 'drive', 1);
       console.log(JSON.stringify({
         first: first === null,
         status: blocked?.status,
         retryAfter: blocked?.headers.get('Retry-After'),
         otherUser: otherUser === null,
         otherOperation: otherOperation === null
       }));`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const result = JSON.parse(output);
  assert.equal(result.first, true);
  assert.equal(result.status, 429);
  assert.match(result.retryAfter, /^\d+$/);
  assert.equal(result.otherUser, true);
  assert.equal(result.otherOperation, true);
});
