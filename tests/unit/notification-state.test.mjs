import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
function fixture() {
  const hooks = createHookHarness(),
    pages = [],
    writes = [],
    notices = [],
    detailCalls = [];
  let actor = "actor";
  const server = {
    listNotifications: (options) => {
      const call = deferred();
      pages.push({ ...options, ...call });
      return call.promise;
    },
    markNotificationsRead: (options) => {
      const call = deferred();
      writes.push({ ...options, ...call });
      return call.promise;
    },
    deleteNotifications: async () => ({ ok: true, ids: [] }),
    readNotificationDetails: (options) => {
      const call = deferred();
      detailCalls.push({ ...options, ...call });
      return call.promise;
    },
  };
  const module = loadUiModule(
    "src/routes/notifications.tsx",
    {
      react: { ...hooks.react, useMemo: (fn) => fn() },
      "@tanstack/react-router": { createFileRoute: () => (value) => value, Link: "link" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "lucide-react": {
        Bell: "bell",
        Check: "check",
        CheckCheck: "checks",
        Loader2: "loader",
        Search: "search",
        Trash2: "trash",
      },
      "@/components/AppShell": { AppShell: "shell" },
      "@/components/WorkspacePageHeader": { WorkspacePageHeader: "header" },
      "@/components/states": { EmptyState: "empty", ErrorState: "error" },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: actor } }),
      },
      "@/lib/notification-center.functions": server,
      "@/lib/use-collection-pager": loadUiModule(
        "src/lib/use-collection-pager.ts",
        { react: hooks.react },
        { AbortController, DOMException, Error },
      ),
      "@/components/CollectionPageControls": { CollectionPageControls: "pages" },
      sonner: { toast: { error: (message) => notices.push(message) } },
    },
    { Error, AbortController },
  );
  let tree;
  const render = () => (tree = hooks.render(module.Route.component));
  render();
  render();
  return {
    pages,
    writes,
    detailCalls,
    notices,
    render,
    get tree() {
      return tree;
    },
    scope(value) {
      actor = value;
      render();
      render();
    },
    unmount: hooks.unmount,
  };
}
const row = (source, title) => ({
  id: "same-id",
  source,
  type: "scheduled",
  title,
  preview: "context",
  readAt: null,
  actionUrl: null,
  createdAt: "2026-10-12T00:00:00Z",
});
const controls = (f, source) =>
  elements(f.tree, (e) => e.type === "pages" && e.props.label.startsWith(source))[0].props.pager;
test("one failed notification source preserves the other, and successful retry clears source error", async () => {
  const f = fixture();
  f.pages[0].resolve({ items: [row("application", "Application saved")], cursor: "next" });
  f.pages[1].reject(Error("Agent unavailable"));
  await settle();
  f.render();
  assert.match(text(f.tree), /Application saved/);
  assert.match(controls(f, "Agent").error, /Agent unavailable/);
  controls(f, "Agent").retry();
  f.pages[2].resolve({ items: [row("agent", "Agent recovered")], cursor: null });
  await settle();
  f.render();
  assert.match(text(f.tree), /Application saved/);
  assert.match(text(f.tree), /Agent recovered/);
  assert.equal(controls(f, "Agent").error, null);
});
test("both sources failed then one succeeds: no stale route error hides recovered rows", async () => {
  const f = fixture();
  f.pages[0].reject(Error("app offline"));
  f.pages[1].reject(Error("agent offline"));
  await settle();
  f.render();
  assert.equal(elements(f.tree, (e) => e.type === "error").length, 1);
  controls(f, "Application").retry();
  f.pages[2].resolve({ items: [row("application", "Recovered")], cursor: null });
  await settle();
  f.render();
  assert.equal(elements(f.tree, (e) => e.type === "error").length, 0);
  assert.match(text(f.tree), /Recovered/);
});
test("bulk read retains confirmed source changes and does not acknowledge failed source with identical row id", async () => {
  const f = fixture();
  f.pages[0].resolve({ items: [row("application", "Application")], cursor: null });
  f.pages[1].resolve({ items: [row("agent", "Agent")], cursor: null });
  await settle();
  f.render();
  const action = elements(f.tree, (e) => e.type === "header")[0].props.actions;
  const reading = action.props.onClick();
  assert.equal(f.writes.length, 2);
  f.writes[0].resolve({ ok: true, ids: ["same-id"] });
  f.writes[1].reject(Error("agent write offline"));
  await reading;
  await settle();
  f.render();
  const rows = elements(f.tree, (e) => e.type === "li");
  assert.equal(rows.length, 2);
  assert.equal(
    rows.find((e) => text(e).includes("Application")).props.className.includes("bg-primary"),
    false,
  );
  assert.equal(
    rows.find((e) => text(e).includes("Agent")).props.className.includes("bg-primary"),
    true,
  );
  assert.equal(f.notices.length, 1);
});
test("account change aborts pending source reads and ignores obsolete responses", async () => {
  const f = fixture();
  const old = [...f.pages];
  f.scope("other");
  assert.ok(old.every((call) => call.signal.aborted));
  old.forEach((call) =>
    call.resolve({ items: [row(call.data.source, "Old private")], cursor: null }),
  );
  f.pages
    .slice(2)
    .forEach((call) => call.resolve({ items: [row(call.data.source, "New scope")], cursor: null }));
  await settle();
  f.render();
  assert.doesNotMatch(text(f.tree), /Old private/);
  assert.match(text(f.tree), /New scope/);
});

test("notification details require explicit reveal and stale account response remains hidden", async () => {
  const f = fixture();
  f.pages[0].resolve({ items: [], cursor: null });
  f.pages[1].resolve({ items: [row("agent", "Private notice")], cursor: null });
  await settle();
  f.render();
  assert.equal(f.detailCalls.length, 0);
  elements(f.tree, (e) => e.type === "button" && text(e) === "Show details")[0].props.onClick();
  assert.equal(f.detailCalls.length, 1);
  f.scope("other");
  assert.equal(f.detailCalls[0].signal.aborted, true);
  f.detailCalls[0].resolve({ id: "same-id", body: "PRIVATE_OLD_SCOPE" });
  f.pages.slice(2).forEach((call) => call.resolve({ items: [], cursor: null }));
  await settle();
  f.render();
  assert.doesNotMatch(text(f.tree), /PRIVATE_OLD_SCOPE/);
});
