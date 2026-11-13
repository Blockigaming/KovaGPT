import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import postcss from "postcss";
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
const settingsStylesSource = await readFile(
  new URL("../../src/styles/settings-reference.css", import.meta.url),
  "utf8",
);
const settingsPageStylesSource = await readFile(
  new URL("../../src/styles/settings-page-layout.css", import.meta.url),
  "utf8",
);
const phoneLayouts =
  "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)";
const styleRule = (source, selector, media = null) => {
  const matches = [];
  postcss.parse(source).walkRules((rule) => {
    const selectors = rule.selectors.map((value) => value.replace(/\s+/g, " "));
    if (!selectors.includes(selector)) return;
    if (
      media === null
        ? rule.parent.type === "root"
        : rule.parent.type === "atrule" &&
          rule.parent.name === "media" &&
          rule.parent.params === media
    )
      matches.push(rule);
  });
  assert.ok(matches.length > 0, `Expected ${selector} rules in ${media ?? "the base layer"}`);
  const rule = postcss.rule({ selector });
  rule.append(matches.flatMap((match) => match.nodes.map((node) => node.clone())));
  return {
    rule,
    declarations: Object.fromEntries(
      rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
    ),
  };
};
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

test("Settings selects and Library filters expose stable accessible names", async () => {
  for (const label of ["Preferred response length", "Appearance"]) {
    assert.match(settingsSource, new RegExp(`aria-label="${label}"`));
  }
  const librarySource = await readFile(
    new URL("../../src/routes/library.tsx", import.meta.url),
    "utf8",
  );
  assert.match(librarySource, /aria-label="Filter Library items"/);
  assert.match(librarySource, /role="group" aria-label="Library filters"/);
  const toneControls = matching(
    parsed,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(parsed) === "Select" &&
      attribute(node.openingElement, "value")?.initializer?.expression?.getText(parsed) ===
        "settings.responseTone",
  );
  assert.equal(toneControls.length, 1);
  const tone = toneControls[0];
  assert.ok(ts.isJsxElement(tone.parent));
  assert.equal(tone.parent.openingElement.tagName.getText(parsed), "div");
  const trigger = matching(
    tone,
    (node) => ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "SelectTrigger",
  );
  assert.equal(trigger.length, 1);
  const triggerId = attribute(trigger[0], "id").initializer.text;
  const label = tone.parent.children.find(
    (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "label",
  );
  assert.ok(label, "The shared select retains a visible, associated label");
  assert.equal(attribute(label.openingElement, "htmlFor").initializer.text, triggerId);
  assert.equal(
    label.children
      .filter(ts.isJsxText)
      .map((node) => node.text)
      .join("")
      .trim(),
    "Tone",
  );
  const options = matching(
    tone,
    (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "SelectItem",
  ).map((node) => {
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
    execute(
      attribute(tone.openingElement, "onValueChange").initializer.expression.getText(parsed),
      {
        settings,
        onChange: (next) => (changed = next),
      },
    )(value);
    assert.deepEqual(changed, { ...settings, responseTone: value });
  }
  assert.doesNotMatch(settingsSource, /aria-label="Language"/);
});

test("signed-in settings uses searchable navigation and a purpose-built mobile drill-in", () => {
  assert.match(settingsSource, /placeholder="Search settings"/);
  assert.match(settingsSource, /No settings found/);
  assert.match(settingsSource, /const filteredGroups = normalizedQuery/);
  assert.match(settingsSource, /const queryTerms = settingsQuery/);
  assert.match(settingsSource, /tabs: group\.tabs\.filter\(matchesSettingsQuery\)/);
  assert.match(settingsSource, /aria-label="Settings navigation"/);
  assert.match(settingsSource, /aria-label="Back to settings"/);
  assert.match(settingsSource, /setMobileHome\(false\)/);
  assert.match(settingsSource, /closeLabel="Close settings"/);
  assert.match(settingsSource, /import "@\/styles\/settings-reference\.css"/);
  const hidden = styleRule(
    settingsStylesSource,
    ".kova-settings-reference :is(.kova-settings-sidebar, .kova-settings-content).mobile-hidden",
    phoneLayouts,
  ).declarations;
  assert.equal(hidden.display, "none");
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
      "Cloud Browser",
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
  const pageTabs = categories("destinationGroups");
  assert.match(settingsSource, /const groups = destinationGroups;/);
  assert.doesNotMatch(settingsSource, /const secondaryParents:|matchingSecondaryTabs/);
  assert.deepEqual(
    pageTabs.map((tab) => [sectionForTab(tab.value), tab.label]),
    [
      ["responses", "General"],
      ["appearance", "Appearance"],
      ["notifications", "Notifications"],
      ["profile", "Profile"],
      ["security", "Security and login"],
      ["email", "Account"],
      ["parental", "Parental controls"],
      ["voice", "Voice"],
      ["storage", "Storage"],
      ["privacy", "Data controls"],
      ["memory", "Personalization"],
      ["shortcuts", "Keyboard"],
      ["usage", "Usage"],
      ["connections", "Connections"],
      ["cloud-browser", "Cloud Browser"],
      ["family", "Family Center"],
      ["location", "Location"],
      ["billing", "Subscriptions"],
      ["report", "Report an issue"],
      ["help", "Help center"],
      ["about", "About"],
      ["logout", "Log out"],
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
    /navigate\(\{\s*to: "\/settings\/\$section",\s*params: \{ section: next \},\s*replace: true,\s*resetScroll: false,\s*\}\)/,
  );
  assert.match(settingsSource, /if \(page\) onSectionChange\?\.\(settingsSectionForTab\(value\)\)/);
  assert.match(settingsSource, /group\.tabs\.map\(\(\{ v, icon: Icon, label \}\) =>/);
  assert.match(settingsSource, /<TabsList className="kova-settings-nav"/);
  assert.match(settingsSource, /<TabsTrigger[\s\S]*?value=\{v\}/);
  assert.match(settingsSource, /onValueChange=\{selectTab\}/);
});

test("full-page Settings keeps reference-style navigation theme-aware and functional", () => {
  assert.match(settingsSource, /title: "Personal"/);
  assert.match(settingsSource, /label: "General",\s*icon: Cog/);
  assert.match(settingsSource, /aria-label="Send shortcut"/);
  assert.match(settingsSource, /setSharedSendOnEnter\(user\?\.id \?\? null, enabled\)/);
  assert.match(
    settingsSource,
    /className="kova-settings-reference-group kova-settings-general-options"/,
  );
  assert.match(settingsPageStylesSource, /background: var\(--background\)/);
  assert.match(settingsStylesSource, /background: var\(--surface-selected\)/);
  assert.doesNotMatch(settingsPageStylesSource, /background:\s*#(?:000|fff|000000|ffffff)\b/i);
});

test("mobile settings drill-in moves focus with the visible panel", () => {
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "content"/);
  assert.match(settingsSource, /pendingMobileFocusRef\.current = "navigation"/);
  assert.match(settingsSource, /setMobileFocusRequest\(\(request\) => request \+ 1\)/);
  assert.match(settingsSource, /\[mobileFocusRequest, mobileHome, tab\]/);
  assert.match(
    settingsSource,
    /navigationHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(settingsSource, /contentHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("usage bars bind verified plan allowances to real account counters and retain failure states", () => {
  assert.match(settingsSource, /getMyPlanUsage\(\{ data: \{ ownerId: userKey \} \}\)/);
  assert.match(settingsSource, /getSubscriptionSummary/);
  assert.match(settingsSource, /<PlanUsageBars usage=\{usage\}/);
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
  const { declarations, rule } = styleRule(settingsStylesSource, ".kova-settings-reference");
  assert.equal(declarations.background, "var(--background)");
  assert.equal(declarations.color, "var(--foreground)");
  assert.ok(
    !declarations["transition-property"] ||
      declarations["transition-property"] === "opacity, transform",
  );
  assert.doesNotMatch(
    rule.toString(),
    /transition-property:[^;]*(?:all|background|color|border)/,
    "Settings theme colors must switch atomically instead of interpolating",
  );
  assert.match(
    settingsSource,
    /kova-settings-dialog kova-settings-reference[^`]*bg-\[var\(--surface-modal\)\]/,
  );
  assert.doesNotMatch(stylesSource, /\.kova-settings-dialog\s*\{/);
});

test("authenticated modal sizing, full-page Settings, and phone safe-area ownership stay distinct", () => {
  const auth = styleRule(
    settingsStylesSource,
    '[role="dialog"].kova-settings-dialog.is-authenticated',
  ).declarations;
  assert.equal(auth.width, "min(980px, calc(100vw - 48px))");
  assert.equal(auth.height, "min(760px, calc(100dvh - 48px))");
  assert.equal(auth["max-height"], "calc(100dvh - 48px)");
  assert.match(settingsSource, /const Surface = page \? SettingsPageContent : DialogContent/);
  assert.match(settingsSource, /loggedIn \? "is-authenticated" : "is-guest"/);
  const page = styleRule(
    settingsPageStylesSource,
    ".kova-settings-route section.kova-settings-page.kova-settings-dialog",
  ).declarations;
  assert.equal(page.position, "relative");
  assert.equal(page.width, "100%");
  assert.equal(page.height, "100%");
  assert.equal(
    styleRule(settingsPageStylesSource, ".kova-settings-route.kova-secondary-page").declarations
      .flex,
    "1",
  );
  assert.equal(page["max-height"], "none");
  assert.equal(page.background, "var(--background)");
  for (const selector of [
    '[role="dialog"].kova-settings-dialog',
    '[role="dialog"].kova-settings-dialog.is-authenticated',
  ]) {
    const { declarations } = styleRule(settingsStylesSource, selector, phoneLayouts);
    for (const [property, value] of Object.entries({
      inset: "0",
      width: "100%",
      height: "100dvh",
      transform: "none",
      translate: "none",
    }))
      assert.equal(declarations[property], value);
    assert.ok(
      !declarations["padding-top"] && !declarations["padding-bottom"],
      "Safe areas belong to the visible scroll pane, not an extra fullscreen inset",
    );
  }
  const sidebar = styleRule(
    settingsStylesSource,
    ".kova-settings-reference .kova-settings-sidebar",
    phoneLayouts,
  ).declarations;
  const header = styleRule(
    settingsStylesSource,
    ".kova-settings-reference .kova-settings-content-header",
    phoneLayouts,
  ).declarations;
  assert.match(sidebar.padding, /--safe-top/);
  assert.match(sidebar.padding, /--safe-bottom/);
  assert.match(header.padding, /--safe-top/);
  const panel = styleRule(
    settingsStylesSource,
    '.kova-settings-reference .kova-settings-content > [role="tabpanel"]',
    phoneLayouts,
  ).declarations;
  assert.equal(
    panel.padding,
    "0 16px max(32px, var(--safe-bottom, 0px))",
    "The content scroll pane owns its bottom safe area",
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
