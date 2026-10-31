import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as usagePolicy from "../../src/lib/plan-usage-policy.mjs";
import ts from "typescript";
import * as localAttachments from "../../src/lib/composer-local-attachments.mjs";
import * as pdfMetadata from "../../src/lib/document-extraction/pdf-metadata.mjs";

const compiled = ts.transpileModule(readFileSync("src/components/ChatInput.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);

// Actual composer callbacks with inert hooks and browser/service doubles. No
// chooser, user file, auth navigation, provider call, upload or quota is real.
function fixture(
  initial = {},
  initialAccount = { isLoaded: true, user: null },
  initialLayout = { isDesktop: true, isMobile: false, interaction: "pointer" },
) {
  let account = initialAccount,
    cursor = 0,
    tree,
    dirty = true,
    nextId = 0;
  const hooks = [],
    reads = [],
    saves = [],
    quotas = [],
    changes = [],
    attachmentChanges = [],
    choosers = [],
    submissions = [],
    toolChanges = [];
  const scopes = new Map();
  const quotaStorage = new Map();
  const actualLimits = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/limits.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: actualLimits,
      require: (name) => {
        assert.equal(name, "./plan-usage-policy.mjs");
        return usagePolicy;
      },
      window: {},
      localStorage: {
        getItem: (key) => quotaStorage.get(key) ?? null,
        setItem: (key, value) => quotaStorage.set(key, value),
      },
    },
  );
  let props = {
    value: "Keep my draft",
    attachments: [],
    isStreaming: false,
    showAddMenu: true,
    onChange: (value) => {
      changes.push(value);
      props.value = value;
      dirty = true;
    },
    onAttachmentsChange: (value) => {
      attachmentChanges.push(value);
      props.attachments = value;
      dirty = true;
    },
    onSubmit: () => submissions.push(true),
    onStop() {},
    onToolSelect: (tool) => toolChanges.push(tool),
    ...initial,
  };
  const react = {
    useRef(value) {
      const index = cursor++;
      hooks[index] ??= { current: value };
      return hooks[index];
    },
    useState(value) {
      const index = cursor++;
      hooks[index] ??= { value };
      return [
        hooks[index].value,
        (next) => {
          hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
          dirty = true;
        },
      ];
    },
    useEffect() {},
    useSyncExternalStore: () => true,
    lazy: (loader) => String(loader).match(/Composer[A-Za-z]+/)?.[0] ?? "Lazy",
    Suspense: "Suspense",
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": {},
    "@tanstack/react-router": {
      useNavigate: () => () => {
        throw new Error("Unexpected navigation");
      },
    },
    "@/components/auth/ClerkSafe": { useUser: () => account, SignInButton: "SignInButton" },
    "@/hooks/use-mobile": {
      useLayout: () => initialLayout,
    },
    "@/lib/composer-local-attachments.mjs": localAttachments,
    "@/lib/document-extraction/pdf-metadata.mjs": pdfMetadata,
    "@/lib/composer-preferences": { useSharedSendOnEnter: () => true },
    "@/lib/limits": {
      tryUseUpload: (limit) => {
        quotas.push(limit);
        return actualLimits.tryUseUpload(limit, "synthetic-owner");
      },
    },
    "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 10 } },
    "@/lib/composer-keyboard.mjs": {},
    "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
    "@/lib/composer-paste": { prepareComposerPaste: (plain) => plain },
    sonner: { toast: { error() {}, message() {} } },
    "@/hooks/use-library-attachment-auto-save": {
      useLibraryAttachmentAutoSave: () => {
        const principal = account.user?.id ?? "guest";
        if (!scopes.has(principal)) scopes.set(principal, { principal });
        return { scope: scopes.get(principal), save: (...args) => saves.push(args) };
      },
    },
  };
  for (const name of [
    "ComposerVoiceDialog",
    "ComposerUploadAllowance",
    "ComposerPdfPages",
    "ComposerContextPanel",
    "ComposerModelStatus",
    "MobileBottomSheet",
    "ResponsiveModelSelector",
    "ComposerDrawingDialog",
    "ComposerPluginList",
  ])
    modules[`@/components/${name}`] = { [name]: name };
  for (const [module, names] of [
    ["dialog", ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"]],
    ["popover", ["Popover", "PopoverContent", "PopoverTrigger"]],
    ["select", ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]],
  ])
    modules[`@/components/ui/${module}`] = Object.fromEntries(names.map((name) => [name, name]));
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
    window: {
      location: { href: "https://local.test/chat/unchanged" },
      requestAnimationFrame: (run) => run(),
    },
    crypto: { randomUUID: () => `synthetic-${++nextId}` },
    TextEncoder,
    Set,
    Map,
    Date,
    Promise,
    FileReader: class {
      constructor() {
        reads.push("image reader");
      }
    },
  });
  const targets = new Map();
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports.ChatInput(props);
    for (const node of nodes(tree))
      if (node.props.ref && typeof node.props.ref === "object") {
        const label = node.props["aria-label"] ?? node.type;
        if (!targets.has(label))
          targets.set(label, {
            focus() {},
            click: () => choosers.push(label),
            selectionStart: 0,
            selectionEnd: 0,
          });
        node.props.ref.current = targets.get(label);
      }
  }
  async function flush() {
    for (let i = 0; i < 5; i++) {
      await new Promise(setImmediate);
      if (dirty) render();
    }
  }
  function button(label) {
    const node = nodes(tree).find(
      (node) =>
        node.type === "button" &&
        (text(node).trim() === label || node.props["aria-label"] === label),
    );
    assert.ok(node, `Missing ${label}`);
    return node.props;
  }
  render();
  return {
    reads,
    saves,
    quotas,
    changes,
    attachmentChanges,
    choosers,
    submissions,
    toolChanges,
    nodes: () => nodes(tree),
    root: () => tree.props,
    button,
    flush,
    signIn: () => nodes(tree).find((node) => node.type === "ComposerSignInDialog")?.props,
    drawing: () => nodes(tree).find((node) => node.type === "ComposerDrawingDialog").props,
    attachments: () => props.attachments,
    async changeDraft(value) {
      props.value = value;
      dirty = true;
      await flush();
    },
    input: () => nodes(tree).find((node) => node.type === "textarea").props,
    async click(label) {
      await button(label).onClick();
      await flush();
    },
    async account(next) {
      account = next;
      dirty = true;
      await flush();
    },
    file() {
      return {
        name: "Private.txt",
        type: "text/plain",
        size: 9,
        text: async () => {
          reads.push("text reader");
          return "File text";
        },
      };
    },
  };
}

