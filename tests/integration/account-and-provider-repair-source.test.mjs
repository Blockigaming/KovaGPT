import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const billingDeletion = await readFile("src/lib/stripe-account-deletion.mjs", "utf8");
const account = await readFile("src/routes/api/account.ts", "utf8");
const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
const write = await readFile("src/routes/api/write.ts", "utf8");
const image = await readFile("src/routes/api/generate-image.ts", "utf8");
const stripe = await readFile("src/lib/stripe.server.ts", "utf8");
const paymentWebhook = await readFile("src/routes/api/public/payments/webhook.ts", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");

test("account deletion is authenticated, explicit, billing-safe, and server executed", () => {
  assert.match(account, /requireUser\(request\)/);
  assert.match(account, /confirmation !== "DELETE"/);
  assert.match(account, /retireStripeCustomerForAccountDeletion\(billing\)/);
  assert.match(billingDeletion, /subscriptions\.cancel/);
  assert.match(account, /auth\.admin\.deleteUser\(\s*auth\.userId/u);
  assert.match(account, /irreversible/);
  assert.doesNotMatch(account, /releaseAccountExportDeletionFence/);
  assert.match(settings, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  assert.match(settings, /deleteConfirmation !== "DELETE"/);
  assert.match(settings, /setDeleteAccountOpen\(true\)/);
});

test("manual chat retry removes the failed turn before resending it", () => {
  assert.match(home, /m\.id !== assistantMsg\.id && m\.id !== userMsg\.id/);
});

test("writing validates bounded input and provider availability before charging quota", () => {
  assert.match(write, /MAX_BODY = 64 \* 1024/);
  assert.match(write, /invalid_action/);
  assert.match(write, /invalid_tone/);
  assert.ok(
    write.indexOf("missingAiProviderResponse()") < write.indexOf('enforceQuota(auth, "chats"'),
    "provider availability must be checked before quota is consumed",
  );
});

test("image and payment webhook parse failures return truthful bounded errors", () => {
  assert.match(image, /readResponseBytesBounded\([\s\S]{0,150}16 \* 1024/u);
  assert.match(image, /throw new ImageInputError\("Invalid image request JSON\."\)/u);
  assert.match(
    image,
    /error instanceof ImageInputError\) return json\(\{ error: error\.message \}, error\.status\)/u,
  );
  assert.match(stripe, /maxBodyBytes = 2 \* 1024 \* 1024/);
  assert.match(paymentWebhook, /invalid_environment/);
  assert.doesNotMatch(paymentWebhook, /received: true, ignored: "invalid env"/);
});
