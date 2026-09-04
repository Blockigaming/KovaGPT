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
    "Settings section",
    "Preferred response length",
    "Response tone",
    "Filter library by item type",
    "Appearance",
  ]) {
    assert.match(settingsSource, new RegExp(`aria-label="${label}"`));
  }
  assert.doesNotMatch(settingsSource, /aria-label="Language"/);
});

test("signed-in mobile navigation uses a grouped section picker", () => {
  assert.match(
    settingsSource,
    /kova-settings-mobile-nav[\s\S]*?<Select value=\{tab\} onValueChange=\{setTab\}>/,
  );
  assert.match(settingsSource, /TAB_GROUPS\.map\(\(group\) => \([\s\S]*?<SelectGroup/);
  assert.match(settingsSource, /<SelectLabel[\s\S]*?\{group\.title\}/);
  assert.match(
    settingsSource,
    /<SelectItem[\s\S]*?key=\{v\}[\s\S]*?value=\{v\}[\s\S]*?className="kova-settings-mobile-section-option min-h-11 md:min-h-8"/,
    "portaled mobile section options must keep a 44px target without forcing desktop density",
  );
  assert.doesNotMatch(settingsSource, /TAB_GROUPS\.flatMap/);
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
    /if \(portalLoading \|\| !subSummary\?\.hasBillingAccount\) return;/,
  );
  assert.match(settingsSource, /const portalUrl = parseAllowedBillingPortalUrl\(res\.url\);/);
  assert.match(settingsSource, /!subSummary\?\.hasBillingAccount \|\|\s+inheritedSubscription/);
});
