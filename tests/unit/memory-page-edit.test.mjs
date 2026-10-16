import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  elements,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
async function fixture() {
  const hooks = createHookHarness(),
    pages = [];
  const list = () => {
    const call = deferred();
    pages.push(call);
    return call.promise;
  };
  const module = loadUiModule(
    process.env.KOVA_MEMORY_PAGE_SOURCE ?? "src/routes/memory.tsx",
    {
      react: { ...hooks.react, useMemo: (fn) => fn() },
      "@tanstack/react-router": { createFileRoute: () => (value) => value },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "lucide-react": { Brain: "brain", Pencil: "pencil", Search: "search", Trash2: "trash" },
      "@/components/MemoryClearPanel": { MemoryClearPanel: "MemoryClearPanel" },
      "@/components/AppShell": { AppShell: "shell" },
      "@/components/WorkspacePageHeader": { WorkspacePageHeader: "header" },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "actor" } }),
        SignInButton: "sign-in",
      },
      "@/lib/workspace.functions": {
        listMemoryCenter: list,
        updateMemoryRecord: async () => {},
        deleteMemoryRecord: async () => {},
        mergeMemoryRecords: async () => {},
      },
      "@/lib/use-collection-pager": loadUiModule(
        "src/lib/use-collection-pager.ts",
        { react: hooks.react },
        { AbortController, DOMException, Error },
      ),
      "@/components/CollectionPageControls": { CollectionPageControls: "page-controls" },
      "@/lib/workspace-handoffs": { addToContextPack() {}, continueInChat() {}, openInWork() {} },
      "@/lib/memory-sources.mjs": { MEMORY_SOURCES_CHANGED_EVENT: "memory" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "confirm" },
      "@/components/ui/button": { Button: "button" },
      sonner: { toast: { success() {}, error() {} } },
    },
    { Error, window: { dispatchEvent() {} }, Event },
  );
  let tree;
  const render = () => {
    const outer = hooks.render(module.Route.component);
    tree = hooks.render(outer.type, outer.props);
    return tree;
  };
  const item = (n) => ({
    id: String(n),
    title: `Memory ${n}`,
    content: `Saved ${n}`,
    source: "conversation",
    category: "Conversation",
    updatedAt: "2026-10-12T00:00:00Z",
  });
  render();
  pages[0].resolve({ items: [item(1)], cursor: "1" });
  await settle();
  render();
  return {
    pages,
    item,
    render,
    get tree() {
      return tree;
    },
    pager: () => elements(tree, (e) => e.type === "page-controls")[0].props,
  };
}
test("pending next page cannot start an old-page edit and strand a hidden draft", async () => {
  const f = await fixture();
  const edit = elements(f.tree, (e) => e.props["aria-label"] === "Edit Memory 1")[0];
  f.pager().pager.next();
  edit.props.onClick();
  f.render();
  const editors = elements(f.tree, (e) => e.type === "textarea");
  if (editors[0]) editors[0].props.onChange({ target: { value: "unsaved draft" } });
  assert.equal(editors.length, 0, "old-page editing must not begin while a page is in flight");
  f.pages[1].resolve({ items: [f.item(2)], cursor: "2" });
  await settle();
  f.render();
  assert.equal(f.pager().disabled, false);
  assert.equal(
    elements(f.tree, (e) => e.props["aria-label"] === "Edit Memory 2")[0].props.disabled,
    false,
  );
});
test("pending next page cannot select an old-page row and disable navigation", async () => {
  const f = await fixture();
  const checkbox = elements(f.tree, (e) => e.props.type === "checkbox")[0];
  f.pager().pager.next();
  checkbox.props.onChange();
  f.render();
  f.pages[1].resolve({ items: [f.item(2)], cursor: "2" });
  await settle();
  f.render();
  assert.equal(f.pager().disabled, false);
  assert.equal(elements(f.tree, (e) => e.props.type === "checkbox")[0].props.checked, false);
});

test("stale old-page handlers cannot start editing after response adoption but before rerender", async () => {
  const f = await fixture();
  const edit = elements(f.tree, (e) => e.props["aria-label"] === "Edit Memory 1")[0];
  f.pager().pager.next();
  f.pages[1].resolve({ items: [f.item(2)], cursor: "2" });
  await settle();
  edit.props.onClick();
  f.render();
  assert.equal(elements(f.tree, (e) => e.type === "textarea").length, 0);
  assert.equal(f.pager().disabled, false);
});
