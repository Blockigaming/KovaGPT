import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in modules, `Unexpected import ${name}`);
    return modules[name];
  });
  return exports;
}
const artifacts = load("src/components/artifact-utils.ts");
const urls = load("src/lib/safe-url.ts");
const imageUrls = load("src/lib/safe-image-url.ts", { "./safe-url.ts": urls });
const { conversationOutputs } = load("src/lib/conversation-outputs.ts", {
  "../components/artifact-utils": artifacts,
  "./safe-image-url": imageUrls,
});
const { exportConversationMarkdown } = load("src/lib/chat-store.ts", {
  "./response-followups.mjs": {},
  "./task-created-receipt.mjs": {},
  "./memory-sources.mjs": {},
  "./chat-history-bridge.ts": {},
  "./response-sources.ts": {},
});
const { safeDocumentFilename } = load("src/lib/writing-export/common.ts");
const chat = {
  id: "chat-a",
  title: "Release review",
  mode: "instant",
  createdAt: 1,
  updatedAt: 1,
  messages: [],
};

test("outputs are scoped to actual attachments and generated artifacts", () => {
  const result = conversationOutputs({
    ...chat,
    messages: [
      {
        id: "user",
        role: "user",
        content: "```js\nuser code\n```",
        attachments: [
          { kind: "text_file", name: "notes.txt", content: "Keep this text." },
          { kind: "text_file", name: "brief.pdf", content: "Extracted PDF text" },
          { kind: "library_file", name: "Saved report", libraryItemId: "library-1" },
          { kind: "image", dataUrl: "data:image/png;base64,AAAA" },
        ],
      },
      { id: "answer", role: "assistant", content: "```js\nconst released = true;\n```" },
      {
        id: "failed",
        role: "assistant",
        generationStatus: "failed",
        content: "```js\npartial\n```",
      },
    ],
  });
  assert.equal(result.length, 5);
  assert.equal(result[0].downloadName, "notes.txt");
  assert.equal(result[0].extracted, false);
  assert.equal(result[1].downloadName, "brief.pdf.txt");
  assert.equal(result[1].extracted, true);
  assert.equal(result[2].kind, "library");
  assert.equal(result[2].content, undefined);
  assert.equal(result[3].source, "data:image/png;base64,AAAA");
  assert.equal(result[4].content, "const released = true;");
  assert.equal(result[4].artifactKind, "code");
  assert.deepEqual(conversationOutputs(chat), []);
});

test("unsafe image sources are not previewed and filenames cannot traverse paths", () => {
  const rows = conversationOutputs({
    ...chat,
    messages: [
      {
        id: "u",
        role: "user",
        content: "",
        attachments: [
          { kind: "image", dataUrl: "data:image/svg+xml,<svg onload=alert(1)>" },
          { kind: "text_file", name: "../../bad:name.txt", content: "text" },
        ],
      },
    ],
  });
  assert.equal(rows[0].source, null);
  assert.doesNotMatch(rows[1].downloadName, /[\\/:]/);
});

const nodes = (value) =>
  value == null || typeof value !== "object"
    ? []
    : Array.isArray(value)
      ? value.flatMap(nodes)
      : [value, ...nodes(value.props?.children)];
const text = (value) =>
  value == null || typeof value === "boolean"
    ? ""
    : Array.isArray(value)
      ? value.map(text).join("")
      : typeof value === "object"
        ? text(value.props?.children)
        : String(value);
