import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";

const source = readFileSync("src/routes/library.tsx", "utf8");
const file = ts.createSourceFile(
  "library.tsx",
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
const compile = (expression, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(`return (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
  )(...Object.values(deps));
const durable = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content_revision: 1 };
const other = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", content_revision: 1 };
const chat = { id: "chat:c" };
const work = { id: "work:w" };
function fixture(initial = [durable, chat, work], signedIn = true) {
  const state = {
    rows: initial.slice(),
    selected: initial.map((item) => item.id),
    busy: false,
    calls: [],
    errors: [],
    successes: [],
  };
  const deps = {
    principalReady: true,
    principal: "user:A",
    principalRef: { current: "user:A" },
    folderBusy: false,
    lifecycleGenerationRef: { current: 1 },
    bulkDeleteRef: { current: null },
    isSignedIn: signedIn,
    userKey: "A",
    items: initial,
    selected: initial.map((item) => item.id),
    setItems(next) {
      state.rows = typeof next === "function" ? next(state.rows) : next;
    },
    setSelected(next) {
      state.selected = typeof next === "function" ? next(state.selected) : next;
    },
    setBulkDeleteBusy(value) {
      state.busy = value;
    },
    require(id) {
      assert.equal(id, "@/lib/library.functions");
      return { deleteLibraryItem: (...args) => deps.deleteLibraryItem(...args) };
    },
    async deleteLibraryItem({ data }) {
      state.calls.push(["durable", data]);
    },
    loadConversations: () => [{ id: "c" }],
    async moveChatToTrash() {
      state.calls.push(["chat"]);
      return true;
    },
    loadWorkTasks: () => [{ id: "w" }],
    saveWorkTasks(owner, tasks) {
      state.calls.push(["work", owner, tasks]);
    },
    deleteGuestItem(id) {
      state.calls.push(["guest", id]);
    },
    toast: {
      error: (message) => state.errors.push(message),
      success: (message) => state.successes.push(message),
    },
  };
  return {
    state,
    deps,
    run: (ids = deps.selected) => compile(variable("deleteSelected"), deps)(true, ids),
  };
}

test("signed-in partial deletion retains canceled chat and unattempted Work while removing confirmed file", async () => {
  const f = fixture();
  f.deps.moveChatToTrash = async () => false;
  await f.run();
  assert.deepEqual(f.state.rows, [chat, work]);
  assert.deepEqual(f.state.selected, [chat.id, work.id]);
  assert.equal(f.state.errors.length, 1);
  assert.equal(f.state.successes.length, 0);
  assert.equal(f.state.busy, false);
  assert.ok(!f.state.calls.some(([kind]) => kind === "work"));
});
test("guest partial deletion never restores an already-deleted guest item", async () => {
  const guest = { id: "guest:one" };
  const f = fixture([guest, chat, work], false);
  f.deps.moveChatToTrash = async () => false;
  await f.run();
  assert.deepEqual(f.state.rows, [chat, work]);
  assert.deepEqual(f.state.selected, [chat.id, work.id]);
  assert.equal(f.state.errors.length, 1);
});
test("Work save failure retains Work, while file and chat successes stay removed", async () => {
  const f = fixture();
  f.deps.saveWorkTasks = () => {
    throw Error("Work sync failed");
  };
  await f.run();
  assert.deepEqual(f.state.rows, [work]);
  assert.deepEqual(f.state.selected, [work.id]);
  assert.equal(f.state.successes.length, 0);
});
test("durable partial rejection reconciles fulfilled IDs, preserves failed and unattempted targets, and does not reload stale filters", async () => {
  const f = fixture([durable, other, chat, work]);
  f.deps.deleteLibraryItem = async ({ data }) => {
    if (data.id === other.id) throw Error("Rejected");
  };
  await f.run();
  assert.deepEqual(f.state.rows, [other, chat, work]);
  assert.deepEqual(f.state.selected, [other.id, chat.id, work.id]);
  assert.equal(f.state.errors.length, 1);
  assert.equal(f.state.calls.length, 0);
});
test("later unrelated selections and current rows survive a delayed successful batch", async () => {
  const f = fixture([durable]);
  const pending = deferred();
  f.deps.deleteLibraryItem = () => pending.promise;
  const done = f.run();
  await settle();
  f.state.rows.push(other);
  f.state.selected = [other.id];
  pending.resolve();
  await done;
  assert.deepEqual(f.state.rows, [other]);
  assert.deepEqual(f.state.selected, [other.id]);
  assert.equal(f.state.successes.length, 1);
  assert.ok(!f.state.calls.some(([kind]) => kind === "work"));
});
test("pending batch cannot issue duplicate deletes before rerender", async () => {
  const f = fixture([durable]);
  const pending = deferred();
  let calls = 0;
  f.deps.deleteLibraryItem = () => {
    calls++;
    return pending.promise;
  };
  const first = f.run();
  await settle();
  await f.run();
  assert.equal(calls, 1);
  pending.resolve();
  await first;
  assert.equal(f.state.busy, false);
});
for (const change of ["account", "reset", "unmount"])
  test(`${change} invalidates delayed deletion reconciliation and feedback`, async () => {
    const f = fixture();
    const pending = deferred();
    f.deps.deleteLibraryItem = () => pending.promise;
    const done = f.run();
    await settle();
    if (change === "account") f.deps.principalRef.current = "user:B";
    else f.deps.lifecycleGenerationRef.current++;
    f.state.rows = [other];
    f.state.selected = [other.id];
    f.state.busy = false;
    pending.resolve();
    await done;
    assert.deepEqual(f.state.rows, [other]);
    assert.deepEqual(f.state.selected, [other.id]);
    assert.equal(f.state.errors.length, 0);
    assert.equal(f.state.successes.length, 0);
    assert.equal(f.state.calls.length, 0);
  });
test("late state updater replay cannot affect a reset or another account", async () => {
  const f = fixture([durable]);
  const updates = [];
  f.deps.setItems = (value) => updates.push(["rows", value]);
  f.deps.setSelected = (value) => updates.push(["selected", value]);
  await f.run();
  f.deps.lifecycleGenerationRef.current++;
  const rows = [durable, other],
    selected = [durable.id, other.id];
  for (const [kind, update] of updates)
    assert.deepEqual(update(kind === "rows" ? rows : selected), kind === "rows" ? rows : selected);
});
test("guest write failure preserves failed/unattempted rows and only removes earlier verified successes", async () => {
  const first = { id: "guest:one" },
    second = { id: "guest:two" };
  const f = fixture([first, second, chat], false);
  f.deps.deleteGuestItem = (id) => {
    if (id === second.id) throw Error("Quota exceeded");
  };
  await f.run();
  assert.deepEqual(f.state.rows, [second, chat]);
  assert.deepEqual(f.state.selected, [second.id, chat.id]);
  assert.equal(f.state.errors.length, 1);
});
test("single guest deletion restores its row and reports persistence failure", async () => {
  const guest = { id: "guest:one" };
  const f = fixture([guest], false);
  f.deps.bulkDeleteBusy = false;
  f.deps.deleteGuestItem = () => {
    throw Error("Storage denied");
  };
  await compile(variable("remove"), f.deps)(guest.id, true);
  assert.deepEqual(f.state.rows, [guest]);
  assert.equal(f.state.successes.length, 0);
  assert.equal(f.state.errors.length, 1);
});
test("Move completion excludes only moved IDs from the latest selection", () => {
  const attr = nodes.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(file) === "onMoved",
  );
  const f = fixture([durable, other, chat, work]);
  f.deps.libraryCleared = false;
  f.deps.libraryRenderGeneration = 1;
  f.deps.loadGenerationRef = { current: 1 };
  f.deps.setLoading = () => {};
  compile(attr.initializer.expression.getText(file), f.deps)([durable.id], "folder");
  assert.deepEqual(f.state.selected, [other.id, chat.id, work.id]);
  assert.equal(f.state.rows[0].folder_id, "folder");
  f.deps.principalRef.current = "user:B";
  compile(attr.initializer.expression.getText(file), f.deps)([other.id], null);
  assert.deepEqual(f.state.selected, [other.id, chat.id, work.id]);
});
test("real unmount cleanup invalidates lifecycle, aborts requests and clears pending return/batch references", () => {
  const effect = nodes.find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("const requests = pageRequests.current"),
  );
  const controller = new AbortController();
  const deps = {
    pageRequests: { current: new Set([controller]) },
    lifecycleGenerationRef: { current: 3 },
    versionReturnFocusRef: { current: {} },
    bulkDeleteRef: { current: {} },
    retryReturnRef: { current: {} },
  };
  compile(effect.arguments[0].getText(file), deps)()();
  assert.equal(deps.lifecycleGenerationRef.current, 4);
  assert.equal(controller.signal.aborted, true);
  assert.equal(deps.bulkDeleteRef.current, null);
  assert.equal(deps.versionReturnFocusRef.current, null);
});
