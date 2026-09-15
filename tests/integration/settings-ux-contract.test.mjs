import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsSource = await readFile(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8");
const browserSource = await readFile(
  new URL("../e2e/settings-theme-transition.spec.ts", import.meta.url),
  "utf8",
);

test("signed-out storage copy matches the implemented guest lifecycle", () => {
  assert.match(settingsSource, /Signed-out chats stay in this tab until you refresh or close it\./);
  assert.match(
    settingsSource,
    /Your appearance\s+preference remains in this browser, but nothing here is synced to an account\./,
  );
  assert.doesNotMatch(settingsSource, /kova-guest-language/);
  assert.doesNotMatch(settingsSource, /cleared when (?:the )?tab closes/i);
  assert.doesNotMatch(settingsSource, /chats and preferences stay only until/i);
});

test("Settings select controls expose stable accessible names", () => {
  for (const label of [
    "Preferred response length",
    "Response tone",
    "Filter library by item type",
    "Appearance",
  ]) {
    assert.match(settingsSource, new RegExp(`aria-label="${label}"`));
  }
  assert.doesNotMatch(settingsSource, /aria-label="Language"/);
});

test("signed-in settings uses searchable navigation and a purpose-built mobile drill-in", () => {
  assert.match(settingsSource, /placeholder="Search settings"/);
  assert.match(settingsSource, /No settings found/);
  assert.match(settingsSource, /const filteredGroups = normalizedQuery/);
  assert.match(settingsSource, /aria-label="Settings navigation"/);
  assert.match(settingsSource, /aria-label="Back to settings"/);
  assert.match(settingsSource, /setMobileHome\(false\)/);
  assert.match(settingsSource, /closeLabel="Close settings"/);
  assert.match(stylesSource, /\.kova-settings-sidebar\.mobile-hidden/);
  assert.match(stylesSource, /\.kova-settings-content\.mobile-hidden/);
});

test("settings navigation is centralized and routes every rendered category", () => {
  for (const category of [
    "General",
    "Personalization",
    "Memory",
    "Billing",
    "Usage",
    "Email",
    "Appearance",
    "Notifications",
    "Keyboard shortcuts",
    "Location",
    "Parental controls",
    "Safety & security",
    "Data control",
    "Storage",
    "Apps",
    "Family Center",
    "Report an issue",
    "Help center",
    "About",
    "Log out",
  ])
    assert.ok(settingsSource.includes(`label: "${category}"`), category);
  assert.match(settingsSource, /group\.tabs\.map\(\(\{ v, icon: Icon, label \}\) =>/);
  assert.match(settingsSource, /<TabsList className="kova-settings-nav"/);
  assert.match(settingsSource, /<TabsTrigger[\s\S]*?value=\{v\}/);
  assert.match(settingsSource, /onValueChange=\{selectTab\}/);
});

test("mobile settings drill-in moves focus with the visible panel", () => {
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "content"/);
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "navigation"/);
  assert.match(settingsSource, /settingsSearchRef\.current\?\.focus\(\)/);
  assert.match(settingsSource, /contentHeadingRef\.current\?\.focus\(\)/);
});

test("usage and billing preserve real data states without invented allowances", () => {
  assert.match(settingsSource, /getMyDailyUsage\(\)/);
  assert.match(settingsSource, /getSubscriptionSummary/);
  assert.match(settingsSource, /usage\.chats/);
  assert.match(settingsSource, /usage\.images/);
  assert.match(settingsSource, /usage\.uploads/);
  assert.match(settingsSource, /does not currently[\s\S]*account allowance total/);
  assert.match(settingsSource, /Loading usage/);
  assert.match(settingsSource, /Usage data isn't available right now/);
  assert.doesNotMatch(settingsSource, /52%/);
});

test("authenticated Settings fixture follows the tested deployment's Supabase project", () => {
  assert.doesNotMatch(browserSource, /mfbycmbjygcfkrsuepxf/);
  assert.ok(
    browserSource.includes(
      "const supabaseAuthStorageKeyPattern = /^sb-([a-z0-9]{20})-auth-token$/;",
    ),
  );
  assert.ok(
    browserSource.includes(
      "const supabaseRequestPattern = /^https:\\/\\/[a-z0-9]{20}\\.supabase\\.co(?:\\/|$)/;",
    ),
  );
  assert.match(
    browserSource,
    /Storage\.prototype\.getItem = function[\s\S]*?storageKeyPattern\.exec/,
  );
  assert.match(browserSource, /mockedBackendOrigins\.add\(url\.origin\)/);
  assert.match(
    browserSource,
    /expect\(\[\.\.\.mockedBackendOrigins\]\)\.toEqual\(\[`https:\/\/\$\{storageMatch!\[1\]\}\.supabase\.co`\]\)/,
  );
});

test("data controls avoid internal migration language", () => {
  assert.match(settingsSource, />AI data controls</);
  assert.match(settingsSource, /Model-training preferences are not available in Settings\./);
  assert.doesNotMatch(settingsSource, /removed model-improvement switch/i);
  assert.doesNotMatch(settingsSource, /removed guest training and marketing switches/i);
  assert.doesNotMatch(settingsSource, /retained only for safe import compatibility/i);
});

test("theme changes cannot interpolate the Settings surface colors", () => {
  const rule = [...stylesSource.matchAll(/\.kova-settings-dialog\s*\{([\s\S]*?)\}/g)]
    .map((match) => match[1])
    .find((candidate) => candidate.includes("transition-property"));
  assert.ok(rule, "expected the scoped Settings dialog rule");
  assert.match(rule, /background-color:\s*var\(--surface-modal\)/);
  assert.match(rule, /color:\s*var\(--popover-foreground\)/);
  assert.match(rule, /transition-property:\s*opacity,\s*transform\s*;/);
  assert.doesNotMatch(
    rule,
    /transition-property:[^;]*(?:all|background|color|border)/,
    "Settings theme colors must switch atomically instead of interpolating",
  );
  assert.match(settingsSource, /kova-settings-surface[^"]*bg-\[var\(--surface-modal\)\]/);
});

test("Settings polish retains the billing portal safety gates", () => {
  assert.match(
    settingsSource,
    /if \(portalLoading \|\| !subSummary\?\.hasBillingAccount \|\| !subSummary\.billingPortalAvailable\)/,
  );
  assert.match(settingsSource, /const portalUrl = parseAllowedBillingPortalUrl\(res\.url\);/);
  assert.match(
    settingsSource,
    /!subSummary\?\.hasBillingAccount[\s\S]{0,180}inheritedSubscription/,
  );
});
