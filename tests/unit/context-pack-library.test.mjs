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
const item = (id) => ({
  id,
  title: id,
  item_type: "document",
  text_available: true,
  content_generation: "generation",
  content_revision: 1,
  content_text: null,
});
function fixture({
  projectFailure = false,
  delayedProjects = null,
  delayedPacks = null,
  sourceGate = { current: null },
  packFetch = null,
} = {}) {
  const hooks = createHookHarness(),
    pages = [],
    reads = [],
    creates = [],
    notices = [];
  const calls = {
    listContextPacks: async () =>
      packFetch
        ? packFetch()
        : delayedPacks
          ? delayedPacks.promise
          : process.env.KOVA_CONTEXT_SOURCE && !process.env.KOVA_CONTEXT_PAGE_CONTRACT
            ? []
            : { items: [], cursor: null },
    createContextPack: ({ data }) => {
      const request = deferred();
      creates.push({ data, ...request });
      return request.promise;
    },
    deleteContextPack: async () => ({ ok: true }),
    listMemoryCenter: async () =>
      process.env.KOVA_CONTEXT_SOURCE && !process.env.KOVA_CONTEXT_PAGE_CONTRACT
        ? []
        : { items: [], cursor: null },
  };
  const module = loadUiModule(
    process.env.KOVA_CONTEXT_SOURCE ?? "src/routes/context-packs.tsx",
    {
      react: { ...hooks.react, useMemo: (fn) => fn() },
      "@/lib/use-collection-pager": loadUiModule(
        "src/lib/use-collection-pager.ts",
        { react: hooks.react },
        { AbortController, DOMException, Error },
      ),
      "@/components/CollectionPageControls": { CollectionPageControls: "page-controls" },
      "@tanstack/react-router": {
        createFileRoute: () => (value) => value,
        useNavigate: () => () => {},
      },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "lucide-react": { Boxes: "boxes", Plus: "plus", Search: "search", Trash2: "trash" },
      "@/components/AppShell": { AppShell: "shell" },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "actor" } }),
      },
      "@/lib/chat-store": { chatStoragePrincipal: (id) => id, loadConversations: () => [] },
      "@/lib/library.functions": {
        listMyLibrary: async () => [
          { ...item("recent"), content_text: "Saved text" },
          { ...item("older"), content_text: "Older saved text" },
        ],
      },
      "@/lib/library-items-client": {
        listLibraryPage: (owner, query, signal) => {
          const request = deferred();
          pages.push({ owner, query, signal, ...request });
          return request.promise;
        },
        readLibraryItem: (owner, item, signal) => {
          const request = deferred();
          reads.push({ owner, item, signal, ...request });
          return request.promise;
        },
      },
      "@/lib/projects.functions": {
        listProjects: async () => {
          if (sourceGate.current) return sourceGate.current.promise;
          if (delayedProjects) return delayedProjects.promise;
          if (projectFailure) throw Error("Projects offline");
          return [];
        },
      },
      "@/lib/professional.functions": {
        listPromptTemplates: async () =>
          process.env.KOVA_CONTEXT_SOURCE && !process.env.KOVA_CONTEXT_PAGE_CONTRACT
            ? []
            : { items: [], cursor: null },
        listResearchTemplates: async () =>
          process.env.KOVA_CONTEXT_SOURCE && !process.env.KOVA_CONTEXT_PAGE_CONTRACT
            ? []
            : { items: [], cursor: null },
      },
      "@/lib/work-store": { loadWorkTasks: () => [] },
      "@/hooks/use-work-store-revision": { useWorkStoreRevision: () => 0 },
      "@/lib/principal-browser-storage.mjs": {
        consumePrincipalHandoff: () => ({ ok: false, reason: "missing" }),
        safeBrowserStorage: () => null,
        writePrincipalHandoff: () => ({ ok: true }),
      },
      "@/lib/workspace.functions": calls,
      sonner: {
        toast: { error: (value) => notices.push(value), success: (value) => notices.push(value) },
      },
    },
    { AbortController, TextEncoder, Error, confirm: () => true },
  );
  let tree;
  const render = () => {
    const outer = hooks.render(module.Route.component);
    tree = typeof outer.type === "function" ? hooks.render(outer.type, outer.props) : outer;
    return tree;
  };
  render();
  render();
  const input = (label, value) => {
    elements(tree, (e) => e.props["aria-label"] === label)[0].props.onChange({ target: { value } });
    render();
  };
  return {
    calls,
    pages,
    reads,
    creates,
    notices,
    render,
    input,
    get tree() {
      return tree;
    },
    unmount: () => hooks.unmount(),
    choose(title) {
      const row = elements(tree, (e) => e.type === "li" && text(e).includes(title))[0];
      elements(row, (e) => e.props.type === "checkbox")[0].props.onChange();
      render();
    },
    query(value) {
      elements(
        tree,
        (e) => e.props.placeholder === "Search chats, files, Library, projects",
      )[0].props.onChange({ target: { value } });
      render();
    },
    submit() {
      return elements(
        tree,
        (e) => e.type === "button" && /Save context pack|Saving…/.test(text(e)),
      )[0].props.onClick();
    },
  };
}
async function ready(f) {
  if (f.pages.length) f.pages[0].resolve({ items: [item("recent")], cursor: { id: "next" } });
  await settle();
  f.render();
  f.input("Pack name", "My pack");
}
test("context Library pages older metadata and hydrates selected text only", async () => {
  const f = fixture();
  await ready(f);
  assert.equal(f.reads.length, 0);
  const more = elements(
    f.tree,
    (e) => e.type === "button" && text(e) === "Load more Library items",
  )[0];
  assert.ok(more, "older Library items must be reachable");
  more.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.pages[1].query.cursor)), { id: "next" });
  f.pages[1].resolve({ items: [item("older")], cursor: null });
  await settle();
  f.render();
  f.choose("older");
  const saving = f.submit();
  assert.equal(f.reads[0].item.id, "older");
  f.reads[0].resolve({ ...item("older"), content_text: "Verified older text" });
  await settle();
  assert.equal(f.creates[0].data.items[0].content, "Verified older text");
  f.creates[0].resolve({ id: "pack", name: "My pack", items: f.creates[0].data.items });
  await saving;
});
test("search preserves earlier selections and server content matches remain visible", async () => {
  const f = fixture();
  await ready(f);
  f.choose("recent");
  f.query("body match");
  if (f.pages[1]) f.pages[1].resolve({ items: [item("Different title")], cursor: null });
  await settle();
  f.render();
  const saving = f.submit();
  await settle();
  assert.equal(f.reads.length, 1, "hidden selected Library item must still be hydrated");
  assert.equal(f.reads[0].item.id, "recent");
  assert.match(text(f.tree), /Different title/);
  f.reads[0].resolve({ ...item("recent"), content_text: "Retained selected text" });
  await settle();
  assert.equal(f.creates[0].data.items[0].id, "recent");
  f.creates[0].resolve({ id: "pack", name: "My pack", items: [] });
  await saving;
});
test("changed or unreadable selected text fails closed and preserves draft; same-tick save sends once", async () => {
  const f = fixture();
  await ready(f);
  f.choose("recent");
  const saving = f.submit();
  await f.submit();
  assert.equal(f.reads.length, 1);
  f.reads[0].reject(Error("This item changed. Refresh Library to open its current version."));
  await saving;
  f.render();
  assert.equal(f.creates.length, 0);
  assert.match(f.notices[0], /item changed/);
  assert.match(text(f.tree), /Selected\s+1/);
  assert.equal(
    elements(f.tree, (e) => e.props["aria-label"] === "Pack name")[0].props.value,
    "My pack",
  );
});
test("late selected-body read cannot create a pack after account scope unmount", async () => {
  const f = fixture();
  await ready(f);
  f.choose("recent");
  const saving = f.submit();
  f.unmount();
  f.reads[0].resolve({ ...item("recent"), content_text: "Private" });
  await saving;
  assert.equal(f.creates.length, 0);
  assert.equal(f.notices.length, 0);
});
test("earlier pack save acknowledgement preserves newer draft edits", async () => {
  const f = fixture();
  await ready(f);
  f.choose("recent");
  const saving = f.submit();
  f.reads[0].resolve({ ...item("recent"), content_text: "Saved" });
  await settle();
  f.input("Pack name", "New draft");
  f.creates[0].resolve({ id: "pack", name: "My pack", items: [] });
  await saving;
  f.render();
  assert.equal(
    elements(f.tree, (e) => e.props["aria-label"] === "Pack name")[0].props.value,
    "New draft",
  );
  assert.match(text(f.tree), /Selected\s+1/);
});
test("unavailable Projects do not erase available Library choices", async () => {
  const f = fixture({ projectFailure: true });
  await ready(f);
  assert.match(text(f.tree), /Unavailable sources:\s+Projects/);
  assert.match(text(f.tree), /recent/);
});

