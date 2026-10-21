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

test("account deletion is authenticated, explicit, billing-safe, and server executed", async () => {
  assert.match(account, /makeAccountLifecycleHandlers\(\{ authenticate: requireUser \}\)/);
  assert.doesNotMatch(account, /auth\.admin\.deleteUser|retireStripeCustomer|cleanupOwnedStorage/);
  const [lifecycle, policy, worker, finalizer] = await Promise.all([
    readFile("src/lib/account-lifecycle-handlers.mjs", "utf8"),
    readFile("src/lib/account-lifecycle-policy.mjs", "utf8"),
    readFile("src/lib/account-deletion-worker.server.ts", "utf8"),
    readFile("src/lib/account-deletion-finalizer.server.ts", "utf8"),
  ]);
  assert.match(lifecycle, /await authenticate\(request\)/);
  assert.match(lifecycle, /X-Kova-Expected-User/);
  assert.match(lifecycle, /confirmation !== "DELETE"/);
  assert.match(lifecycle, /auth\.authProvider !== "supabase"/);
  assert.match(lifecycle, /scheduleAccountPolicyDeletion\(auth\.supabaseAdmin, auth\.userId\)/);
  assert.match(lifecycle, /recoverAccountPolicy\(auth\.supabaseAdmin, auth\.userId\)/);
  assert.doesNotMatch(
    lifecycle,
    /auth\.admin\.deleteUser|retireStripeCustomer|cleanupOwnedStorage/,
  );
  assert.match(policy, /ACCOUNT_RECOVERY_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(policy, /recovery - scheduled !== ACCOUNT_RECOVERY_MS/);
  const dueAt = policy.indexOf('"kova_policy_due_deletions"');
  const claimAt = policy.indexOf('"kova_policy_begin_finalization"');
  const finalizeAt = policy.indexOf("await finalize(userId, claim)");
  assert.ok(dueAt >= 0 && claimAt > dueAt && finalizeAt > claimAt);
  assert.match(worker, /runAccountPolicyFinalizerBatch/);
  assert.match(worker, /finalizeAccountAfterRecovery/);
  assert.match(finalizer, /retireStripeCustomerForAccountDeletion\(billing\)/);
  assert.match(finalizer, /auth\.admin\.deleteUser\(auth\.userId\)/u);
  assert.match(finalizer, /irreversible/);
  assert.doesNotMatch(finalizer, /releaseAccountExportDeletionFence/);
  assert.match(billingDeletion, /subscriptions\.cancel/);
  assert.match(settings, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  assert.match(settings, /requestAccountDeletion\(deletionUserKey, "PATCH"\)/);
  assert.match(settings, /deleteConfirmation !== "DELETE"/);
  assert.match(settings, /setDeleteAccountOpen\(true\)/);
});

test("manual chat retry removes the failed turn before resending it", () => {
  assert.match(home, /const retryHistory = active\.messages\.slice\(0, -2\)/);
  assert.match(home, /const priorMessages =\s*retryHistory \?\?/);
  assert.match(home, /messages: \[\.\.\.priorMessages, userMsg, assistantMsg\]/);
  assert.match(home, /id: requestId \?\? newId\(\)/);
  assert.doesNotMatch(home, /canAutoRetry|MAX_AUTO_RETRIES/);
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
