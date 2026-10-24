import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import postcss from "postcss";
import {
  SIDEBAR_SHORTCUTS,
  DEFAULT_SIDEBAR_SHORTCUTS,
  readSidebarShortcuts,
  saveSidebarShortcuts,
} from "../../src/lib/sidebar-shortcuts.mjs";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const file = ts.createSourceFile(
  "Sidebar.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
const visit = (node) => {
  nodes.push(node);
  ts.forEachChild(node, visit);
};
visit(file);
const variable = (name) =>
  nodes
    .find((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name)
    .initializer.getText(file);
const rail = nodes
  .find(
    (node) =>
      ts.isConditionalExpression(node) &&
      node.condition.getText(file) === "signedIn" &&
      node.whenTrue.getText(file).includes('aria-label="Collapsed navigation"'),
  )
  .getText(file);
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter(Boolean),
  }),
};
function compile(text, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(deps));
}
function all(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...(tree.children ?? []).flatMap(all)];
}
function fixture(options = {}) {
  const calls = [];
  const deps = {
    React,
    SIDEBAR_SHORTCUTS,
    signedIn: true,
    canSchedule: true,
    mapsReleaseApproved: false,
    railShortcuts: [],
    collapsed: true,
    open: false,
    displayName: "Synthetic user",
    planLabel: "Plan",
    avatarUrl: null,
    accountInitial: "S",
    expandButtonRef: { current: null },
    drawerRef: { current: null },
    onNew: () => calls.push(["new"]),
    onToggle: () => calls.push(["toggle"]),
    onOpenWorkspaceSearch: () => calls.push(["search"]),
    setSearchOpen: (value) => calls.push(["local-search", value]),
    onOpenSettings: (tab) => calls.push(["settings", tab]),
    openRailPersonalization: (target) => calls.push(["customize", target]),
    requestAnimationFrame: (fn) => fn(),
    isOn: (to) => (options.path ?? "/") === to || (options.path ?? "/").startsWith(`${to}/`),
    ...Object.fromEntries(
      [
        "Link",
        "RailTooltip",
        "TooltipProvider",
        "NovaLogo",
        "Plus",
        "SearchGlyph",
        "MessageSquare",
        "ProjectsGlyph",
        "TasksGlyph",
        "LibraryGlyph",
        "PluginsGlyph",
        "CustomizeGlyph",
        "UserRound",
      ].map((name) => [name, name]),
    ),
    SHORTCUT_ICONS: Object.fromEntries(SIDEBAR_SHORTCUTS.map(({ id }) => [id, `icon:${id}`])),
    ...options,
  };
  deps.availableShortcuts = compile(`return (${variable("availableShortcuts")});`, deps);
  deps.railLink = compile(`return (${variable("railLink")});`, deps);
  const tree = compile(`return (${rail});`, deps);
  const find = (label) => all(tree).find((node) => node.props["aria-label"] === label);
  return { tree, calls, deps, find };
}
const primaryLabels = [
  "New chat",
  "Search",
  "Chat",
  "Projects",
  "Scheduled tasks",
  "Library",
  "Plugins",
];
const controls = (tree) => all(tree).filter(({ type }) => type === "button" || type === "Link");

for (const choices of [
  [],
  DEFAULT_SIDEBAR_SHORTCUTS,
  SIDEBAR_SHORTCUTS.map(({ id }) => id).reverse(),
]) {
  test(`mandatory primary destinations keep exact order independent of ${choices.length} stored choices`, () => {
    const f = fixture({ railShortcuts: choices });
    assert.deepEqual(
      controls(f.find("Primary destinations")).map(({ props }) => props["aria-label"]),
      primaryLabels,
    );
    assert.deepEqual(
      controls(f.find("Primary destinations"))
        .filter(({ type }) => type === "Link")
        .map(({ props }) => props.to),
      ["/", "/projects", "/scheduled-tasks", "/library", "/apps"],
    );
    for (const label of primaryLabels)
      assert.equal(controls(f.tree).filter(({ props }) => props["aria-label"] === label).length, 1);
    assert.deepEqual(f.calls, [], "rendering never resets or saves preferences");
  });
}