function fixture(overrides = {}, desktop = true) {
  let cursor = 0;
  const states = [];
  const calls = [];
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const modules = {
    react: {
      lazy: () => "LazyComponent",
      Suspense: "Suspense",
      useMemo: (fn) => fn(),
      useState(initial) {
        const i = cursor++;
        states[i] ??= { value: initial };
        return [
          states[i].value,
          (v) => {
            states[i].value = typeof v === "function" ? v(states[i].value) : v;
          },
        ];
      },
      useEffect() {},
      useRef(initial) {
        const i = cursor++;
        states[i] ??= { current: initial };
        return states[i];
      },
    },
    "react-dom": { createPortal: (node) => node },
    "./NovaLogo": { NovaLogo: "NovaLogo" },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": primitives([
      "ArrowLeft",
      "Archive",
      "File",
      "FileText",
      "Folder",
      "Image",
      "Library",
      "MoreHorizontal",
      "Pencil",
      "Pin",
      "PinOff",
      "Share",
      "Trash2",
      "Grid2X2",
      "Download",
      "Search",
      "Paperclip",
      "SlidersHorizontal",
    ]),
    "@tanstack/react-router": { Link: "Link" },
    "@/lib/chat-store": { exportConversationMarkdown },
    "@/lib/conversation-outputs": { conversationOutputs },
    "@/lib/writing-export/common": {
      safeDocumentFilename,
      downloadBytes: (...args) => calls.push(["download", ...args]),
    },
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ user: { id: "owner" }, isLoaded: true, isSignedIn: true }),
    },
    "@/lib/conversation-sources": {
      conversationSources: () => ({ web: [], memory: [], attachments: [], browser: [] }),
    },
    "@/hooks/use-mobile": { useLayout: () => ({ isDesktop: desktop }) },
    "./MobileBottomSheet": { MobileBottomSheet: "MobileBottomSheet" },
    "./MessageActivityList": { MessageActivityList: "MessageActivityList" },
    "./ConversationSourcesPanel": {
      ConversationSourcesPanel: "ConversationSourcesPanel",
      ConversationActivitySummary: "ConversationActivitySummary",
    },
    "./MemorySourcesDialog": { MemorySourcesDialog: "MemorySourcesDialog" },
    "@/lib/dialog-return-focus": {
      restoreDialogFocus: (...args) => calls.push(["focus", ...args]),
    },
    "@/components/ui/dropdown-menu": primitives([
      "DropdownMenu",
      "DropdownMenuContent",
      "DropdownMenuItem",
      "DropdownMenuSeparator",
      "DropdownMenuSub",
      "DropdownMenuSubContent",
      "DropdownMenuSubTrigger",
      "DropdownMenuTrigger",
    ]),
    "@/components/ui/popover": primitives(["Popover", "PopoverContent", "PopoverTrigger"]),
    "@/components/ui/dialog": primitives([
      "Dialog",
      "DialogContent",
      "DialogDescription",
      "DialogTitle",
      "DialogHeader",
    ]),
    "@/components/ui/button": { Button: "Button" },
    "./conversation-header.css": {},
    "./SidebarIcons": primitives(["PluginsGlyph", "LibraryGlyph", "ProjectsGlyph"]),
  };
  const { ConversationHeaderActions } = load(
    "src/components/ConversationHeaderActions.tsx",
    modules,
  );
  const props = {
    conversation: chat,
    signedIn: true,
    userTier: "plus",
    onShare: () => calls.push(["share"]),
    onRename: (title) => calls.push(["rename", title]),
    onTogglePin: () => calls.push(["pin"]),
    onArchive: () => calls.push(["archive"]),
    onDelete: () => calls.push(["delete"]),
    onManagePlugins: () => calls.push(["plugins"]),
    ...overrides,
  };
  return {
    calls,
    render() {
      cursor = 0;
      return ConversationHeaderActions(props);
    },
  };
}

const previousWindow = globalThis.window;
globalThis.window = { location: { href: "https://local.invalid/" } };
test.after(() => {
  globalThis.window = previousWindow;
});

test("desktop and compact headers contain Share and Activity only", () => {
  for (const compact of [false, true]) {
    const f = fixture({ compact });
    const root = f.render();
    const actions = nodes(root).find((node) => node.props["aria-label"] === "Conversation actions");
    assert.deepEqual(
      nodes(actions)
        .filter(
          (node) =>
            node.type === "button" && /^kova-conversation-(share|icon)$/.test(node.props.className),
        )
        .map((node) => node.props["aria-label"]),
      ["Share chat", "Activity"],
    );
    assert.equal(nodes(root).filter((node) => node.type === "DropdownMenuContent").length, 0);
    nodes(actions)
      .find((node) => node.props["aria-label"] === "Share chat")
      .props.onClick();
    assert.deepEqual(f.calls, [["share"]]);
  }
});

