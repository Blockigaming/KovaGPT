import assert from "node:assert/strict";
import test from "node:test";
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
  ])
    assert.equal(policy.isCoreLaunchRoute(path), true, path);
  for (const path of [
    "/academy",
    "/blog/post",
    "/work",
    "/discovery",
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

function sidebar(signedIn) {
  const hooks = createHookHarness();
  const events = [];
  const dependencies = {
    react: hooks.react,
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
    "@/hooks/useTier": { useTier: () => ({ tier: "free" }) },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
    "@/lib/conversation-search": {
      searchConversations: (items) => items.map((conversation) => ({ conversation })),
    },
    "@/components/ui/dropdown-menu": new Proxy({}, { get: (_, key) => String(key) }),
  };
  const window = {
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
  };
  const { Sidebar } = loadUiModule("src/components/Sidebar.tsx", dependencies, { window });
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
  for (const route of ["/images", "/library", "/projects", "/scheduled-tasks", "/apps"])
    assert.ok(routes.includes(route), route);
  for (const route of ["/files", "/work", "/maps", "/discovery"])
    assert.ok(!routes.includes(route));
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