test("only enabled optional shortcuts follow the permanent primary group", () => {
  const f = fixture({ railShortcuts: SIDEBAR_SHORTCUTS.map(({ id }) => id) });
  assert.deepEqual(
    controls(f.find("Additional shortcuts")).map(({ props }) => props["aria-label"]),
    ["Images", "Work", "Discover"],
  );
  const approved = fixture({
    mapsReleaseApproved: true,
    railShortcuts: ["maps", "work", "images"],
  });
  assert.deepEqual(
    controls(approved.find("Additional shortcuts")).map(({ props }) => props["aria-label"]),
    ["Maps", "Work", "Images"],
  );
  assert.equal(fixture().find("Additional shortcuts"), undefined);
  assert.deepEqual(
    f.deps.availableShortcuts.map(({ id }) => id),
    ["images", "work", "discovery"],
  );
});

test("guest/auth and scheduling gates are unchanged and hidden expanded rail is inert", () => {
  assert.equal(fixture({ signedIn: false }).tree, null);
  assert.equal(fixture({ canSchedule: false }).find("Scheduled tasks"), undefined);
  const nav = fixture({ collapsed: false, open: true }).find("Collapsed navigation");
  assert.equal(nav.props["aria-hidden"], true);
  assert.equal(nav.props.inert, true);
  assert.equal(nav.props["data-state"], "closed");
  assert.match(source, /const signedIn = isLoaded && isSignedIn;/);
  assert.match(source, /const canSchedule = signedIn;/);
});

for (const [path, label] of [
  ["/", "Chat"],
  ["/projects/project-1", "Projects"],
  ["/scheduled-tasks/task-1", "Scheduled tasks"],
  ["/library", "Library"],
  ["/apps/plugin-1", "Plugins"],
  ["/images", "Images"],
  ["/work", "Work"],
  ["/discovery", "Discover"],
]) {
  test(`selected destination remains marked on ${path}`, () => {
    const f = fixture({ path, railShortcuts: ["images", "work", "discovery"] });
    assert.deepEqual(
      controls(f.tree)
        .filter(({ props }) => props["aria-current"] === "page")
        .map(({ props }) => props["aria-label"]),
      [label],
    );
    assert.match(
      f.find(label).props.className,
      /\brelative\b/,
      "2px marker is positioned on its own target",
    );
  });
}

test("New chat, Search, customization and Settings invoke their existing callbacks once", () => {
  const f = fixture();
  f.find("New chat").props.onClick();
  f.find("Search").props.onClick();
  const opener = {};
  f.find("Customize sidebar").props.onClick({ currentTarget: opener });
  f.find("Settings").props.onClick();
  assert.deepEqual(f.calls, [["new"], ["search"], ["customize", opener], ["settings", "general"]]);
});

test("Search without a workspace callback opens the existing chat search", () => {
  const f = fixture({ onOpenWorkspaceSearch: undefined });
  f.find("Search").props.onClick();
  assert.deepEqual(f.calls, [["local-search", true], ["toggle"]]);
});

test("optional switches preserve legacy stored primary IDs without migration or destructive reset", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const previous = ["projects", "library", "apps", "scheduled-tasks", "images"];
  assert.equal(saveSidebarShortcuts(storage, "owner", previous), true);
  const loaded = readSidebarShortcuts(storage, "owner");
  assert.deepEqual(loaded, previous);
  const handler = nodes
    .find(
      (node) =>
        ts.isJsxAttribute(node) &&
        node.name.getText(file) === "onCheckedChange" &&
        node.initializer.getText(file).includes("changeRailShortcuts"),
    )
    .initializer.expression.getText(file);
  let changed;
  compile(`return (${handler});`, {
    railShortcuts: loaded,
    shortcut: { id: "images" },
    changeRailShortcuts: (next) => {
      changed = next;
    },
  })(false);
  assert.deepEqual(
    changed,
    previous.filter((id) => id !== "images"),
  );
  assert.deepEqual(
    controls(fixture({ railShortcuts: changed }).find("Primary destinations")).map(
      ({ props }) => props["aria-label"],
    ),
    primaryLabels,
  );
  assert.match(source, /Choose additional shortcuts/);
  assert.match(source, /<legend>Additional shortcuts<\/legend>/);
});