test("Activity uses current chat data, separates inputs, and hides inactive browser rows", () => {
  const empty = fixture();
  const root = empty.render();
  const activity = nodes(root).find((node) => node.type === "PopoverContent");
  assert.equal(activity.props["aria-label"], "Activity");
  assert.match(text(activity), /No outputs yet/);
  const sourcePanel = nodes(activity).find(
    (node) => node.type === "ConversationSourcesPanel" && !node.props.browserOnly,
  );
  assert.equal(sourcePanel.props.conversation, chat);
  assert.equal(sourcePanel.props.activeBrowserOnly, true);
  assert.equal(sourcePanel.props.separateInputs, true);
  const browserPanel = nodes(activity).find(
    (node) => node.type === "ConversationSourcesPanel" && node.props.browserOnly,
  );
  assert.equal(browserPanel.props.showActivity, true);
  assert.equal(browserPanel.props.conversation, chat);
  assert.equal(
    nodes(activity).filter((node) => node.props.className === "kova-output-row").length,
    0,
  );

  const f = fixture({
    conversation: {
      ...chat,
      messages: [
        {
          id: "input",
          role: "user",
          content: "Read this",
          attachments: [{ kind: "text_file", name: "input.txt", content: "Attached input" }],
        },
        { id: "output", role: "assistant", content: "```js\nconst actual = true;\n```" },
      ],
    },
  });
  const rows = nodes(f.render()).filter((node) => node.props.className === "kova-output-row");
  assert.equal(rows.length, 1);
  rows[0].props.onClick();
  assert.equal(text(nodes(f.render()).find((node) => node.type === "pre")), "const actual = true;");
});

test("temporary and signed-out Share requests explain restrictions without publishing", () => {
  for (const props of [{ conversation: { ...chat, temporary: true } }, { signedIn: false }]) {
    const f = fixture(props);
    nodes(f.render())
      .find((node) => node.props["aria-label"] === "Share chat")
      .props.onClick();
    const open = nodes(f.render()).find((node) => node.type === "Dialog" && node.props.open);
    assert.match(text(open), /Temporary chats cannot be shared|Sign in to share/);
    assert.deepEqual(f.calls, []);
  }
});

test("context handoff closes Activity and preserves its visible return-focus target", () => {
  const opened = [];
  const f = fixture({ onOpenContext: (target) => opened.push(target) });
  let root = f.render();
  const target = { id: "activity" };
  nodes(root).find(
    (node) => node.type === "button" && node.props["aria-label"] === "Activity",
  ).props.ref.current = target;
  nodes(root)
    .find((node) => node.type === "button" && text(node) === "Chat instructions and context")
    .props.onClick({ currentTarget: { id: "closing-row" } });
  root = f.render();
  assert.equal(nodes(root).find((node) => node.type === "Popover").props.open, false);
  let prevented = false;
  nodes(root)
    .find((node) => node.type === "PopoverContent")
    .props.onCloseAutoFocus({
      preventDefault() {
        prevented = true;
      },
    });
  assert.equal(prevented, true);
  assert.deepEqual(opened, [target]);
});

test("attachment preview returns focus to the visible Activity button", () => {
  const f = fixture({
    conversation: {
      ...chat,
      messages: [
        {
          id: "u",
          role: "user",
          content: "",
          attachments: [{ kind: "text_file", name: "notes.txt", content: "Notes" }],
        },
      ],
    },
  });
  let root = f.render();
  const target = { id: "activity" };
  nodes(root).find(
    (node) => node.type === "button" && node.props["aria-label"] === "Activity",
  ).props.ref.current = target;
  nodes(root)
    .find((node) => node.type === "ConversationSourcesPanel" && !node.props.browserOnly)
    .props.onOpenAttachment("u:attachment:0");
  root = f.render();
  nodes(root)
    .filter((node) => node.type === "DialogContent")
    .at(-1)
    .props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.calls.at(-1), ["focus", target, "https://local.invalid/"]);
});

