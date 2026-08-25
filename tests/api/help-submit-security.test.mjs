import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/routes/api/public/help-submit.ts", "utf8");
const notification = await readFile(
  "src/lib/email-templates/help-contact-notification.tsx",
  "utf8",
);
test("public support submission can enqueue only a fixed internal recipient", () => {
  assert.match(notification, /to:\s*"help@kovagpt\.com"/);
  assert.match(route, /if \(!entry\.to\)/);
  assert.match(route, /const recipient = entry\.to\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /templateName:\s*"help-contact-notification"/);
  assert.doesNotMatch(route, /templateName:\s*"help-contact-autoreply"/);
  assert.doesNotMatch(route, /to:\s*body\.email/);
  assert.doesNotMatch(route, /args\.to/);
});

test("support payload remains bounded and retains the reply address", () => {
  assert.match(route, /MAX_BODY_BYTES = 32 \* 1024/);
  assert.match(route, /new TextEncoder\(\)\.encode\(rawText\)\.byteLength/);
  assert.match(route, /email:\s*z\.string\(\)\.trim\(\)\.email\(\)/);
  assert.match(route, /data:\s*body/);
});

test("legacy Lovable email runtime is absent", () => {
  assert.equal(existsSync("src/routes/lovable"), false);
  assert.equal(existsSync("src/lib/legacy-lovable-route.ts"), false);
});
