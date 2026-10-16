import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createHookHarness, loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/core-launch-policy.mjs";

test("core navigation retains deep customer journeys and excludes deferred or external destinations", () => {
  for (const path of [
    "/",
    "/c/saved-id",
    "/c/id/canvas/doc",
    "/projects/id",
    "/files?sort=new",
    "/apps",
    "/auth/callback",
    "/privacy",
    "/terms",
    "/scheduled-tasks",
    "/work",
    "/discovery?mode=web",
  ])
    assert.equal(policy.isCoreLaunchRoute(path), true, path);
  for (const path of [
    "/academy",
    "/blog/post",
    "//other.example/files",
    "https://other.example/",
    null,
    "/file-spoof",
  ])
    assert.equal(policy.isCoreLaunchRoute(path), false, String(path));
});

test("every tier gets an inactive brand label and stale effort resets without an inference request", () => {
  for (const tier of ["free", "plus", "pro"]) {
    const hooks = createHookHarness();
    const changes = [];
    const { ResponsiveModelSelector } = loadUiModule("src/components/ResponsiveModelSelector.tsx", {
      react: hooks.react,
      "@/lib/core-launch-policy.mjs": policy,
      "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
    });
    const tree = hooks.render(ResponsiveModelSelector, {
      mode: "ultra",
      userTier: tier,
      onChange: (mode) => changes.push(mode),
    });
    assert.equal(text(tree).trim(), "KovaGPT");
    assert.equal(
      elements(tree, (node) => node.type === "button" || node.props.role === "dialog").length,
      0,
    );
    assert.deepEqual(changes, ["instant"]);
    hooks.unmount();
  }
});

function sidebar(signedIn, tier = "plus") {
  const hooks = createHookHarness();
  const events = [];
  const dependencies = {
    react: { ...hooks.react, lazy: () => "ChatProjectDialog", Suspense: "Suspense" },
    "lucide-react": new Proxy({}, { get: (_, key) => String(key) }),
    "@tanstack/react-router": { Link: "Link", useRouterState: () => "/" },
    "@/components/auth/ClerkSafe": {
      SignInButton: "SignInButton",
      useUser: () => ({
        isLoaded: true,
        isSignedIn: signedIn,
        user: signedIn ? { id: "owner", firstName: "Owner" } : null,
      }),
    },
    "@/hooks/useTier": { useTier: () => ({ tier }) },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
    "@/lib/conversation-search": {
      searchConversations: (items) => items.map((conversation) => ({ conversation })),
    },
    "@/components/ui/dropdown-menu": new Proxy({}, { get: (_, key) => String(key) }),
  };
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  const document = new EventTarget();
  const { Sidebar } = loadUiModule("src/components/Sidebar.tsx", dependencies, {
    window,
    document,
  });
  const tree = hooks.render(Sidebar, {
    conversations: signedIn
      ? [{ id: "saved", title: "Saved chat", pinned: true, updatedAt: 1 }]
      : [],
    activeId: null,
    open: true,
    onSelect: (id) => events.push(["select", id]),
    onNew: () => events.push(["new"]),
    onDelete() {},
    onToggle() {},
    onOpenSettings: (tab) => events.push(["settings", tab]),
    onOpenHelp() {},
  });
  return { tree, events, hooks };
}

test("core sidebar keeps real navigation and invokes new, settings and saved-history actions", () => {
  const { tree, events, hooks } = sidebar(true);
  const routes = elements(tree, (node) => node.type === "Link").map((node) => node.props.to);
  for (const route of [
    "/images",
    "/library",
    "/projects",
    "/scheduled-tasks",
    "/apps",
    "/work",
    "/discovery",
  ])
    assert.ok(routes.includes(route), route);
  for (const route of ["/files", "/maps"]) assert.ok(!routes.includes(route));
  const buttons = elements(tree, (node) => node.type === "button");
  buttons.find((node) => text(node).trim() === "New chat").props.onClick();
  buttons.find((node) => node.props["aria-label"] === "Open chat Saved chat").props.onClick();
  buttons.find((node) => node.props["aria-label"] === "Settings").props.onClick();
  assert.deepEqual(events, [["new"], ["select", "saved"], ["settings", "general"]]);
  hooks.unmount();
});

test("guest sidebar provides sign-in without scheduled-task access or fabricated history", () => {
  const { tree, hooks } = sidebar(false);
  assert.equal(elements(tree, (node) => node.type === "SignInButton").length, 1);
  assert.equal(elements(tree, (node) => node.props.to === "/scheduled-tasks").length, 0);
  assert.equal(
    elements(tree, (node) => node.props["aria-label"] === "Open chat Saved chat").length,
    0,
  );
  hooks.unmount();
});

test("free accounts retain ordinary navigation without paid task shortcuts", () => {
  const { tree, hooks } = sidebar(true, "free");
  const routes = elements(tree, (node) => node.type === "Link").map((node) => node.props.to);
  for (const route of ["/images", "/library", "/projects", "/apps"])
    assert.ok(routes.includes(route), route);
  assert.ok(!routes.includes("/scheduled-tasks"));
  hooks.unmount();
});

test("Work and Discover live in one inline More group for free and guest navigation", () => {
  for (const signedIn of [true, false]) {
    const f = sidebar(signedIn, "free");
    const groups = elements(f.tree, (n) => n.type === "details");
    const more = groups.find((n) => text(n).includes("Discover"));
    assert.ok(more);
    assert.ok(elements(more, (n) => n.type === "summary").some((n) => text(n).trim() === "More"));
    assert.deepEqual(
      elements(more, (n) => n.type === "Link").map((n) => n.props.to),
      ["/work", "/discovery"],
    );
    f.hooks.unmount();
  }
});

test("palette offers Discover through the same allowed internal route", () => {
  const source = readFileSync("src/components/CommandPalette.tsx", "utf8");
  assert.match(source, /label: "Open Discover",\s*href: "\/discovery"/);
  assert.equal(policy.isCoreLaunchRoute("/discovery?mode=web"), true);
});

test("Escape cancels search even before its lazy dialog mounts", () => {
  const source = readFileSync("src/components/ChatWorkspace.tsx", "utf8"),
    ast = ts.createSourceFile(
      "workspace.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "onKeyDown")
      expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression);
  const compiled = ts.transpileModule("const handler=" + expression + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const open of [true, false]) {
    const calls = [];
    const handler = new Function(
      "commandOpen",
      "setCommandOpen",
      "openCommandPalette",
      "newChat",
      compiled + "return handler;",
    )(
      open,
      (v) => calls.push(v),
      () => {},
      () => {},
    );
    let prevented = false;
    handler({
      key: "Escape",
      preventDefault() {
        prevented = true;
      },
    });
    assert.deepEqual(calls, open ? [false] : []);
    assert.equal(prevented, open);
  }
});
