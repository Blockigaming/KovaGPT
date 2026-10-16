import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import vm from "node:vm";
import { loadUiModule, elements, text, createHookHarness } from "../helpers/ui-state-harness.mjs";
const { artifactHistoryStatus: status } = loadUiModule("src/lib/artifact-history-status.ts", {});
const acknowledged = {
  canPersist: true,
  ready: true,
  hasSavedVersions: true,
  currentAcknowledged: true,
  saveState: "saved",
  failed: false,
  conflict: false,
};
for (const [name, overrides, label, summary] of [
  ["local", { canPersist: false }, "Session only", /not saved to your account/],
  [
    "capability without acknowledgment",
    { ready: false, hasSavedVersions: false, currentAcknowledged: false },
    "Not confirmed saved",
    /No saved versions have been confirmed/,
  ],
  [
    "offline",
    { ready: false, failed: true, currentAcknowledged: false, hasSavedVersions: false },
    "Not confirmed saved",
    /Saving is unavailable or failed/,
  ],
  [
    "failed after earlier save",
    { failed: true },
    "Not confirmed saved",
    /Versions marked saved were confirmed/,
  ],
  ["conflict", { conflict: true }, "Not confirmed saved", /Resolve the version conflict/],
  ["pending", { saveState: "saving" }, "Saving…", /not confirmed saved yet/],
  [
    "edited",
    { saveState: "unsaved", currentAcknowledged: false },
    "Unsaved",
    /current draft is not confirmed saved/,
  ],
  [
    "unacknowledged initial saved state",
    { currentAcknowledged: false },
    "Not confirmed saved",
    /current draft is not confirmed saved/,
  ],
  [
    "failed local snapshot",
    { saveState: "session_only" },
    "Not confirmed saved",
    /current draft is not confirmed saved/,
  ],
  ["server acknowledged current", {}, "Saved", /Current content is confirmed saved/],
])
  test(`History wording: ${name}`, () => {
    const result = status({ ...acknowledged, ...overrides });
    assert.equal(result.label, label);
    assert.match(result.summary, summary);
    if (label !== "Saved")
      assert.doesNotMatch(result.summary, /Current content is confirmed saved/);
  });
