import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const parse = (path) =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sidebar = parse("src/components/Sidebar.tsx");
const topbar = parse("src/components/MobileTopBar.tsx");
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child != null && child !== false),
  }),
};
const all = (tree) =>
  tree && typeof tree === "object" ? [tree, ...(tree.children ?? []).flatMap(all)] : [];
const text = (tree) =>
  typeof tree === "string" ? tree : (tree?.children ?? []).map(text).join(" ").trim();
function compile(source, dependencies) {
  return new Function(
    "React",
    ...Object.keys(dependencies),
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(React, ...Object.values(dependencies));
}
function findNode(file, predicate) {
  let found;
  const visit = (node) => {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(found, "The actual component node exists");
  return found;
}
const classElement = (name) =>
  findNode(
    sidebar,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) => attribute.name?.text === "className" && attribute.initializer?.text === name,
      ),
  );
function enclosingExpression(node) {
  while (!ts.isJsxExpression(node)) node = node.parent;
  return node.expression.getText(sidebar);
}
const renderSidebar = (node, dependencies) =>
  compile(`return (${node.getText(sidebar)});`, dependencies);
const emptyState = enclosingExpression(classElement("kova-sidebar-empty"));
const help = enclosingExpression(classElement("kova-sidebar-help"));
const footer = classElement("kova-sidebar-footer");
const shared = {
  hideGuestLogin: false,
  CircleHelp: "CircleHelp",
  CreditCard: "CreditCard",
  SettingsGlyph: "SettingsGlyph",
  SignInButton: "SignInButton",
  icon: (name) => React.createElement(name, {}),
  navRow: () => "kova-nav-row",
  navLink: (to, label) => React.createElement("a", { href: to }, label),
};

test("empty chat history reports one accurate state without duplicate guest copy", () => {
  for (const [isLoaded, signedIn, expected] of [
    [false, false, "Loading chats…"],
    [true, false, "Log in to view saved chats."],
    [true, true, "No saved chats yet."],
  ]) {
    const tree = compile(`return (${emptyState});`, {
      savedConversations: [],
      isLoaded,
      signedIn,
    });
    assert.equal(text(tree), expected);
  }
  assert.equal(
    compile(`return (${emptyState});`, {
      savedConversations: [{ id: "saved" }],
      isLoaded: true,
      signedIn: true,
    }),
    null,
  );
});

test("guest sidebar exposes one Help action, Subscriptions and concise login", () => {
  const calls = [];
  const dependencies = {
    ...shared,
    isLoaded: true,
    signedIn: false,
    closeAfterMobileNavigation: () => calls.push("close"),
    onOpenHelp: () => calls.push("help"),
    onOpenSettings: (tab) => calls.push(tab),
  };
  assert.equal(compile(`return (${help});`, dependencies), null);
  const tree = renderSidebar(footer, dependencies);
  const helpButtons = all(tree).filter((node) => node.type === "button" && text(node) === "Help");
  assert.equal(helpButtons.length, 1);
  helpButtons[0].props.onClick();
  assert.deepEqual(calls, ["close", "help"]);
  assert.equal(all(tree).find((node) => node.type === "a").props.href, "/pricing");
  assert.ok(all(tree).some((node) => node.type === "a" && text(node) === "Subscriptions"));
  assert.ok(all(tree).some((node) => node.type === "button" && text(node) === "Log in"));
  assert.ok(!all(tree).some((node) => node.props["aria-label"] === "Account menu"));
});

test("homepage can omit its duplicate guest login while preserving Help and Subscriptions", () => {
  const tree = renderSidebar(footer, {
    ...shared,
    hideGuestLogin: true,
    isLoaded: true,
    signedIn: false,
    closeAfterMobileNavigation() {},
    onOpenHelp() {},
    onOpenSettings() {},
  });
  assert.ok(!all(tree).some((node) => node.type === "button" && text(node) === "Log in"));
  assert.ok(all(tree).some((node) => node.type === "button" && text(node) === "Help"));
  assert.ok(all(tree).some((node) => node.type === "a" && text(node) === "Subscriptions"));
});

const mobileDeclaration = findNode(
  topbar,
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "MobileTopBar",
)
  .getText(topbar)
  .replace(/^export\s+/, "");
function renderTopbar(props = {}, user = { isLoaded: true, isSignedIn: false }) {
  return compile(`${mobileDeclaration}\nreturn MobileTopBar(props);`, {
    props,
    Button: "button",
    useUser: () => user,
    clerkEnabled: true,
    ...Object.fromEntries(
      ["PanelLeft", "MessageCircleOff", "Sliders", "SquarePen", "SignInButton", "SignUpButton"].map(
        (name) => [name, name],
      ),
    ),
  });
}

test("mobile home names KovaGPT and preserves specific destination and conversation titles", () => {
  for (const [title, expected] of [
    [undefined, "KovaGPT"],
    ["Projects", "Projects"],
    [
      "A saved conversation with a long descriptive title",
      "A saved conversation with a long descriptive title",
    ],
  ]) {
    const tree = renderTopbar({ title });
    const heading = all(tree).find((node) => "data-kova-navigation-heading" in node.props);
    assert.equal(text(heading), expected);
    assert.match(heading.props.className, /min-w-0 truncate/);
  }
});

test("mobile menu and new-chat actions preserve callbacks and expose the controlled drawer", () => {
  const calls = [];
  const tree = renderTopbar(
    { onOpenSidebar: () => calls.push("menu"), onNewChat: () => calls.push("new") },
    { isLoaded: true, isSignedIn: true },
  );
  const menu = all(tree).find((node) => node.props["aria-label"] === "Open menu");
  assert.equal(menu.props["aria-controls"], "kova-primary-navigation");
  assert.equal(menu.props["aria-haspopup"], "dialog");
  menu.props.onClick();
  all(tree)
    .find((node) => node.props["aria-label"] === "New chat")
    .props.onClick();
  assert.deepEqual(calls, ["menu", "new"]);
});

test("mobile workflow clear control keeps its disabled state and a 44px touch target", () => {
  let cleared = 0;
  const tree = renderTopbar({
    skill: { name: "Long selected workflow name", disabled: true, clear: () => cleared++ },
  });
  const control = all(tree).find((node) => node.props["aria-label"]?.startsWith("Clear workflow"));
  assert.equal(control.props.disabled, true);
  assert.match(control.props.className, /min-h-11 min-w-11/);
  assert.equal(cleared, 0);
});

test("inline chat search exposes its current expanded state and preserves toggling", () => {
  const button = findNode(
    sidebar,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sidebar) === "button" &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          attribute.name?.text === "aria-label" && attribute.initializer?.text === "Search chats",
      ),
  );
  for (const searchOpen of [false, true]) {
    let next = searchOpen;
    const tree = renderSidebar(button, {
      rail: false,
      openChatSearch: () => {
        next = !next;
      },
      searchOpen,
      onOpenWorkspaceSearch: undefined,
      setSearchOpen: (update) => (next = update(next)),
      SearchGlyph: "SearchGlyph",
    });
    assert.equal(tree.props["aria-expanded"], searchOpen);
    tree.props.onClick();
    assert.equal(next, !searchOpen);
  }
});
