import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { loadUiModule, createHookHarness, elements, text } from "../helpers/ui-state-harness.mjs";
const base = "9b7091f10d53493de675b347e56643b2517b471f";
const route = "src/routes/projects.$projectId.chat.$chatId.tsx";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
function composer() {
  const h = createHookHarness(),
    win = { location: { href: "http://local/project" } },
    identity = { user: { id: "owner" }, isLoaded: true };
  const fail = () => {
    throw Error("No provider, upload or write authorized in this rendering test");
  };
  const dependencies = {
    react: {
      ...h.react,
      lazy: () => "Lazy",
      Suspense: "Suspense",
      useSyncExternalStore: () => true,
    },
    "lucide-react": new Proxy({}, { get: (_, name) => name }),
    "@/components/auth/ClerkSafe": { useUser: () => identity, SignInButton: "SignInButton" },
    "@/hooks/use-library-attachment-auto-save": {
      useLibraryAttachmentAutoSave: () => ({ scope: identity.user?.id, save: fail }),
    },
    "@/hooks/use-mobile": { useLayout: () => ({ isDesktop: false, interaction: "touch" }) },
    "@/lib/composer-preferences": { useSharedSendOnEnter: () => true },
    "@/lib/limits": { tryUseUpload: fail },
    sonner: { toast: { error: fail, message: fail } },
    "@/components/ResponsiveModelSelector": { ResponsiveModelSelector: "ModelSelector" },
    "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 1 } },
    "@/lib/composer-keyboard.mjs": { shouldSubmitComposerOnEnter: () => false },
    "@/lib/dialog-return-focus": loadUiModule(
      "src/lib/dialog-return-focus.ts",
      {},
      { window: win },
    ),
  };
  for (const name of [
    "ComposerContextPanel",
    "ComposerModelStatus",
    "MobileBottomSheet",
    "ComposerDrawingDialog",
    "ComposerPluginList",
  ])
    dependencies["@/components/" + name] = { [name]: name };
  for (const [path, names] of [
    ["popover", ["Popover", "PopoverTrigger", "PopoverContent"]],
    ["dialog", ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"]],
  ])
    dependencies["@/components/ui/" + path] = Object.fromEntries(names.map((n) => [n, n]));
  const { ChatInput } = loadUiModule("src/components/ChatInput.tsx", dependencies, { window: win });
  const props = {
    value: "Keep this draft",
    onChange: fail,
    onSubmit: fail,
    onStop: fail,
    isStreaming: false,
    disabled: false,
    showAddMenu: false,
    attachments: [],
    onAttachmentsChange: fail,
    canChangeAgent: false,
    showModelStatus: true,
    readOnlyContext: {
      title: "Project context",
      description: "Review saved context",
      content: "Read-only project details",
    },
  };
  return { h, identity, win, props, render: () => h.render(ChatInput, props) };
}
test("Read-only Project Context opens with no Add/Library attachment interface or writes, preserving draft and exact return focus", () => {
  const f = composer();
  f.render();
  let tree = f.render();
  assert.equal(
    elements(
      tree,
      (n) => n.type === "button" && n.props["aria-label"] === "Add files, tools, or prompts",
    ).length,
    0,
  );
  assert.equal(elements(tree, (n) => n.type === "ComposerContextPanel").length, 0);
  assert.equal(elements(tree, (n) => n.type === "ModelSelector").length, 0);
  assert.equal(elements(tree, (n) => n.type === "ComposerModelStatus")[0].props.visible, true);
  const button = elements(
    tree,
    (n) => n.type === "button" && n.props["aria-label"] === "Project context",
  )[0];
  assert.ok(button);
  let focused = 0;
  button.props.ref.current = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused++,
  };
  button.props.onClick();
  tree = f.render();
  const dialog = elements(
    tree,
    (n) => n.type === "Dialog" && text(n).includes("Read-only project details"),
  )[0];
  assert.equal(dialog.props.open, true);
  const content = elements(dialog, (n) => n.type === "DialogContent")[0];
  dialog.props.onOpenChange(false);
  content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(focused, 1);
  assert.equal(f.props.value, "Keep this draft");
  assert.deepEqual(f.props.attachments, []);
  f.props.disabled = true;
  tree = f.render();
  assert.equal(
    elements(tree, (n) => n.type === "button" && n.props["aria-label"] === "Project context")[0]
      .props.disabled,
    false,
    "read-only context remains inspectable for viewer",
  );
  f.identity.user = null;
  f.render();
  tree = f.render();
  assert.equal(elements(tree, (n) => n.type === "ComposerModelStatus")[0].props.visible, false);
  assert.equal(
    elements(tree, (n) => n.type === "Dialog" && text(n).includes("Read-only project details"))[0]
      .props.open,
    false,
  );
});
test("Ordinary composers retain their Add and message-context rendering when no custom read-only context is supplied", () => {
  const f = composer();
  f.props.readOnlyContext = undefined;
  f.props.showAddMenu = true;
  const tree = f.render();
  assert.equal(
    elements(
      tree,
      (n) => n.type === "button" && n.props["aria-label"] === "Add files, tools, or prompts",
    ).length,
    1,
  );
  assert.equal(elements(tree, (n) => n.type === "ComposerContextPanel").length, 1);
});
test("Project context uses escaped saved instructions with truthful file limits and no actions beyond project navigation", () => {
  const module = { exports: {} };
  vm.runInNewContext(compile(readFileSync("src/components/ProjectChatContext.tsx", "utf8")), {
    module,
    exports: module.exports,
    require: (id) =>
      id === "react/jsx-runtime"
        ? runtime
        : {
            Link: ({ children, params, ...p }) =>
              runtime.jsx("a", { href: "/projects/" + params.projectId, children }),
          },
  });
  const render = (project) =>
    renderToStaticMarkup(
      runtime.jsx(module.exports.ProjectChatContext, { projectId: "p1", project }),
    );
  const instructions = "  Keep indentation\n<script>unsafe</script>\n",
    html = render({ name: "Research <one>", system_prompt: instructions });
  assert.ok(html.includes("  Keep indentation\n&lt;script&gt;unsafe&lt;/script&gt;\n"));
  assert.match(html, /Research &lt;one&gt;/);
  assert.match(html, /does not confirm which files or excerpts/);
  assert.match(html, /direct message attachments and agent selection are not available here/);
  assert.doesNotMatch(html, /<button|<input|<textarea|<script/);
  assert.match(render(null), /Project details are unavailable/);
  assert.match(render({ name: "P", system_prompt: null }), /No project instructions were saved/);
});
test("Project sends/stops/saves/rename/delete handlers and response rendering are unchanged", () => {
  const old = execFileSync("git", ["show", base + ":" + route], { encoding: "utf8" }),
    current = readFileSync(route, "utf8");
  function named(s, name) {
    const ast = ts.createSourceFile("x.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found;
    const visit = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(ast);
      ts.forEachChild(n, visit);
    };
    visit(ast);
    assert.ok(found);
    return compile(found);
  }
  for (const n of ["handleSend", "handleStop", "handleDelete", "handleRename", "openRenameDialog"])
    assert.equal(named(current, n), named(old, n));
  for (const path of [
    "src/components/ChatMessage.tsx",
    "src/lib/projects.functions.ts",
    "src/routes/api/chat.ts",
    "src/components/ComposerModelStatus.tsx",
    "src/lib/core-launch-policy.mjs",
  ])
    assert.equal(
      path === "src/lib/core-launch-policy.mjs"
        ? readFileSync(path, "utf8").replace('  "/work",\n', "").replace('  "/discovery",\n', "")
        : readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
  assert.match(
    current,
    /<main\s+id="main-content"\s+tabIndex=\{-1\}\s+className="kova-project-chat/,
  );
  assert.match(current, /showAddMenu=\{false\}/);
  assert.match(current, /canChangeAgent=\{false\}\s+showModelStatus/);
  assert.match(current, /<Input\s+className="kova-workspace-action"\s+value=\{renameDraft\}/);
  const expression = current.match(/project=\{\s*(loadedContextOwnerRef[\s\S]*?)\n\s*\}/)?.[1];
  assert.ok(expression);
  for (const [owner, id, expected] of [
    ["owner", "p1", true],
    ["different", "p1", false],
    ["owner", "p2", false],
  ]) {
    const project = { id, system_prompt: "private" };
    assert.equal(
      Boolean(
        vm.runInNewContext(expression, {
          loadedContextOwnerRef: { current: owner },
          userKey: "owner",
          projectId: "p1",
          project,
        }),
      ),
      expected,
    );
  }
});