test("every collapsed action is wrapped in the shared pointer-and-keyboard Tooltip primitive", () => {
  const f = fixture({
    railShortcuts: ["images", "work", "discovery", "maps"],
    mapsReleaseApproved: true,
  });
  const wrappers = all(f.tree).filter(({ type }) => type === "RailTooltip");
  assert.equal(wrappers.length, controls(f.tree).length);
  for (const wrapper of wrappers) {
    assert.equal(wrapper.props.label, controls(wrapper)[0].props["aria-label"]);
    assert.equal(
      controls(wrapper)[0].props.title,
      undefined,
      `${wrapper.props.label} must not show a second native title tooltip`,
    );
  }
  const component = nodes
    .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "RailTooltip")
    .getText(file);
  const tooltip = compile(`${component}\nreturn RailTooltip;`, {
    React,
    Tooltip: "Tooltip",
    TooltipTrigger: "TooltipTrigger",
    TooltipContent: "TooltipContent",
  })({ label: "Search", children: { type: "button", props: {}, children: [] } });
  assert.equal(tooltip.type, "Tooltip");
  assert.equal(tooltip.children[0].props.asChild, true);
  assert.equal(tooltip.children[1].props.side, "right");
  assert.equal(tooltip.children[1].children[0], "Search");
  assert.equal(f.tree.type, "TooltipProvider");
});

test("rail keeps 72px geometry, a 64px header, original 28px logo and 44px expansion target", () => {
  const f = fixture();
  assert.match(f.find("Collapsed navigation").props.className, /w-\[72px\]/);
  const header = all(f.tree).find(
    ({ type, props }) => type === "div" && props.className?.includes("h-16"),
  );
  assert.match(header.props.className, /min-h-16/);
  assert.equal(controls(header)[0].props["aria-label"], "Expand sidebar");
  const logo = all(header).find(({ type }) => type === "NovaLogo");
  assert.equal(logo.props.decorative, true);
  assert.equal(logo.props.className, "h-7 w-7");
  f.find("Expand sidebar").props.onClick({ detail: 1 });
  assert.deepEqual(f.calls, [["toggle"]]);
});

test("rail uses shared shape ownership, 44px controls and stroke 2", () => {
  const rules = [];
  postcss
    .parse(readFileSync("src/styles/sidebar-personalization.css", "utf8"))
    .walkRules((rule) => rules.push(rule));
  const property = (rule, name) => rule.nodes.findLast((node) => node.prop === name)?.value;
  const target = rules.find((rule) => rule.selector.endsWith(".kova-rail-button"));
  assert.equal(property(target, "min-width"), "44px");
  assert.equal(property(target, "min-height"), "44px");
  assert.equal(property(target, "border-radius"), undefined);
  const shared = [];
  postcss
    .parse(readFileSync("src/styles/sidebar-core.css", "utf8"))
    .walkRules((rule) => shared.push(rule));
  const shape = shared.find((rule) => rule.selector.endsWith(".kova-rail-button"));
  assert.equal(property(shape, "border-radius"), "var(--kova-radius-control)");
  assert.equal(fixture().find("Collapsed navigation").props["aria-label"], "Collapsed navigation");
  const stroke = rules.findLast(
    (rule) =>
      rule.selector.includes(
        ".kova-sidebar-rail[data-kova-refined-sidebar][data-kova-core-rail]",
      ) && rule.selector.endsWith("svg"),
  );
  assert.equal(property(stroke, "stroke-width"), "2");
});