test("per-output downloads still use only the selected attachment", async () => {
  const f = fixture({
    conversation: {
      ...chat,
      messages: [
        {
          id: "file-message",
          role: "user",
          content: "This message is not the attachment.",
          attachments: [{ kind: "text_file", name: "notes.txt", content: "Exact file bytes" }],
        },
      ],
    },
  });
  nodes(f.render())
    .find((node) => node.type === "ConversationSourcesPanel" && !node.props.browserOnly)
    .props.onOpenAttachment("file-message:attachment:0");
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalTimeout = window.setTimeout;
  const downloaded = [];
  let blob;
  URL.createObjectURL = (value) => {
    blob = value;
    return "blob:scoped-output";
  };
  URL.revokeObjectURL = (value) => downloaded.push(["revoke", value]);
  window.setTimeout = (callback) => callback();
  globalThis.document = {
    createElement: () => ({
      click() {
        downloaded.push(["click", this.href, this.download]);
      },
      remove() {},
    }),
    body: { append() {} },
  };
  try {
    nodes(f.render())
      .find((node) => node.type === "Button" && text(node) === "Download")
      .props.onClick();
    assert.equal(await blob.text(), "Exact file bytes");
    assert.equal(blob.type, "text/plain;charset=utf-8");
    assert.deepEqual(downloaded, [
      ["click", "blob:scoped-output", "notes.txt"],
      ["revoke", "blob:scoped-output"],
    ]);
    assert.deepEqual(f.calls, []);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    window.setTimeout = originalTimeout;
  }
});

test("outputs open real attachment content and report missing originals truthfully", () => {
  const f = fixture({
    conversation: {
      ...chat,
      messages: [
        {
          id: "u",
          role: "user",
          content: "Read this",
          attachments: [
            { kind: "text_file", name: "review.txt", content: "Exact attached content" },
          ],
        },
      ],
    },
  });
  let root = f.render();
  nodes(root)
    .find((node) => node.type === "ConversationSourcesPanel" && !node.props.browserOnly)
    .props.onOpenAttachment("u:attachment:0");
  root = f.render();
  assert.equal(text(nodes(root).find((node) => node.type === "pre")), "Exact attached content");
  assert.equal(
    nodes(root).find((node) => node.type === "Button" && text(node) === "Download").props.disabled,
    false,
  );
  const library = fixture({
    navigationBlocked: true,
    conversation: {
      ...chat,
      messages: [
        {
          id: "u",
          role: "user",
          content: "",
          attachments: [{ kind: "library_file", name: "Report", libraryItemId: "file-1" }],
        },
      ],
    },
  });
  root = library.render();
  nodes(root)
    .find((node) => node.type === "ConversationSourcesPanel" && !node.props.browserOnly)
    .props.onOpenAttachment("u:attachment:0");
  root = library.render();
  assert.match(text(root), /This chat keeps a Library reference/);
  assert.match(text(root), /Send or clear your current message/);
  let prevented = false;
  nodes(root)
    .find((node) => node.type === "Link")
    .props.onClick({
      preventDefault() {
        prevented = true;
      },
    });
  assert.equal(prevented, true);
});

test("temporary settings are gated on both headers and callback, and top avatar is removed", () => {
  const home = readFileSync("src/routes/index.tsx", "utf8");
  const mobile = readFileSync("src/components/MobileTopBar.tsx", "utf8");
  const desktop = readFileSync("src/components/DesktopChatToolbar.tsx", "utf8");
  assert.match(home, /const chatStarted = Boolean\(active\?\.messages.length\)/);
  assert.match(desktop, /isLoaded && isSignedIn && !chatStarted/);
  assert.match(home, /if \(chatStarted \|\| enabled === tempChat\) return/);
  assert.match(mobile, /isSignedIn && !chatStarted && onTemporaryChatChange/);
  assert.doesNotMatch(home, /<UserButton/);
  assert.match(home, /temporaryDraftTransitionRef\.current = \{/);
  assert.match(home, /setInput\(temporaryDraft.text\)/);
  assert.match(home, /setAttachments\(temporaryDraft.attachments\)/);
});

test("memory inspection closes the popover and restores the Activity trigger", () => {
  const f = fixture();
  let root = f.render();
  const target = { id: "outputs" };
  nodes(root).find(
    (n) => n.type === "button" && n.props["aria-label"] === "Activity",
  ).props.ref.current = target;
  const sources = { ownerId: "owner", sources: [] };
  nodes(root)
    .find((n) => n.type === "ConversationSourcesPanel" && !n.props.browserOnly)
    .props.onOpenMemory(sources);
  root = f.render();
  assert.equal(nodes(root).find((n) => n.type === "Popover").props.open, false);
  const dialog = nodes(root).find((n) => n.type === "MemorySourcesDialog");
  assert.equal(dialog.props.sources, sources);
  dialog.props.onClose();
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.calls.at(-1), ["focus", target, "https://local.invalid/"]);
});

