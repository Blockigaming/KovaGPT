import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("Send on Enter is shared, reactive, and applied across main and project chat", () => {
  const composer = read("src/components/ChatInput.tsx");
  const preferences = read("src/lib/composer-preferences.ts");
  const storage = read("src/lib/composer-preference-storage.mjs");
  const settings = read("src/components/SettingsDialog.tsx");
  const main = read("src/routes/index.tsx");
  const project = read("src/routes/projects.$projectId.chat.$chatId.tsx");

  assert.match(composer, /useSharedSendOnEnter\(user\?\.id \?\? null\)/);
  assert.match(composer, /const effectiveSendOnEnter = sendOnEnter \?\? sharedSendOnEnter/);
  assert.match(composer, /keyCode: native\.keyCode/);
  assert.match(composer, /isCoarsePointer/);
  assert.equal(
    (main.match(/sendOnEnter=\{settings\.sendOnEnter\}/g) ?? []).length,
    0,
    "main composers must not mask reactive per-user store updates with a stale settings prop",
  );

  assert.match(preferences, /useSyncExternalStore/);
  assert.match(preferences, /listeners\.get\(scope\)\?\.forEach\(\(listener\) => listener\(\)\)/);
  assert.match(preferences, /window\.addEventListener\("storage"/);
  assert.match(preferences, /event\.key === composerPreferenceKey\(scope\)/);
  assert.match(storage, /readPersistedSendOnEnter/);
  assert.match(storage, /Migration still applies in memory/);
  assert.doesNotMatch(preferences, /useState\([^\n]*localStorage/);

  const sendSetting = settings.slice(
    settings.indexOf('title="Send on Enter"'),
    settings.indexOf('title="Send on Enter"') + 700,
  );
  assert.match(settings, /useSharedSendOnEnter\(user\?\.id \?\? null\)/);
  assert.match(sendSetting, /checked=\{sharedSendOnEnter\}/);
  assert.match(sendSetting, /setSharedSendOnEnter\(user\?\.id \?\? null, v\)/);
  assert.doesNotMatch(
    settings,
    /useEffect\(\(\) => \{[\s\S]{0,240}setSharedSendOnEnter/,
    "opening Settings must not write a stale DEFAULT_SETTINGS value into the shared store",
  );

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
  assert.match(settings, /This shared plan is managed by the Family Sharing owner/);
  assert.match(settings, /No Stripe billing account is linked/);
  assert.match(settings, /parseAllowedBillingPortalUrl\(res\.url\)/);
  assert.match(settings, /createPortalSession\(\{ data: \{\} \}\)/);
  assert.doesNotMatch(settings, /window\.open\(/);

  const portal = billing.slice(billing.indexOf("export const createPortalSession"));
  assert.match(portal, /inputValidator\(\(data: Record<string, never>\) => data\)/);
  assert.match(portal, /return_url: "https:\/\/kovagpt\.com\/"\s*,?/);
  assert.doesNotMatch(portal, /data\.environment|data\.returnUrl/);
  assert.match(billing, /parseAllowedBillingPortalUrl\(portal\.url\)/);
  assert.match(billing, /existingError/);
  assert.match(billing, /subscriptionError/);
  assert.doesNotMatch(billing, /getStripeErrorMessage/);
  assert.doesNotMatch(billing, /return \{ error: error\./);
});

test("data controls describe only the removed local-only switches", () => {
  const settings = read("src/components/SettingsDialog.tsx");

  assert.doesNotMatch(settings, /Improve the model for everyone|Help improve Kova/);
  assert.doesNotMatch(settings, /GuestToggleRow/);
  assert.match(settings, /removed model-improvement switch changed only a\s+browser-local value/);
  assert.match(settings, /was\s+not wired to an account-level or\s+AI-provider training control/);
  assert.match(
    settings,
    /removed guest training and marketing switches changed only\s+browser-local values/,
  );
  assert.doesNotMatch(settings, /Device settings are not sent to an AI provider/);
  assert.match(settings, /Deprecated local-only value retained/);
});
