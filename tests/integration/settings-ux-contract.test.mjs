import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { parseAllowedBillingPortalUrl } from "../../src/lib/billing-portal-url.mjs";

const settingsSource = await readFile(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const settingsModelSource = await readFile(
  new URL("../../src/lib/settings-types.ts", import.meta.url),
  "utf8",
);
const parsedModel = ts.createSourceFile(
  "settings-types.ts",
  settingsModelSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const stylesSource = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8");
const browserSource = await readFile(
  new URL("../e2e/settings-theme-transition.spec.ts", import.meta.url),
  "utf8",
);
const routeSource = await readFile(
  new URL("../../src/routes/settings.$section.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "SettingsDialog.tsx",
  settingsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const matching = (root, predicate) => {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
};
const variable = (name, root = parsed) => {
  const matches = matching(
    root,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(root) === name,
  );
  assert.equal(matches.length, 1, `Expected one ${name} declaration`);
  return matches[0];
};
const property = (node, name) =>
  node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === name)
    ?.initializer;
const attribute = (node, name) =>
  node.attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText() === name,
  );
const execute = (expression, dependencies = {}) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(`return (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(dependencies));

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
  for (const label of ["Preferred response length", "Filter library by item type", "Appearance"]) {
    assert.match(settingsSource, new RegExp(`aria-label="${label}"`));
  }
  const toneControls = matching(
    parsed,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(parsed) === "select" &&
      attribute(node.openingElement, "value")?.initializer?.expression?.getText(parsed) ===
        "settings.responseTone",
  );
  assert.equal(toneControls.length, 1);
  const tone = toneControls[0];
  assert.ok(ts.isJsxElement(tone.parent));
  assert.equal(tone.parent.openingElement.tagName.getText(parsed), "label");
  assert.equal(
    tone.parent.children
      .filter(ts.isJsxText)
      .map((node) => node.text)
      .join("")
      .trim(),
    "Tone",
    "The native select must retain its actual visible, enclosing accessible label",
  );
  const options = tone.children.filter(ts.isJsxElement).map((node) => {
    assert.equal(node.openingElement.tagName.getText(parsed), "option");
    return [
      attribute(node.openingElement, "value").initializer.text,
      node.children
        .filter(ts.isJsxText)
        .map((child) => child.text)
        .join("")
        .trim(),
    ];
  });
  assert.deepEqual(options, [
    ["direct", "Direct"],
    ["formal", "Formal"],
    ["conversational", "Conversational"],
  ]);
  assert.equal(
    property(variable("DEFAULT_SETTINGS", parsedModel).initializer, "responseTone").text,
    "direct",
  );
  for (const [value] of options) {
    const settings = { responseTone: "direct", responseLength: "short" };
    let changed;
    execute(attribute(tone.openingElement, "onChange").initializer.expression.getText(parsed), {
      settings,
      onChange: (next) => (changed = next),
    })({ target: { value } });
    assert.deepEqual(changed, { ...settings, responseTone: value });
  }
  assert.doesNotMatch(settingsSource, /aria-label="Language"/);
});

test("signed-in settings uses searchable navigation and a purpose-built mobile drill-in", () => {
  assert.match(settingsSource, /placeholder="Search settings"/);
  assert.match(settingsSource, /No settings found/);
  assert.match(settingsSource, /const filteredGroups = normalizedQuery/);
  assert.match(settingsSource, /item\.v === tab \|\| matchesSettingsQuery\(item\)/);
  assert.match(settingsSource, /aria-label="Settings navigation"/);
  assert.match(settingsSource, /aria-label="Back to settings"/);
  assert.match(settingsSource, /setMobileHome\(false\)/);
  assert.match(settingsSource, /closeLabel="Close settings"/);
  assert.match(stylesSource, /\.kova-settings-sidebar\.mobile-hidden/);
  assert.match(stylesSource, /\.kova-settings-content\.mobile-hidden/);
});

test("settings navigation is centralized and routes every rendered category", () => {
  const categories = (name) =>
    matching(variable(name), ts.isObjectLiteralExpression)
      .filter((node) => property(node, "v") && property(node, "label"))
      .map((node) => ({ value: property(node, "v").text, label: property(node, "label").text }));
  const dialogTabs = categories("TAB_GROUPS");
  assert.deepEqual(
    dialogTabs.map((tab) => tab.label),
    [
      "Responses",
      "Profile",
      "Memory",
      "Subscriptions",
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
    ],
  );
  const panels = matching(
    parsed,
    (node) => ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "TabsContent",
  ).map((node) => attribute(node, "value")?.initializer?.text);
  for (const tab of dialogTabs)
    assert.equal(panels.filter((value) => value === tab.value).length, 1, tab.label);

  const sections = execute(
    variable("SETTINGS_SECTIONS", parsedModel).initializer.getText(parsedModel),
  );
  const sectionFunction = matching(
    parsedModel,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "settingsSectionForTab",
  );
  assert.equal(sectionFunction.length, 1);
  const sectionForTab = execute(sectionFunction[0].getText(parsedModel).replace(/^export\s+/, ""), {
    SETTINGS_SECTIONS: sections,
  });
  const pageTabs = categories("pageGroups");
  assert.deepEqual(
    pageTabs.map((tab) => sectionForTab(tab.value)),
    [
      "profile",
      "appearance",
      "responses",
      "notifications",
      "connections",
      "privacy",
      "usage",
      "billing",
    ],
  );
  for (const tab of pageTabs) {
    assert.equal(sections[sectionForTab(tab.value)], tab.value);
    assert.equal(panels.filter((value) => value === tab.value).length, 1, tab.label);
  }
  assert.match(routeSource, /initialTab=\{tab\}/);
  assert.match(routeSource, /SETTINGS_SECTIONS\[section as keyof typeof SETTINGS_SECTIONS\]/);
  assert.match(
    routeSource,
    /navigate\(\{ to: "\/settings\/\$section", params: \{ section: next \} \}\)/,
  );
  assert.match(settingsSource, /if \(page\) onSectionChange\?\.\(settingsSectionForTab\(value\)\)/);
  assert.match(settingsSource, /group\.tabs\.map\(\(\{ v, icon: Icon, label \}\) =>/);
  assert.match(settingsSource, /<TabsList className="kova-settings-nav"/);
  assert.match(settingsSource, /<TabsTrigger[\s\S]*?value=\{v\}/);
  assert.match(settingsSource, /onValueChange=\{selectTab\}/);
});

test("mobile settings drill-in moves focus with the visible panel", () => {
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "content"/);
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "navigation"/);
  assert.match(settingsSource, /setMobileFocusRequest\(\(request\) => request \+ 1\)/);
  assert.match(settingsSource, /\[mobileFocusRequest, mobileHome, tab\]/);
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

test("workspace sizing is authenticated-only and mobile safe areas are applied once", () => {
  assert.match(
    stylesSource,
    /\.kova-settings-dialog\.is-authenticated\s*\{[\s\S]*?width: min\(92vw, 1280px\)/,
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 767px\)[\s\S]*?\.kova-settings-dialog\s*\{[\s\S]*?width: 100vw !important;[\s\S]*?height: 100dvh !important;/,
  );
  const finalMobileRules = stylesSource.slice(
    stylesSource.lastIndexOf("@media (max-width: 767px)"),
  );
  assert.doesNotMatch(
    finalMobileRules,
    /\.kova-settings-(?:sidebar|content-header|content > \[role="tabpanel"\])[^}]*var\(--safe-(?:top|bottom)\)/s,
  );
});

test("Settings polish retains the billing portal safety gates", async () => {
  const fixture = (overrides = {}, response = { url: "https://billing.stripe.com/test" }) => {
    const calls = [],
      events = [];
    const scope = { current: { epoch: 1, view: 1 } };
    const dependencies = {
      open: true,
      loggedIn: true,
      portalLoading: false,
      portalPendingRef: { current: false },
      subSummary: { hasBillingAccount: true, billingPortalAvailable: true },
      billingScopeRef: scope,
      billingIsCurrent: (epoch) => epoch === scope.current.epoch,
      createPortalSession: async (input) => {
        calls.push(input);
        return response;
      },
      parseAllowedBillingPortalUrl,
      setPortalLoading: (value) => events.push(["loading", value]),
      window: { location: { assign: (value) => events.push(["redirect", value]) } },
      toast: { error: (message) => events.push(["error", message]) },
      ...overrides,
    };
    return {
      calls,
      events,
      run: execute(variable("handleManageBilling").initializer.getText(parsed), dependencies),
    };
  };
  for (const overrides of [
    { open: false },
    { loggedIn: false },
    { portalPendingRef: { current: true } },
    { portalLoading: true },
    { subSummary: null },
    { subSummary: { hasBillingAccount: false, billingPortalAvailable: true } },
    { subSummary: { hasBillingAccount: true, billingPortalAvailable: false } },
  ]) {
    const f = fixture(overrides);
    await f.run();
    assert.deepEqual(f.calls, [], JSON.stringify(overrides));
    assert.deepEqual(f.events, [], "A rejected gate cannot navigate or start loading");
  }
  const allowed = fixture();
  await allowed.run();
  assert.deepEqual(allowed.calls, [{ data: {} }]);
  assert.deepEqual(allowed.events, [
    ["loading", true],
    ["redirect", "https://billing.stripe.com/test"],
    ["loading", false],
  ]);
  for (const response of [
    { url: "https://untrusted.invalid/test" },
    { error: "provider failure" },
  ]) {
    const f = fixture({}, response);
    await f.run();
    assert.deepEqual(f.events, [
      ["loading", true],
      ["error", "The billing portal couldn't be opened. Try again."],
      ["loading", false],
    ]);
  }
  assert.match(settingsSource, /const portalUrl = parseAllowedBillingPortalUrl\(res\.url\);/);
  assert.match(
    settingsSource,
    /!subSummary\?\.hasBillingAccount[\s\S]{0,180}inheritedSubscription/,
  );
});
