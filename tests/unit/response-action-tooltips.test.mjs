import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { elements } from "../helpers/ui-state-harness.mjs";
const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChatMessage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let toolbar;
function visit(n) {
  if (
    ts.isJsxElement(n) &&
    n.openingElement.attributes.properties.some(
      (p) =>
        ts.isJsxAttribute(p) &&
        p.name.getText(ast) === "aria-label" &&
        p.initializer?.text === "Response actions",
    )
  )
    toolbar = n;
  ts.forEachChild(n, visit);
}
visit(ast);
function fixture(state = {}) {
  assert.ok(toolbar);
  const calls = [];
  const dependencies = {
    React,
    copied: false,
    sharing: false,
    saving: false,
    saved: false,
    isSignedIn: true,
    principalResolved: true,
    userKey: "owner",
    chatId: "chat",
    temporary: false,
    message: { id: "message", content: "Reply" },
    responseMoreRef: { current: null },
    copy: () => calls.push("copy"),
    share: () => calls.push("share"),
    saveItem: () => calls.push("save"),
    onRetry: () => calls.push("retry"),
    onBranch: () => calls.push("branch"),
    ...state,
  };
  for (const n of [
    "Check",
    "Copy",
    "Loader2",
    "Share2",
    "Bookmark",
    "MoreHorizontal",
    "RefreshCw",
    "GitBranch",
    "ResponseSpeechButton",
    "DropdownMenu",
    "DropdownMenuTrigger",
    "DropdownMenuContent",
    "DropdownMenuItem",
  ])
    dependencies[n] = n;
  const code = ts.transpileModule(`return (${toolbar.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const tree = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
  return {
    tree,
    calls,
    buttons: elements(tree, (n) => n.type === "button"),
    items: elements(tree, (n) => n.type === "DropdownMenuItem"),
  };
}
test("copy, public share and bookmark actions preserve their actual callbacks and accessible icon labels", () => {
  const f = fixture();
  assert.deepEqual(
    f.buttons.map((b) => b.props["aria-label"]),
    ["Copy response", "Share response", "Save to Library", "More actions"],
  );
  for (const b of f.buttons)
    assert.ok(b.props.title, "icon controls have an accessible hover label");
  f.buttons[0].props.onClick();
  f.buttons[1].props.onClick();
  f.buttons[2].props.onClick();
  assert.deepEqual(f.calls, ["copy", "share", "save"]);
  const speech = elements(f.tree, (n) => n.type === "ResponseSpeechButton");
  assert.equal(speech.length, 1);
  assert.equal(speech[0].props.disabled, false);
});
test("pending actions cannot be repeated, and a saved response retains its filled bookmark", () => {
  const busy = fixture({ sharing: true, saving: true });
  assert.equal(busy.buttons[1].props.disabled, true);
  assert.equal(busy.buttons[2].props.disabled, true);
  const saved = fixture({ saved: true });
  assert.equal(saved.buttons[2].props["aria-pressed"], true);
  assert.equal(saved.buttons[2].props["aria-label"], "Remove from Library");
  saved.buttons[2].props.onClick();
  assert.deepEqual(saved.calls, ["save"]);
  assert.match(
    elements(saved.buttons[2], (n) => n.type === "Bookmark")[0].props.className,
    /fill-current/,
  );
  const guest = fixture({ isSignedIn: false, userKey: null });
  assert.equal(guest.buttons[1].props.disabled, true);
  assert.equal(
    elements(guest.tree, (n) => n.type === "ResponseSpeechButton")[0].props.disabled,
    true,
  );
});
test("More exposes exactly retry and branch, without unrelated actions", () => {
  const f = fixture();
  assert.equal(f.items.length, 2);
  f.items[0].props.onSelect();
  f.items[1].props.onSelect();
  assert.deepEqual(f.calls, ["retry", "branch"]);
  const unavailable = fixture({ onRetry: undefined, onBranch: undefined });
  assert.ok(unavailable.items.every((n) => n.props.disabled));
});
