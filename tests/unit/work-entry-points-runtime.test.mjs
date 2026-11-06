import assert from "node:assert/strict";
import test from "node:test";
import { elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function workRoute() {
  let auth = { isLoaded: false, isSignedIn: false, user: null };
  const module = loadUiModule("src/routes/work.tsx", {
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    "@/components/AppShell": { AppShell: "AppShell" },
    "@/components/WorkspacePageHeader": { WorkspacePageHeader: "WorkspacePageHeader" },
    "@/components/WorkSessionPanel": { WorkSessionPanel: "WorkSessionPanel" },
    "@/components/WorkSyncStatus": { WorkSyncStatus: "WorkSyncStatus" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/auth/ClerkSafe": {
      useUser: () => auth,
      SignInButton: "SignInButton",
    },
  });
  return {
    render(next) {
      auth = next;
      return module.Route.component();
    },
  };
}

test("Work waits for resolved authentication and never mounts private controls for a guest", () => {
  const route = workRoute();
  for (const auth of [
    { isLoaded: false, isSignedIn: true, user: { id: "stale-owner" } },
    { isLoaded: true, isSignedIn: false, user: { id: "stale-owner" } },
    { isLoaded: true, isSignedIn: true, user: null },
  ]) {
    const tree = route.render(auth);
    assert.equal(elements(tree, (node) => node.type === "WorkSessionPanel").length, 0);
    assert.equal(elements(tree, (node) => node.type === "WorkSyncStatus").length, 0);
    assert.equal(
      elements(tree, (node) => node.type === "SignInButton").length,
      auth.isLoaded ? 1 : 0,
    );
  }
});

test("Work remounts private planning and execution controls under the current account", () => {
  const route = workRoute();
  for (const id of ["first-owner", "second-owner"]) {
    const tree = route.render({ isLoaded: true, isSignedIn: true, user: { id } });
    const section = elements(tree, (node) => node.props["aria-label"] === "Your Work")[0];
    const panel = elements(tree, (node) => node.type === "WorkSessionPanel")[0];
    assert.equal(section.key, id);
    assert.equal(panel.props.ownerId, id);
    assert.equal(panel.props.prepared, null, "visiting Work never prepares or submits a task");
    assert.equal(elements(tree, (node) => node.type === "SignInButton").length, 0);
  }
});

test("chat Work review receives only the current draft and stays out of temporary and guest chats", async () => {
  const module = loadUiModule("src/components/ChatWorkspaceControls.tsx", {
    react: { lazy: (load) => ({ load }), Suspense: "Suspense" },
    "@tanstack/react-router": { Link: "Link" },
    "@/components/ChatHistorySync": { ChatHistorySyncStatus: "HistoryStatus" },
    "@/components/ChatWorkControl": { ChatWorkControl: "ChatWorkControl" },
  });
  const render = (ownerId, temporary = false) =>
    module.ChatWorkspaceControls({
      ownerId,
      temporary,
      active: null,
      objective: "Review this synthetic launch request",
    });
  for (const tree of [render(null), render("owner", true)])
    assert.equal(elements(tree, (node) => Object.hasOwn(node.props, "objective")).length, 0);
  for (const owner of ["owner-a", "owner-b"]) {
    const tree = render(owner);
    const control = elements(tree, (node) => Object.hasOwn(node.props, "objective"))[0];
    assert.equal((await control.type.load()).default, "ChatWorkControl");
    assert.equal(control.key, `work:${owner}`);
    assert.equal(control.props.ownerId, owner);
    assert.equal(control.props.objective, "Review this synthetic launch request");
    assert.equal(
      text(tree).trim(),
      "",
      "opening the entry point does not claim any task completed",
    );
  }
});
