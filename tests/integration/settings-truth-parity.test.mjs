import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("Send on Enter is shared, reactive, and applied across main and project chat", () => {
  const composer = read("src/components/ChatInput.tsx");
  const preferences = read("src/lib/composer-preferences.ts");
  const main = read("src/routes/index.tsx");
  const project = read("src/routes/projects.$projectId.chat.$chatId.tsx");

  assert.match(composer, /useSharedSendOnEnter\(user\?\.id \?\? null\)/);
  assert.match(
    composer,
    /const effectiveSendOnEnter = sendOnEnter \?\? sharedSendOnEnter/,
  );
  assert.match(composer, /keyCode: native\.keyCode/);
  assert.match(composer, /isCoarsePointer/);
  assert.equal(
    (main.match(/sendOnEnter=\{settings\.sendOnEnter\}/g) ?? []).length,
    2,
  );

  assert.match(preferences, /useSyncExternalStore/);
  assert.match(preferences, /window\.addEventListener\("storage"/);
  assert.match(preferences, /One-time migration/);
  assert.doesNotMatch(preferences, /useState\([^\n]*localStorage/);

  assert.match(project, /useSharedSendOnEnter\(user\?\.id \?\? null\)/);
  assert.match(project, /shouldSubmitComposerOnEnter/);
  assert.match(project, /isMobileLayout: !isDesktop/);
  assert.doesNotMatch(project, /e\.key === "Enter" && !e\.shiftKey/);
});

test("paid billing remains reachable and every unavailable state has a truthful next action", () => {
  const settings = read("src/components/SettingsDialog.tsx");
  const billing = read("src/utils/payments.functions.ts");

  assert.match(settings, /\{ v: "subscription", label: "Subscription"/);
  assert.doesNotMatch(
    settings,
    /hideSubscription|tabs\.filter\(\(t\) => t\.v !== "subscription"\)/,
  );
  assert.match(settings, /onClick=\{handleRestore\}/);
  assert.match(settings, /Refresh billing status/);
  assert.match(settings, /Select Refresh billing status to retry/);
  assert.match(
    settings,
    /This shared plan is managed by the Family Sharing owner/,
  );
  assert.match(settings, /No Stripe billing account is linked/);
  assert.match(settings, /parseAllowedBillingPortalUrl\(res\.url\)/);
  assert.doesNotMatch(settings, /window\.open\(/);

  assert.match(billing, /parseAllowedBillingPortalUrl\(portal\.url\)/);
  assert.match(billing, /existingError/);
  assert.match(billing, /subscriptionError/);
  assert.doesNotMatch(billing, /getStripeErrorMessage/);
  assert.doesNotMatch(billing, /return \{ error: error\./);
});

test("data controls do not present device values as provider controls", () => {
  const settings = read("src/components/SettingsDialog.tsx");

  assert.doesNotMatch(
    settings,
    /Improve the model for everyone|Help improve Kova/,
  );
  assert.doesNotMatch(settings, /GuestToggleRow/);
  assert.match(
    settings,
    /does not expose an account-level model-training switch/,
  );
  assert.match(settings, /Device settings\s+are not sent to an AI provider/);
  assert.match(
    settings,
    /does not present browser\s+switches as account-level or AI-provider controls/,
  );
  assert.match(settings, /Deprecated local-only value retained/);
});