test("unbound browser activity opens an honest detail dialog and restores Activity", () => {
  const f = fixture();
  let root = f.render();
  const target = { id: "outputs" };
  nodes(root).find(
    (n) => n.type === "button" && n.props["aria-label"] === "Activity",
  ).props.ref.current = target;
  nodes(root)
    .find((n) => n.type === "ConversationSourcesPanel" && !n.props.browserOnly)
    .props.onOpenBrowser({ id: "event", label: "Recorded sample" });
  root = f.render();
  assert.equal(nodes(root).find((n) => n.type === "Popover").props.open, false);
  const content = nodes(root).find(
    (n) => n.type === "DialogContent" && text(n).includes("No live session is connected"),
  );
  assert.ok(content);
  assert.ok(text(content).includes("verified browser session is active"));
  assert.equal(
    nodes(content).some((n) => n.type === "Link" && n.props.to === "/work"),
    false,
  );
  const close = nodes(content).find((n) => n.type === "Button" && text(n).trim() === "Close");
  assert.ok(close);
  close.props.onClick();
  assert.equal(
    nodes(content).some((n) => n.type === "button" && text(n) === "Take over"),
    false,
  );
  content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.calls.at(-1), ["focus", target, "https://local.invalid/"]);
});

test("Free recorded browser history never grants sample takeover or claims a live session", () => {
  const f = fixture({
    userTier: "free",
    browserPresentation: {
      thumbnail: "fake",
      renderDialog() {
        throw Error("Free takeover must not render");
      },
    },
  });
  let root = f.render();
  const sources = nodes(root).find(
    (n) => n.type === "ConversationSourcesPanel" && !n.props.browserOnly,
  );
  assert.equal(sources.props.browserPreview, undefined);
  sources.props.onOpenBrowser({ id: "sample", label: "Recorded event" });
  root = f.render();
  assert.match(text(root), /No live session is connected/);
  assert.equal(
    nodes(root).some((n) => n.type === "Link" && n.props.to === "/work"),
    false,
  );
  assert.equal(
    nodes(root).some((n) => n.type === "button" && text(n) === "Take over"),
    false,
  );
});

test("composer action disc uses a compact desktop control and full phone target", () => {
  const css = readFileSync("src/styles/spec400-chat.css", "utf8");
  assert.match(
    css,
    /\.spec400-send-button \{\s*min-width: 36px;\s*min-height: 36px;\s*width: 36px;\s*height: 36px/,
  );
  assert.match(
    css,
    /\.spec400-composer-trailing \.spec400-primary-voice,[\s\S]*\[data-testid="send-button"\] \{\s*width: 43px;\s*height: 43px;\s*min-width: 43px;\s*min-height: 43px/,
  );
  assert.match(
    css,
    /@media \(max-width: 1023px\), \(any-pointer: coarse\)[\s\S]*\.spec400-send-button \{\s*min-width: 44px;\s*width: 44px;\s*height: 44px;\s*min-height: 44px/,
  );
  assert.match(css, /\.spec400-send-button \{[^}]*border-radius: 50%/);
  assert.doesNotMatch(css, /border: 4px solid transparent !important/);
});

test("touch Activity uses its own modal sheet while desktop keeps the anchored popover", () => {
  const touch = fixture({}, false);
  let root = touch.render();
  const activity = nodes(root).find(
    (node) => node.type === "button" && node.props["aria-label"] === "Activity",
  );
  assert.equal(activity.props["aria-haspopup"], "dialog");
  activity.props.onClick();
  root = touch.render();
  assert.equal(nodes(root).filter((node) => node.type === "Popover").length, 0);
  const sheet = nodes(root).find((node) => node.type === "MobileBottomSheet");
  assert.equal(sheet.props.open, true);
  assert.equal(sheet.props.title, "Activity");
  sheet.props.onOpenChange(false);
  assert.equal(
    nodes(touch.render()).find((node) => node.type === "MobileBottomSheet").props.open,
    false,
  );
  assert.equal(nodes(fixture().render()).filter((node) => node.type === "Popover").length, 1);
});
