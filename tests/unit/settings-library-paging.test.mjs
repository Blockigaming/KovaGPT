import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import {
  createHookHarness,
  jsxRuntime,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
const source = ts.createSourceFile(
  "settings.tsx",
  readFileSync("src/components/SettingsDialog.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const node = source.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "LibraryPanelForOwner",
);
const compiled = ts.transpileModule(node.getText(source), {
  fileName: "settings.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
function fixture() {
  const hooks = createHookHarness(),
    requests = [],
    openings = [],
    notices = [];
  const env = {
    exports: {},
    ...hooks.react,
    AbortController,
    listLibraryPage: (owner, query, signal) => {
      const pending = deferred();
      requests.push({ owner, query, signal, ...pending });
      return pending.promise;
    },
    readLibraryItem: (owner, item) => {
      const pending = deferred();
      openings.push({ owner, item, ...pending });
      return pending.promise;
    },
    toast: { error: (value) => notices.push(value), success: (value) => notices.push(value) },
    require(id) {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "@/lib/library.functions") return { listMyLibrary: async () => [item("recent")] };
      if (id === "@/lib/shared-chats.functions")
        return {
          listSharedWithMe: async () => {
            throw Error("service unavailable");
          },
          listMySharedChats: async () => [],
        };
      throw Error(id);
    },
  };
  for (const name of [
    "Button",
    "RefreshCw",
    "Input",
    "Select",
    "SelectTrigger",
    "SelectValue",
    "SelectContent",
    "SelectItem",
    "Check",
    "Trash2",
    "LibraryItemViewer",
  ])
    env[name] = name;
  const component = new Function(...Object.keys(env), compiled + ";return LibraryPanelForOwner;")(
    ...Object.values(env),
  );
  let tree;
  const render = () => (tree = hooks.render(component, { ownerId: "actor" }));
  render();
  render();
  return {
    requests,
    openings,
    notices,
    render,
    get tree() {
      return tree;
    },
    unmount: () => hooks.unmount(),
  };
}
const item = (id) => ({
  id,
  title: id,
  item_type: "document",
  created_at: "2026-10-12",
  text_available: true,
  content_generation: "gen",
  content_text: null,
});
test("settings Library reaches older pages independently of shared-chat failure and lazily opens real text", async () => {
  const f = fixture();
  if (!f.requests.length) {
    await settle();
    f.render();
    assert.match(
      text(f.tree),
      /recent/,
      "a sharing failure must not erase an available Library result",
    );
    return;
  }
  f.requests[0].resolve({ items: [item("recent")], cursor: { id: "older" } });
  await settle();
  f.render();
  assert.match(text(f.tree), /recent/);
  assert.match(text(f.tree), /Shared chats are unavailable/);
  elements(
    f.tree,
    (e) => e.type === "Button" && text(e) === "Load more Library items",
  )[0].props.onClick();
  assert.deepEqual(f.requests[1].query.cursor, { id: "older" });
  f.requests[1].resolve({ items: [item("older")], cursor: null });
  await settle();
  f.render();
  assert.match(text(f.tree), /older/);
  assert.equal(f.openings.length, 0);
  elements(f.tree, (e) => e.type === "Button" && text(e) === "Open")[1].props.onClick();
  assert.equal(f.openings[0].item.id, "older");
  f.openings[0].resolve({
    ...item("older"),
    content_text: "Actual saved body",
    content_loaded: true,
  });
  await settle();
  f.render();
  assert.equal(
    elements(f.tree, (e) => e.type === "LibraryItemViewer")[0].props.item.content_text,
    "Actual saved body",
  );
});
test("settings query change aborts old page and late responses cannot replace the new query", async () => {
  const f = fixture();
  elements(f.tree, (e) => e.type === "Input")[0].props.onChange({ target: { value: "older" } });
  f.render();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].query.query, "older");
  f.requests[1].resolve({ items: [item("Match")], cursor: null });
  await settle();
  f.render();
  f.requests[0].resolve({ items: [item("Stale")], cursor: null });
  await settle();
  f.render();
  assert.match(text(f.tree), /Match/);
  assert.doesNotMatch(text(f.tree), /Stale/);
});
test("settings late item body cannot publish after account scope unmount", async () => {
  const f = fixture();
  f.requests[0].resolve({ items: [item("private")], cursor: null });
  await settle();
  f.render();
  elements(f.tree, (e) => e.type === "Button" && text(e) === "Open")[0].props.onClick();
  f.unmount();
  f.openings[0].reject(Error("private failure"));
  await settle();
  assert.equal(f.notices.length, 0);
});