const signedIn = { isLoaded: true, user: { id: "owner-a" } };
const exactText = "  first\r\n\t" + "Line with emoji 🙂 and words.\n".repeat(600) + "tail  ";
const paste = (plain, html = "<b>this must never replace the clipboard text</b>") => ({
  target: { tagName: "TEXTAREA", selectionStart: 4, selectionEnd: 8 },
  clipboardData: { files: [], getData: (type) => (type === "text/plain" ? plain : html) },
  preventDefault() {},
});

test("long paste becomes one exact local text attachment, with no save/read/upload/submission", async () => {
  const f = fixture({}, signedIn);
  await f.root().onPaste(paste(exactText));
  await f.flush();
  assert.equal(f.attachments().length, 1);
  assert.equal(f.attachments()[0].name, "pasted-text.txt");
  assert.equal(f.attachments()[0].textContent, exactText);
  assert.equal(f.attachments()[0].fileType, "text/plain");
  assert.equal(f.attachments()[0].dataUrl, "");
  assert.equal(f.input().value, "Keep my draft");
  assert.deepEqual([f.reads, f.saves, f.submissions], [[], [], []]);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.nodes().filter((node) => node.type === "pre").length, 0);
  assert.equal(text(f.nodes()).includes(exactText), false);
});

test("inspection mounts at most4,000 exact characters, pages lazily, and closes cleanly", async () => {
  const f = fixture({}, signedIn);
  await f.root().onPaste(paste(exactText));
  await f.flush();
  f.button("Inspect pasted-text.txt").onClick({ currentTarget: { isConnected: true } });
  await f.flush();
  let previews = f.nodes().filter((node) => node.type === "pre");
  assert.equal(previews.length, 1);
  assert.ok(previews[0].props.children.length <= 4_000);
  assert.equal(previews[0].props.children, exactText.slice(0, previews[0].props.children.length));
  await f.click("Next text");
  previews = f.nodes().filter((node) => node.type === "pre");
  assert.equal(previews.length, 1);
  assert.ok(previews[0].props.children.length <= 4_000);
  const dialog = f.nodes().find((node) => node.type === "Dialog" && node.props.open);
  dialog.props.onOpenChange(false);
  await f.flush();
  assert.equal(f.nodes().filter((node) => node.type === "pre").length, 0);
  assert.equal(f.attachments()[0].textContent, exactText);
});

