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

  assert.match(project, /<ChatInput/);
  assert.doesNotMatch(project, /useSharedSendOnEnter|shouldSubmitComposerOnEnter|<Textarea/);
  assert.doesNotMatch(project, /e\.key === "Enter" && !e\.shiftKey/);
});

test("paid billing remains reachable and every unavailable state has a truthful next action", () => {
  const settings = read("src/components/SettingsDialog.tsx");
  const billing = read("src/utils/payments.functions.ts");
  const pricing = read("src/routes/pricing.tsx");

  assert.match(settings, /\{ v: "subscription", label: "Subscription"/);
  assert.doesNotMatch(
    settings,
    /hideSubscription|tabs\.filter\(\(t\) => t\.v !== "subscription"\)/,
  );
  assert.match(settings, /onClick=\{handleRestore\}/);
  assert.match(settings, /Refresh billing status/);
  assert.match(settings, /Select Refresh billing status to retry/);
  assert.match(settings, /This shared plan is managed by the Family Sharing owner/);
  assert.match(settings, /Your own .* subscription is still[\s\S]*billed and can be managed below/);
  assert.match(settings, /billing conflict was detected/i);
  assert.match(settings, /No Stripe billing account is linked/);
  assert.doesNotMatch(settings, /plan changes in the Stripe billing portal/);
  assert.match(pricing, /If plan switching is supported/);
  assert.match(pricing, /Available plan changes/);
  assert.match(settings, /parseAllowedBillingPortalUrl\(res\.url\)/);
  assert.match(settings, /createPortalSession\(\{ data: \{\} \}\)/);
  assert.match(settings, /billingPortalAvailable/);
  assert.match(settings, /self-service portal is not configured/);
  assert.doesNotMatch(settings, /window\.open\(/);

  const portal = billing.slice(billing.indexOf("export const createPortalSession"));
  assert.match(portal, /\.validator\(\(data: Record<string, never>\) => data\)/);
  assert.match(portal, /return_url: "https:\/\/kovagpt\.com\/"\s*,?/);
  assert.match(portal, /configuration/);
  assert.match(billing, /STRIPE_BILLING_PORTAL_CONFIGURATION_ID/);
  assert.doesNotMatch(portal, /data\.environment|data\.returnUrl/);
  assert.match(billing, /parseAllowedBillingPortalUrl\(portal\.url\)/);
  assert.match(billing, /existingError/);
  assert.match(billing, /activeSubscriptionCount/);
  assert.match(billing, /billingConflict/);
  assert.match(billing, /effectiveTier/);
  assert.match(billing, /summaryError/);
  assert.doesNotMatch(billing, /getStripeErrorMessage/);
  assert.doesNotMatch(billing, /return \{ error: error\./);
});

test("data controls describe the available privacy surface truthfully", () => {
  const settings = read("src/components/SettingsDialog.tsx");

  assert.doesNotMatch(settings, /Improve the model for everyone|Help improve Kova/);
  assert.doesNotMatch(settings, /GuestToggleRow/);
  assert.match(settings, />AI data controls</);
  assert.match(settings, /Model-training preferences are not available in Settings\./);
  assert.match(settings, /to="\/privacy"/);
  assert.match(settings, /how chats may be processed by KovaGPT and its AI providers/);
  assert.doesNotMatch(settings, /removed model-improvement switch/i);
  assert.doesNotMatch(settings, /removed guest training and marketing switches/i);
});

test("Settings delegates connector lifecycle to the server-backed Apps surface", () => {
  const settings = read("src/components/SettingsDialog.tsx");

  assert.match(settings, /to="\/apps"/);
  assert.match(settings, /onClick=\{\(\) => onOpenChange\(false\)\}/);
  assert.match(settings, /Manage apps and permissions/);
  assert.match(settings, /verified from the server-backed Apps page/);
  for (const obsolete of [
    "linked-accounts",
    "getLinkedAccounts",
    "connectProvider",
    "disconnectProvider",
    "CONNECTOR_CATALOG",
    "ConnectorRow",
  ]) {
    assert.doesNotMatch(settings, new RegExp(obsolete), obsolete);
  }
});
