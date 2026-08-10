import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/routes/api/public/help-submit.ts", "utf8");
const notification = await readFile(
  "src/lib/email-templates/help-contact-notification.tsx",
  "utf8",
);
const retiredTransactionalSend = await readFile(
  "src/routes/lovable/email/transactional/send.ts",
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

test("legacy dynamic-recipient email route is permanently fail-closed", () => {
  assert.match(retiredTransactionalSend, /status:\s*410/);
  assert.match(retiredTransactionalSend, /legacy_email_provider_retired/);
  assert.match(retiredTransactionalSend, /"Cache-Control":\s*"no-store"/);
  assert.doesNotMatch(retiredTransactionalSend, /email_confirmed_at|requested\s*!==\s*ownEmail/);
  assert.doesNotMatch(retiredTransactionalSend, /sendEmail|enqueue|LOVABLE_|@lovable\.dev/iu);
});