const source = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
function initializer(name) {
  const ast = ts.createSourceFile(
    "editor.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let value;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name)
      value = n.initializer.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return value;
}
test("History Close returns to exact visible trigger; navigation and detached trigger skip focus", () => {
  let focused = 0,
    closed = 0;
  const win = { location: { href: "local" } },
    target = {
      isConnected: true,
      getClientRects: () => [{}],
      closest: () => null,
      matches: () => false,
      focus: () => focused++,
    };
  const globals = {
    useCallback: (f) => f,
    setHistoryOpen: (v) => {
      assert.equal(v, false);
      closed++;
    },
    restoreDialogFocus: loadUiModule("src/lib/dialog-return-focus.ts", {}, { window: win })
      .restoreDialogFocus,
    historyTriggerRef: { current: target },
    historyUrlRef: { current: "local" },
  };
  const fn = vm.runInNewContext(
    ts.transpileModule("(" + initializer("closeHistory") + ")", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    globals,
  );
  fn();
  assert.equal(focused, 1);
  win.location.href = "elsewhere";
  fn();
  assert.equal(focused, 1);
  win.location.href = "local";
  target.isConnected = false;
  fn();
  assert.equal(focused, 1);
  assert.equal(closed, 3);
});
test("History panel labels, mount focus, Close and draft children remain accessible", () => {
  let focused = 0,
    closed = 0;
  const effects = [];
  const react = {
    useRef: () => ({ current: { focus: () => focused++ } }),
    useEffect: (fn, deps) => {
      assert.equal(deps.length, 0);
      effects.push(fn);
    },
  };
  const { ArtifactHistoryPanel } = loadUiModule("src/components/ArtifactHistoryPanel.tsx", {
    react,
    "lucide-react": { X: "X" },
  });
  const child = { type: "button", props: { children: "Compare saved version" } };
  const tree = ArtifactHistoryPanel({
    summary: "Not confirmed saved",
    onClose: () => closed++,
    children: child,
  });
  effects.forEach((fn) => fn());
  assert.equal(focused, 1);
  assert.equal(tree.type, "aside");
  assert.equal(tree.props["aria-label"], "Version history");
  assert.match(text(tree), /Not confirmed saved/);
  assert.ok(elements(tree).includes(child));
  elements(tree, (n) => n.props["aria-label"] === "Close version history")[0].props.onClick();
  assert.equal(closed, 1);
});
test("Modal Escape closes History without invoking editor close; backdrop still follows editor guard", () => {
  const hooks = createHookHarness();
  let history = 0,
    editor = 0,
    prevented = 0;
  const { ArtifactEditorSurface } = loadUiModule("src/components/ArtifactEditorSurface.tsx", {
    react: hooks.react,
    "@radix-ui/react-dialog": Object.fromEntries(
      ["Root", "Portal", "Overlay", "Content", "Title"].map((n) => [n, n]),
    ),
    "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
  });
  const tree = hooks.render(ArtifactEditorSurface, {
    presentation: "dialog",
    label: "Code",
    onRequestClose: () => editor++,
    onEscape: () => history++,
    children: "draft",
  });
  const c = elements(tree, (n) => n.type === "Content")[0];
  c.props.onEscapeKeyDown({ preventDefault: () => prevented++ });
  assert.equal(history, 1);
  assert.equal(editor, 0);
  assert.equal(prevented, 1);
  c.props.onPointerDownOutside({
    preventDefault() {},
    detail: { originalEvent: { button: 0, ctrlKey: false } },
  });
  assert.equal(editor, 1);
  assert.match(
    source,
    /onEscape=\{outlineOpen \? closeOutline : historyOpen \? closeHistory : undefined\}/,
  );
  assert.match(
    source,
    /if \(outlineOpen\) closeOutline\(\);\s+else if \(historyOpen\) closeHistory\(\);\s+else requestClose\(\);/,
  );
});
test("Save effects and history navigation handlers unchanged; footer/recovery markup preserved", () => {
  const old = execFileSync(
    "git",
    ["show", "3861d409fce5e59f08e7eead950fbc14a8bb0c66:src/components/ArtifactEditor.tsx"],
    { encoding: "utf8" },
  );
  function effects(s) {
    const ast = ts.createSourceFile("a.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
      out = [];
    function visit(n) {
      if (
        ts.isCallExpression(n) &&
        n.expression.getText(ast) === "useEffect" &&
        !n.getText(ast).includes('window.addEventListener("keydown"')
      )
        out.push(n.getText(ast));
      ts.forEachChild(n, visit);
    }
    visit(ast);
    return out;
  }
  assert.deepEqual(effects(source), effects(old));
  for (const [start, end] of [
    ["{historyError ?", "          </"],
    ["{canPersistVersions && (collaboration.conflict", "    </ArtifactEditorSurface>"],
  ]) {
    if (start === "{historyError ?") {
      const segment = (s) =>
        s
          .slice(s.indexOf("            {historyError ?"), s.indexOf("        {commentsOpen ?"))
          .replace(/<\/ArtifactHistoryPanel>/, "</aside>");
      assert.equal(segment(source), segment(old));
    } else assert.equal(source.slice(source.indexOf(start)), old.slice(old.indexOf(start)));
  }
  assert.ok(!source.includes("Edits are saved to this chat and stay available"));
});

test("History and Comments share one auxiliary panel at a time without clearing drafts", () => {
  assert.match(
    source,
    /if \(!commentsOpen\) setHistoryOpen\(false\);\s+setCommentsOpen\(\(v\) => !v\);/,
  );
  assert.match(
    source,
    /historyUrlRef.current = window.location.href;\s+setCommentsOpen\(false\);\s+setHistoryOpen\(true\);/,
  );
});