test("Back to text restores exact paste at the original selection without auto-sending", async () => {
  const f = fixture({}, signedIn);
  await f.root().onPaste(paste(exactText));
  await f.flush();
  f.button("Inspect pasted-text.txt").onClick({ currentTarget: {} });
  await f.flush();
  await f.click("Back to text");
  assert.equal(f.input().value, "Keep" + exactText + "draft");
  assert.equal(f.attachments().length, 0);
  assert.deepEqual(f.submissions, []);
});

test("Back to text preserves a newer draft and removal Undo does not use quota again", async () => {
  const f = fixture({}, signedIn);
  await f.root().onPaste(paste(exactText));
  await f.flush();
  await f.click("Remove pasted-text.txt");
  assert.equal(f.attachments().length, 0);
  await f.click("Undo removal");
  assert.equal(f.attachments()[0].textContent, exactText);
  assert.deepEqual(f.quotas, []);
  await f.changeDraft("New instructions");
  f.button("Inspect pasted-text.txt").onClick({ currentTarget: {} });
  await f.flush();
  await f.click("Back to text");
  assert.equal(f.input().value, "New instructions\n\n" + exactText);
});

test("guest paste is local pending input, blocks omission on Send, and still requires sign-in to attach", async () => {
  const f = fixture();
  await f.root().onPaste(paste(exactText));
  await f.flush();
  assert.equal(f.attachments().length, 0);
  assert.equal(f.button("Send message").disabled, true);
  await f.click("Send message");
  assert.deepEqual(f.submissions, []);
  f.button("Inspect pending pasted text").onClick({ currentTarget: {} });
  await f.flush();
  await f.click("Attach text");
  assert.ok(f.signIn());
  assert.deepEqual([f.quotas, f.saves, f.attachmentChanges], [[], [], []]);
  await f.click("Back to text");
  assert.equal(f.input().value, "Keep" + exactText + "draft");
});

test("local paste remove/re-add does not consume server upload allowance; daily Free allowance is ten while per-message slots remain two", async () => {
  const modes = readFileSync("src/lib/modes.ts", "utf8");
  assert.match(modes, /free: DAILY_PLAN_ALLOWANCES.free.uploads/);
  assert.equal(usagePolicy.DAILY_PLAN_ALLOWANCES.free.uploads, 10);
  const f = fixture({}, signedIn);
  for (let index = 0; index < 2; index++) {
    await f.root().onPaste(paste(exactText));
    await f.flush();
    assert.equal(f.attachments().length, 1);
    await f.click("Remove pasted-text.txt");
  }
  await f.root().onPaste(paste(exactText));
  await f.flush();
  assert.equal(f.attachments().length, 1);
  assert.deepEqual(f.quotas, []);
  assert.deepEqual(f.saves, []);
  assert.match(readFileSync("src/routes/api/chat.ts", "utf8"), /reserveUploads/);
});

test("two attachment slots do not silently drop new pasted text", async () => {
  const f = fixture(
    {
      attachments: [1, 2].map((id) => ({
        clientId: `file-${id}`,
        kind: "text_file",
        name: `file-${id}.txt`,
        textContent: "ready",
        dataUrl: "",
        status: "complete",
      })),
    },
    signedIn,
  );
  await f.root().onPaste(paste(exactText));
  await f.flush();
  assert.equal(f.attachments().length, 2);
  assert.deepEqual(f.quotas, []);
  assert.equal(f.button("Send message").disabled, true);
  assert.match(text(f.nodes()), /Two files are already attached/);
  await f.click("Back to text");
  assert.equal(f.attachments().length, 2);
  assert.ok(f.input().value.includes(exactText));
});

test("explicit file selection keeps its existing save flow; image chips never decode full thumbnails", async () => {
  const f = fixture({}, signedIn);
  assert.equal(await f.drawing().onAttach([f.file()]), true);
  await f.flush();
  assert.equal(f.saves.length, 1);
  const image = fixture(
    {
      attachments: [
        {
          kind: "image",
          name: "large-image.png",
          dataUrl: "data:image/png;base64,existing-payload",
          status: "complete",
        },
      ],
    },
    signedIn,
  );
  assert.equal(image.nodes().filter((node) => node.type === "img").length, 0);
  image.button("Inspect large-image.png").onClick({ currentTarget: {} });
  await image.flush();
  assert.equal(image.nodes().filter((node) => node.type === "img").length, 1);
});

test("ordinary short rich text remains native plain-text input and is not converted", async () => {
  const f = fixture({}, signedIn);
  let prevented = false;
  await f.root().onPaste({
    ...paste("Short text"),
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.deepEqual([f.attachmentChanges, f.quotas, f.saves], [[], [], []]);
});
