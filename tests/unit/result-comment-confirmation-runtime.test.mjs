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
  const harness = createHookHarness();
  const restored = [],
    mutations = [],
    closes = [];
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const dependencies = {
    react: harness.react,
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/alert-dialog": Object.fromEntries(
      [
        "AlertDialog",
        "AlertDialogCancel",
        "AlertDialogContent",
        "AlertDialogDescription",
        "AlertDialogFooter",
        "AlertDialogHeader",
        "AlertDialogTitle",
      ].map((name) => [name, name]),
    ),
    "@/lib/dialog-return-focus": { restoreDialogFocus: (...args) => restored.push(args) },
  };
  const { ResultCommentDeleteDialog } = loadUiModule(
    "src/components/ResultCommentDeleteDialog.tsx",
    dependencies,
    { document, requestAnimationFrame: (cb) => cb(), Error },
  );
  const trigger = { isConnected: true, getClientRects: () => [{}], name: "delete-row-a" };
  const fallback = { name: "comments-heading" };
  let result = deferred();
  let props = {
    scope: "owner-a:document-a",
    target: {
      id: "comment-a",
      body: "Only this exact comment",
      scope: "owner-a:document-a",
      trigger,
      url: "https://review.invalid/result/a",
    },
    durable: true,
    fallbackRef: { current: fallback },
    onClose: () => closes.push(true),
    onDelete: (id) => {
      mutations.push(id);
      return result.promise;
    },
  };
  let tree;
  const render = (next = {}) => {
    props = { ...props, ...next };
    tree = harness.render(ResultCommentDeleteDialog, props);
    return tree;
  };
  const node = (type) => elements(tree, (item) => item.type === type)[0];
  render();
  render();
  return {
    render,
    node,
    get tree() {
      return tree;
    },
    mutations,
    closes,
    restored,
    props,
    trigger,
    fallback,
    document,
    get result() {
      return result;
    },
    nextResult() {
      result = deferred();
      return result;
    },
    unmount: harness.unmount,
  };
}

test("Result comment removal has named consequence review and safe Cancel focus", () => {
  const f = fixture();
  assert.equal(f.node("AlertDialogHeader").props.className, "text-left");
  assert.match(text(f.tree), /Delete comment “ Only this exact comment/);
  assert.match(text(f.tree), /result text and other comments stay unchanged/);
  const cancel = f.node("AlertDialogCancel");
  let cancelFocus = 0;
  cancel.props.ref.current = { focus: () => cancelFocus++ };
  f.node("AlertDialogContent").props.onOpenAutoFocus({ preventDefault() {} });
  assert.equal(cancelFocus, 1);
  f.node("AlertDialog").props.onOpenChange(false);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.closes.length, 1);
  f.node("AlertDialogContent").props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.restored[0][0], f.trigger);
  assert.equal(f.restored[0][2], false);
});

test("confirmation deletes only captured id once, retains failed confirmation and truthful uncertainty", async () => {
  const f = fixture();
  const click = f.node("Button").props.onClick;
  click();
  click();
  assert.deepEqual(f.mutations, ["comment-a"]);
  f.result.reject(new Error("Response lost"));
  await settle();
  f.render();
  assert.equal(f.closes.length, 0);
  assert.match(text(f.tree), /Deletion could not be confirmed/);
  assert.match(text(f.tree), /may already have succeeded/);
  assert.doesNotMatch(text(f.tree), /rolled back/);
  f.nextResult();
  f.node("Button").props.onClick();
  f.render();
  assert.doesNotMatch(text(f.tree), /Deletion could not be confirmed/);
  assert.deepEqual(f.mutations, ["comment-a", "comment-a"]);
  f.result.resolve();
  await settle();
  assert.equal(f.closes.length, 1);
  f.trigger.isConnected = false;
  f.render({ target: null });
  f.node("AlertDialogContent").props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.restored.at(-1)[0], f.fallback);
});

test("account/document changes reject stale confirmation and completion without restoring old focus", async () => {
  const f = fixture();
  const staleClick = f.node("Button").props.onClick;
  f.render({ scope: "owner-b:document-a" });
  staleClick();
  assert.equal(f.mutations.length, 0);
  assert.equal(f.node("AlertDialog").props.open, false);
  f.node("AlertDialogContent").props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.restored.at(-1)[2], true);
  f.render({ scope: "owner-a:document-a" });
  f.render();
  f.node("Button").props.onClick();
  f.render({ scope: "owner-a:document-b" });
  f.result.resolve();
  await settle();
  assert.equal(f.closes.length, 0);
});

test("closing or unmounting prevents late outcome from touching another confirmation", async () => {
  const f = fixture();
  f.node("Button").props.onClick();
  f.node("AlertDialog").props.onOpenChange(false);
  f.render({ target: null });
  f.result.reject(new Error("late failure"));
  await settle();
  f.render();
  assert.doesNotMatch(text(f.tree), /late failure/);
  assert.equal(f.closes.length, 1);
});
