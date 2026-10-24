import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";
const policy = loadUiModule("src/lib/library-title-policy.ts", {});
const owner = "11111111-1111-4111-8111-111111111111";
const item = {
  id: "22222222-2222-4222-8222-222222222222",
  content_generation: "33333333-3333-4333-8333-333333333333",
  title: "Original title",
};
function serverFixture() {
  const source = readFileSync("src/lib/library.functions.ts", "utf8");
  const ast = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (n) =>
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => d.name.getText(ast) === "renameLibrarySavedItem"),
  );
  const code = ts.transpileModule(declaration.getText(ast).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let validate;
  const calls = [];
  const result = {
    data: { ...item, title: "New title", updated_at: "2026-10-19T00:00:00Z" },
    error: null,
  };
  const chain = {
    middleware() {
      return this;
    },
    validator(fn) {
      validate = fn;
      return this;
    },
    handler(fn) {
      return (input, context) => fn({ data: validate(input), context });
    },
  };
  const fn = new Function(
    "createServerFn",
    "requireSupabaseAuth",
    "z",
    `${code};return renameLibrarySavedItem;`,
  )(() => chain, {}, z);
  const query = Object.fromEntries(
    ["update", "eq", "select"].map((name) => [
      name,
      (...args) => {
        calls.push([name, ...args]);
        return query;
      },
    ]),
  );
  query.maybeSingle = async () => result;
  const context = {
    userId: owner,
    supabase: {
      from(name) {
        calls.push(["from", name]);
        return query;
      },
    },
  };
  const data = {
    expectedOwnerId: owner,
    id: item.id,
    generation: item.content_generation,
    previousTitle: item.title,
    title: "New title",
  };
  return { fn, data, context, calls, result };
}
test("saved-title mutation is metadata-only and owner/generation/previous-title scoped with confirmed readback", async () => {
  const f = serverFixture();
  const value = await f.fn(f.data, f.context);
  assert.equal(value.title, "New title");
  assert.deepEqual(Object.keys(f.calls.find(([name]) => name === "update")[1]).sort(), [
    "title",
    "updated_at",
  ]);
  for (const pair of [
    ["user_id", owner],
    ["id", item.id],
    ["content_generation", item.content_generation],
    ["title", item.title],
  ])
    assert.ok(
      f.calls.some((call) => call[0] === "eq" && call[1] === pair[0] && call[2] === pair[1]),
    );
});
test("invalid, changed-owner, stale generation/title and database failures never report rename success", async () => {
  for (const change of [{ title: " " }, { title: "x".repeat(201) }, { id: "chat:local" }]) {
    const f = serverFixture();
    await assert.rejects(async () => f.fn({ ...f.data, ...change }, f.context));
    assert.equal(f.calls.length, 0);
  }
  const f = serverFixture();
  await assert.rejects(() => f.fn(f.data, { ...f.context, userId: "other" }), /account changed/);
  assert.equal(f.calls.length, 0);
  for (const result of [
    { data: null, error: null },
    { data: { ...item, title: "Wrong" }, error: null },
    { data: null, error: {} },
  ]) {
    const g = serverFixture();
    Object.assign(g.result, result);
    await assert.rejects(() => g.fn(g.data, g.context), /could not be confirmed/);
  }
});
function fixture() {
  const h = createHookHarness(),
    pending = deferred(),
    calls = [],
    saved = [],
    focuses = [];
  let valid = true,
    closed = 0;
  const doc = { body: {}, activeElement: null };
  doc.activeElement = doc.body;
  const names = [
    "Dialog",
    "DialogContent",
    "DialogDescription",
    "DialogTitle",
    "AlertDialog",
    "AlertDialogContent",
    "AlertDialogHeader",
    "AlertDialogTitle",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogCancel",
    "AlertDialogAction",
    "Button",
    "Input",
  ];
  const ui = Object.fromEntries(names.map((name) => [name, name]));
  const dependencies = {
    react: h.react,
    "@tanstack/react-start": {
      useServerFn: () => async (value) => {
        calls.push(value);
        return pending.promise;
      },
    },
    "lucide-react": { Loader2: "Loader2" },
    "@/lib/library.functions": { renameLibrarySavedItem: {} },
    "@/lib/library-title-policy": policy,
  };
  for (const path of ["dialog", "alert-dialog", "button", "input"])
    dependencies[`@/components/ui/${path}`] = ui;
  const { LibraryRenameDialog } = loadUiModule(
    "src/components/LibraryRenameDialog.tsx",
    dependencies,
    { document: doc },
  );
  const props = {
    item,
    owner,
    isCurrent: () => valid,
    onClose: () => closed++,
    onSaved: (value) => saved.push(value),
    onCloseAutoFocus() {},
  };
  let tree;
  const render = () => {
    tree = h.render(LibraryRenameDialog, props);
    for (const node of elements(tree, (node) => node.props.ref)) {
      const target = {
        contains: (el) => el === target,
        focus() {
          focuses.push(node.type);
          doc.activeElement = target;
        },
      };
      node.props.ref.current = target;
    }
    return tree;
  };
  render();
  return {
    h,
    pending,
    calls,
    saved,
    focuses,
    render,
    get tree() {
      return tree;
    },
    get closed() {
      return closed;
    },
    change(value) {
      elements(tree, (n) => n.type === "Input")[0].props.onChange({ target: { value } });
      render();
    },
    submit() {
      elements(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      render();
    },
    invalidate() {
      valid = false;
    },
  };
}
test("rename rejects blank blur, guards duplicate submits, and reports only confirmed current results", async () => {
  const f = fixture();
  f.change(" ");
  elements(f.tree, (n) => n.type === "Input")[0].props.onBlur();
  f.render();
  assert.equal(elements(f.tree, (n) => n.type === "Input")[0].props["aria-invalid"], true);
  f.submit();
  assert.equal(f.calls.length, 0);
  f.change("  Renamed  ");
  f.submit();
  f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].data.title, "Renamed");
  f.pending.resolve({ ...item, title: "Renamed" });
  await settle();
  assert.equal(f.saved.length, 1);
});
test("failed rename retains draft and blocks blind retry; account change/unmount suppress late UI", async () => {
  const f = fixture();
  f.change("Keep exact draft");
  f.submit();
  f.pending.reject(Error("Unconfirmed"));
  await settle();
  f.render();
  assert.equal(elements(f.tree, (n) => n.type === "Input")[0].props.value, "Keep exact draft");
  assert.match(text(f.tree), /could not be confirmed|Unconfirmed/);
  f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(
    elements(f.tree, (n) => n.type === "Button" && n.props.type === "submit")[0].props.disabled,
    true,
  );
  for (const action of ["invalidate", "unmount"]) {
    const g = fixture();
    g.change("Late");
    g.submit();
    if (action === "invalidate") g.invalidate();
    else g.h.unmount();
    g.pending.resolve({ ...item, title: "Late" });
    await settle();
    assert.equal(g.saved.length, 0);
  }
});
test("dirty close exposes safe Keep editing and preserves the exact draft until explicit discard", () => {
  const f = fixture();
  f.change("  Keep this\n");
  elements(f.tree, (n) => n.type === "Dialog")[0].props.onOpenChange(false);
  f.render();
  assert.equal(elements(f.tree, (n) => n.type === "AlertDialog")[0].props.open, true);
  assert.equal(f.closed, 0);
  elements(f.tree, (n) => n.type === "AlertDialog")[0].props.onOpenChange(false);
  f.render();
  assert.equal(elements(f.tree, (n) => n.type === "Input")[0].props.value, "  Keep this\n");
  elements(f.tree, (n) => n.type === "AlertDialogAction")[0].props.onClick();
  assert.equal(f.closed, 1);
});