test("retry sources during a delayed save cannot erase its confirmed pack", async () => {
  const sourceGate = { current: null };
  const f = fixture({ projectFailure: true, sourceGate });
  await ready(f);
  f.choose("recent");
  const retry = elements(f.tree, (e) => e.type === "button" && text(e) === "Retry sources")[0];
  assert.ok(retry);
  const saving = f.submit();
  f.reads[0].resolve({ ...item("recent"), content_text: "verified body" });
  await settle();
  assert.equal(f.creates.length, 1);
  sourceGate.current = deferred();
  retry.props.onClick();
  f.render();
  await settle();
  f.creates[0].resolve({
    id: "new-pack",
    name: "Confirmed unique pack",
    items: f.creates[0].data.items,
  });
  await saving;
  f.render();
  sourceGate.current.resolve([]);
  await settle();
  f.render();
  assert.match(text(f.tree), /Confirmed unique pack/);
});

test("successful saved-pack page retry clears its only blocking error", async () => {
  let fail = true;
  const f = fixture({
    packFetch: async () => {
      if (fail) throw Error("packs offline");
      return { items: [{ id: "recovered", name: "Recovered pack", items: [] }], cursor: null };
    },
  });
  await ready(f);
  const controls = elements(
    f.tree,
    (e) => e.type === "page-controls" && e.props.label === "Saved packs",
  )[0];
  assert.ok(controls.props.pager.error);
  fail = false;
  controls.props.pager.retry();
  await settle();
  f.render();
  assert.match(text(f.tree), /Recovered pack/);
  assert.equal(
    elements(f.tree, (e) => e.type === "page-controls" && e.props.label === "Saved packs")[0].props
      .pager.error,
    null,
  );
});

test("Long unbroken Library filename remains readable in a shrinkable source row without reads or saves", async () => {
  const f = fixture(),
    title = "Library_" + "x".repeat(400) + ".txt";
  f.pages[0].resolve({ items: [item(title)], cursor: null });
  await settle();
  f.render();
  const row = elements(f.tree, (n) => n.type === "li" && text(n).includes(title))[0];
  assert.ok(row);
  const label = elements(row, (n) => n.type === "span" && text(n) === title)[0];
  assert.match(label.props.className, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(label.props.className, /truncate/);
  assert.equal(text(label), title);
  assert.match(elements(row, (n) => n.props.type === "checkbox")[0].props.className, /shrink-0/);
  assert.equal(f.reads.length, 0);
  assert.equal(f.creates.length, 0);
  f.unmount();
});
