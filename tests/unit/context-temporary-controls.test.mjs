import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadUiModule, createHookHarness, elements, text } from "../helpers/ui-state-harness.mjs";
const source = readFileSync("src/components/ChatInput.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChatInput.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function callback(name, globals) {
  let value;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) value = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.ok(value);
  return vm.runInNewContext(
    ts.transpileModule(`(${value.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    globals,
  );
}
test("Context panel reports actual files/project/tool and removes only selected message attachment", () => {
  const { ComposerContextPanel } = loadUiModule("src/components/ComposerContextPanel.tsx", {});
  let removed;
  const attachments = [
    { name: "notes.txt", sourceProject: "Launch", status: "complete" },
    { name: "photo.png", status: "uploading" },
  ];
  const tree = ComposerContextPanel({
    attachments,
    selectedTool: "Search the web",
    disabled: false,
    onRemove: (i) => (removed = i),
    library: "Saved Library choices",
  });
  assert.match(text(tree), /Attached files \(\s*2\s*\/2\)/);
  assert.match(text(tree), /Launch/);
  assert.match(text(tree), /uploading/);
  assert.match(text(tree), /does not change memory/);
  elements(tree, (n) => n.type === "button")[1].props.onClick();
  assert.equal(removed, 1);
  const locked = ComposerContextPanel({
    attachments,
    disabled: true,
    onRemove: () => {},
    library: null,
  });
  assert.ok(elements(locked, (n) => n.type === "button").every((n) => n.props.disabled));
});
test("Context Library selection reuses bounded attachment contract and preserves draft", () => {
  const state = { files: [], draft: "Keep my draft", contextOpen: true, returnToInput: false };
  const focus = [];
  const g = {
    disabled: false,
    isStreaming: false,
    isLoaded: true,
    user: { id: "account" },
    attachments: [],
    contextOpen: true,
    contextReturnToInputRef: { current: false },
    updateAttachments: (a) => (state.files = a),
    setPlusOpen: () => {},
    setLibraryOpen: () => {},
    setContextOpen: (x) => (state.contextOpen = x),
    setUploadAnnouncement: () => {},
    toast: { message: () => {}, error: () => {} },
    ref: { current: { focus: () => focus.push("input") } },
  };
  const choose = callback("attachLibraryFile", g),
    file = {
      id: "saved-1",
      title: "Saved notes",
      fileName: "notes.txt",
      fileSize: 123,
      projectName: "Launch",
    };
  choose(file);
  assert.equal(state.files[0].libraryItemId, "saved-1");
  assert.equal(state.files[0].sourceProject, "Launch");
  assert.equal(state.draft, "Keep my draft");
  assert.equal(state.contextOpen, false);
  assert.equal(g.contextReturnToInputRef.current, true);
  g.attachments = state.files;
  choose(file);
  assert.equal(state.files.length, 1);
  g.attachments = [{}, {}];
  choose({ ...file, id: "saved-2" });
  assert.equal(state.files.length, 1);
  for (const key of ["disabled", "isStreaming"]) {
    g.attachments = [];
    g[key] = true;
    choose(file);
    assert.equal(state.files.length, 1);
    g[key] = false;
  }
  g.user = null;
  choose(file);
  assert.equal(state.files.length, 1);
});
test("Context dismissal restores invoking control; attachment choice restores draft; navigation skips focus", () => {
  let fn;
  const visit = (n) => {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(ast) === "DialogContent" &&
      n.getText(ast).includes("<ComposerContextPanel")
    )
      fn = n.openingElement.attributes.properties.find(
        (p) => p.name?.getText(ast) === "onCloseAutoFocus",
      ).initializer.expression;
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.ok(fn);
  const focused = [],
    target = (name) => ({
      closest: () => null,
      matches: () => false,
      isConnected: true,
      getClientRects: () => [{}],
      focus: () => focused.push(name),
    }),
    g = {
      contextSwitchingDialogRef: { current: false },
      contextReturnToInputRef: { current: false },
      contextTriggerRef: { current: target("context") },
      ref: { current: target("input") },
      contextReturnUrlRef: { current: "http://local/" },
      window: { location: { href: "http://local/" } },
    };
  g.restoreDialogFocus = loadUiModule(
    "src/lib/dialog-return-focus.ts",
    {},
    { window: g.window },
  ).restoreDialogFocus;
  const close = vm.runInNewContext(
    ts.transpileModule(`(${fn.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    g,
  );
  close({ preventDefault() {} });
  g.contextReturnToInputRef.current = true;
  close({ preventDefault() {} });
  assert.deepEqual(focused, ["context", "input"]);
  g.window.location.href = "http://local/elsewhere";
  close({ preventDefault() {} });
  assert.equal(focused.length, 2);
});
function tempFixture() {
  const hooks = createHookHarness(),
    closed = [],
    started = [],
    focused = [];
  const win = { location: { href: "http://local/" } };
  const target = {
    closest: () => null,
    matches: () => false,
    isConnected: true,
    getClientRects: () => [{}],
    focus: () => focused.push(true),
  };
  const m = loadUiModule(
    "src/components/TemporaryChatStartDialog.tsx",
    {
      "@/lib/dialog-return-focus": loadUiModule(
        "src/lib/dialog-return-focus.ts",
        {},
        { window: win },
      ),
      react: hooks.react,
      "lucide-react": Object.fromEntries(
        ["Check", "MessageCircleOff", "ShieldCheck", "Sparkles"].map((n) => [n, n]),
      ),
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": Object.fromEntries(
        ["Dialog", "DialogContent", "DialogDescription", "DialogTitle"].map((n) => [n, n]),
      ),
      "@/components/ui/radio-group": { RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem" },
    },
    { window: win },
  );
  const tree = hooks.render(m.TemporaryChatStartDialog, {
    open: true,
    onOpenChange: (x) => closed.push(x),
    onStart: (x) => started.push(x),
    returnFocusTarget: target,
    returnFocusUrl: "http://local/",
  });
  return {
    m,
    tree,
    closed,
    started,
    focused,
    target,
    win,
    close: () =>
      elements(tree, (n) => n.type === "DialogContent")[0].props.onCloseAutoFocus({
        preventDefault() {},
      }),
  };
}
for (const method of ["Cancel", "Escape"])
  test(`temporary ${method} returns focus without starting a chat`, () => {
    const f = tempFixture();
    if (method === "Cancel")
      elements(
        f.tree,
        (n) => n.type === "Button" && text(n).trim() === "Cancel",
      )[0].props.onClick();
    else elements(f.tree, (n) => n.type === "Dialog")[0].props.onOpenChange(false);
    f.close();
    assert.deepEqual(f.closed, [false]);
    assert.equal(f.started.length, 0);
    assert.equal(f.focused.length, 1);
  });
test("temporary return focus skips navigation, detached trigger and starting chat", () => {
  for (const mode of ["navigate", "detach", "start"]) {
    const f = tempFixture();
    if (mode === "navigate") f.win.location.href = "http://local/new";
    if (mode === "detach") f.target.isConnected = false;
    if (mode === "start")
      elements(
        f.tree,
        (n) => n.type === "Button" && text(n).includes("Start temporary chat"),
      )[0].props.onClick();
    f.close();
    assert.equal(f.focused.length, 0);
  }
});
test("temporary toggle uses recognizable chat icon and passes exact invoking button", () => {
  const f = tempFixture();
  let trigger;
  const node = f.m.TemporaryChatToggle({
    enabled: false,
    confirmed: false,
    onToggle: (x) => (trigger = x),
  });
  assert.equal(node.props["aria-label"], "Start temporary chat");
  node.props.onClick({ currentTarget: f.target });
  assert.equal(trigger, f.target);
  assert.equal(elements(node, (n) => n.type === "MessageCircleOff").length, 1);
});
test("mobile temporary and chat-settings controls pass exact invoking buttons", () => {
  const { MobileTopBar } = loadUiModule("src/components/MobileTopBar.tsx", {
    "lucide-react": Object.fromEntries(
      ["PanelLeft", "MessageCircleOff", "Sliders", "SquarePen"].map((n) => [n, n]),
    ),
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ isLoaded: true, isSignedIn: true }),
      clerkEnabled: true,
      SignInButton: "SignInButton",
      SignUpButton: "SignUpButton",
    },
    "@/components/ResponsiveModelSelector": { ResponsiveModelSelector: "ResponsiveModelSelector" },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
  });
  let temp, settings;
  const target = {};
  const tree = MobileTopBar({
    onOpenSidebar() {},
    onNewChat() {},
    onTemporaryChatChange: (...args) => (temp = args),
    onOpenChatSettings: (x) => (settings = x),
  });
  elements(tree, (n) => n.props?.["aria-label"] === "Start temporary chat")[0].props.onClick({
    currentTarget: target,
  });
  elements(tree, (n) => n.props?.["aria-label"] === "Chat settings")[0].props.onClick({
    currentTarget: target,
  });
  assert.deepEqual(temp, [true, target]);
  assert.equal(settings, target);
  assert.equal(elements(tree, (n) => n.type === "MessageCircleOff").length, 1);
});
