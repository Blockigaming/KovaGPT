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
function fixture(overrides = {}) {
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
      useRef(initial) {
        const i = cursor++;
        states[i] ??= { current: initial };
        return states[i];
      },
    },
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
    "./ConversationSourcesPanel": { ConversationSourcesPanel: "ConversationSourcesPanel" },
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

test("desktop header has exactly Share, Outputs and More, and the requested menu order", () => {
  const f = fixture();
  const root = f.render();
  const actions = nodes(root).find((node) => node.props["aria-label"] === "Conversation actions");
  assert.deepEqual(
    nodes(actions)
      .filter((node) => node.type === "button")
      .map((node) => node.props["aria-label"]),
    ["Share chat", "Outputs", "More chat actions"],
  );
  const menu = nodes(root).find((node) => node.type === "DropdownMenuContent");
  assert.deepEqual(
    menu.props.children
      .flatMap((node) => (node?.type === "Fragment" ? node.props.children : node))
      .filter((node) => node?.type === "DropdownMenuItem" || node?.type === "DropdownMenuSub")
      .map((node) =>
        node.type === "DropdownMenuSub"
          ? text(nodes(node).find((child) => child.type === "DropdownMenuSubTrigger"))
          : text(node),
      ),
    [
      "Rename",
      "Pin",
      "Plugins",
      "View files in chat",
      "Export chat",
      "Archive",
      "Delete",
      "Move to project",
    ],
  );
  assert.match(text(menu), /Moving chats isn’t supported/);
  assert.match(text(menu), /Add copy to project/);
});

test("desktop and compact Export chat download every scoped message as safe Markdown", () => {
  const conversation = {
    ...chat,
    title: '../Release: review? "draft"',
    messages: [
      { id: "user-first", role: "user", content: "Review **this** change." },
      { id: "assistant-first", role: "assistant", content: "First answer — keep Unicode." },
      { id: "user-last", role: "user", content: "And the next step?" },
      { id: "assistant-last", role: "assistant", content: "```js\nconst ready = true;\n```" },
    ],
  };
  for (const compact of [false, true]) {
    const f = fixture({ compact, conversation });
    const action = nodes(f.render()).find(
      (node) => node.type === "DropdownMenuItem" && text(node) === "Export chat",
    );
    assert.ok(action, `Export chat must be reachable with compact=${compact}`);
    assert.equal(action.props.disabled, false);
    action.props.onSelect();
    assert.equal(f.calls.length, 1);
    const [kind, bytes, mime, filename] = f.calls[0];
    assert.equal(kind, "download");
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes), exportConversationMarkdown(conversation));
    for (const message of conversation.messages)
      assert.ok(new TextDecoder().decode(bytes).includes(message.content), message.id);
    assert.equal(mime, "text/markdown;charset=utf-8");
    assert.equal(filename, "..Release review draft.md");
    assert.doesNotMatch(filename, /[\\/:*?"<>|]/);
  }

  const other = fixture({
    conversation: {
      ...chat,
      id: "other-owner-chat",
      title: "Other active conversation",
      messages: [{ id: "other", role: "user", content: "Only this conversation" }],
    },
  });
  nodes(other.render())
    .find((node) => node.type === "DropdownMenuItem" && text(node) === "Export chat")
    .props.onSelect();
  const otherMarkdown = new TextDecoder().decode(other.calls[0][1]);
  assert.ok(otherMarkdown.includes("Only this conversation"));
  assert.ok(!otherMarkdown.includes(conversation.messages[0].content));
  const streaming = fixture({ isStreaming: true });
  assert.equal(
    nodes(streaming.render()).find(
      (node) => node.type === "DropdownMenuItem" && text(node) === "Export chat",
    ).props.disabled,
    true,
  );
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
    .find((node) => node.type === "ConversationSourcesPanel")
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

test("rename, pin and plugin controls invoke real handlers without touching the composer", () => {
  const f = fixture();
  let root = f.render();
  const item = (label) =>
    nodes(root).find((node) => node.type === "DropdownMenuItem" && text(node) === label);
  item("Pin").props.onSelect();
  item("Manage plugins").props.onSelect();
  item("Rename").props.onSelect();
  root = f.render();
  nodes(root)
    .find((node) => node.type === "input" && node.props.id?.startsWith("header-rename"))
    .props.onChange({ target: { value: "  Renamed release  " } });
  root = f.render();
  nodes(root)
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.deepEqual(f.calls, [["pin"], ["plugins"], ["rename", "Renamed release"]]);
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
    .find((node) => node.type === "ConversationSourcesPanel")
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
    .find((node) => node.type === "ConversationSourcesPanel")
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

test("temporary chat menus disclose restrictions and never call Share", () => {
  const f = fixture({ conversation: { ...chat, temporary: true } });
  let root = f.render();
  for (const label of ["Pin", "Archive", "Add copy to project"])
    assert.equal(
      nodes(root).find((node) => node.type === "DropdownMenuItem" && text(node) === label).props
        .disabled,
      true,
    );
  nodes(root)
    .find((node) => node.props["aria-label"] === "Share chat")
    .props.onClick();
  root = f.render();
  assert.match(text(root), /Temporary chats cannot be shared/);
  assert.deepEqual(f.calls, []);
});

test("temporary settings are gated on both headers and callback, and top avatar is removed", () => {
  const home = readFileSync("src/routes/index.tsx", "utf8");
  const mobile = readFileSync("src/components/MobileTopBar.tsx", "utf8");
  assert.match(home, /const chatStarted = Boolean\(active\?\.messages.length\)/);
  assert.match(home, /isLoaded && isSignedIn && !chatStarted/);
  assert.match(home, /if \(chatStarted \|\| enabled === tempChat\) return/);
  assert.match(mobile, /isSignedIn && !chatStarted && onTemporaryChatChange/);
  assert.doesNotMatch(home, /<UserButton/);
  assert.match(home, /temporaryDraftTransitionRef\.current = \{/);
  assert.match(home, /setInput\(temporaryDraft.text\)/);
  assert.match(home, /setAttachments\(temporaryDraft.attachments\)/);
});

test("rename and output previews return focus to the visible invoking header button", () => {
  const f = fixture();
  let root = f.render();
  const target = { id: "more-chat-actions" };
  nodes(root).find((node) => node.props["aria-label"] === "More chat actions").props.ref.current =
    target;
  nodes(root)
    .find((node) => node.type === "DropdownMenuItem" && text(node) === "Rename")
    .props.onSelect();
  root = f.render();
  let prevented = false;
  nodes(root)
    .find((node) => node.type === "DialogContent")
    .props.onCloseAutoFocus({
      preventDefault() {
        prevented = true;
      },
    });
  assert.equal(prevented, true);
  assert.deepEqual(f.calls.at(-1), ["focus", target, "https://local.invalid/"]);

  const output = fixture({
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
  root = output.render();
  const outputTarget = { id: "outputs-button" };
  nodes(root).find(
    (node) => node.type === "button" && node.props["aria-label"] === "Outputs",
  ).props.ref.current = outputTarget;
  nodes(root)
    .find((node) => node.type === "ConversationSourcesPanel")
    .props.onOpenAttachment("u:attachment:0");
  root = output.render();
  nodes(root)
    .filter((node) => node.type === "DialogContent")
    .at(-1)
    .props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(output.calls.at(-1), ["focus", outputTarget, "https://local.invalid/"]);
});

test("memory inspection closes the popover and restores the Outputs trigger", () => {
  const f = fixture();
  let root = f.render();
  const target = { id: "outputs" };
  nodes(root).find(
    (n) => n.type === "button" && n.props["aria-label"] === "Outputs",
  ).props.ref.current = target;
  const sources = { ownerId: "owner", sources: [] };
  nodes(root)
    .find((n) => n.type === "ConversationSourcesPanel")
    .props.onOpenMemory(sources);
  root = f.render();
  assert.equal(nodes(root).find((n) => n.type === "Popover").props.open, false);
  const dialog = nodes(root).find((n) => n.type === "MemorySourcesDialog");
  assert.equal(dialog.props.sources, sources);
  dialog.props.onClose();
  dialog.props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.calls.at(-1), ["focus", target, "https://local.invalid/"]);
});

test("unbound browser activity opens an honest detail dialog and restores Outputs", () => {
  const f = fixture();
  let root = f.render();
  const target = { id: "outputs" };
  nodes(root).find(
    (n) => n.type === "button" && n.props["aria-label"] === "Outputs",
  ).props.ref.current = target;
  nodes(root)
    .find((n) => n.type === "ConversationSourcesPanel")
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

test("compact header exposes Share and retains the More action and activity access", () => {
  const f = fixture({ compact: true });
  const root = f.render();
  const share = nodes(root).find(
    (n) => n.type === "DropdownMenuItem" && text(n).trim() === "Share",
  );
  assert.ok(share);
  share.props.onSelect();
  assert.deepEqual(f.calls, [["share"]]);
  assert.ok(nodes(root).some((n) => n.props["aria-label"] === "Outputs"));
  assert.match(
    readFileSync("src/components/conversation-header.css", "utf8"),
    /actions-compact \.kova-conversation-share\s*\{\s*display: inline-flex/,
  );
});

test("phone menu carries the conversation title and local search, with no invented project removal", () => {
  const f = fixture({
    compact: true,
    conversation: { ...chat, messages: [{ id: "m", role: "user", content: "A quiet workspace" }] },
  });
  let root = f.render();
  const menu = nodes(root).find((n) => n.type === "DropdownMenuContent");
  assert.match(menu.props.className, /menu-phone/);
  assert.equal(menu.props.alignOffset, -36);
  assert.equal(menu.props.collisionPadding, 16);
  assert.ok(text(menu).includes(chat.title));
  assert.ok(!text(menu).includes("Remove from project"));
  nodes(menu)
    .find((n) => n.type === "DropdownMenuItem" && text(n) === "Find in chat")
    .props.onSelect();
  root = f.render();
  const field = nodes(root).find(
    (n) => n.type === "input" && n.props["aria-label"] === "Find in chat",
  );
  field.props.onChange({ target: { value: "QUIET" } });
  root = f.render();
  assert.ok(text(root).includes("1 matching message"));
  assert.ok(nodes(root).some((n) => n.type === "button" && text(n).includes("A quiet workspace")));
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
  const sources = nodes(root).find((n) => n.type === "ConversationSourcesPanel");
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

test("phone menu preserves 44px touch rows without excessive height", () => {
  const css = readFileSync("src/components/conversation-header.css", "utf8");
  assert.match(css, /\.kova-conversation-menu-phone \[role="menuitem"\]\s*\{\s*min-height: 44px;/);
});

test("file menu handoff opens Outputs only after the closing menu releases focus", () => {
  const f = fixture();
  let root = f.render();
  nodes(root).find(
    (n) => n.type === "button" && n.props["aria-label"] === "Outputs",
  ).props.ref.current = { isConnected: true };
  nodes(root)
    .find((n) => n.type === "DropdownMenuItem" && text(n) === "View files in chat")
    .props.onSelect();
  root = f.render();
  assert.equal(nodes(root).find((n) => n.type === "Popover").props.open, false);
  const original = globalThis.requestAnimationFrame;
  let pending;
  globalThis.requestAnimationFrame = (callback) => {
    pending = callback;
    return 1;
  };
  try {
    let prevented = false;
    nodes(root)
      .find((n) => n.type === "DropdownMenuContent")
      .props.onCloseAutoFocus({
        preventDefault() {
          prevented = true;
        },
      });
    assert.equal(prevented, true);
    assert.equal(typeof pending, "function");
    pending();
    root = f.render();
    assert.equal(nodes(root).find((n) => n.type === "Popover").props.open, true);
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
    else delete globalThis.requestAnimationFrame;
  }
});

test("composer action disc uses a compact desktop control and full phone target", () => {
  const css = readFileSync("src/styles/spec400-chat.css", "utf8");
  assert.match(
    css,
    /\.spec400-send-button \{\s*min-width: 36px;\s*min-height: 36px;\s*width: 36px;\s*height: 36px/,
  );
  assert.match(
    css,
    /@media \(max-width: 1023px\), \(any-pointer: coarse\)[\s\S]*\.spec400-send-button \{\s*min-width: 44px;\s*width: 44px;\s*height: 44px;\s*min-height: 44px/,
  );
  assert.match(css, /\.spec400-send-button \{[^}]*border-radius: 50%/);
  assert.doesNotMatch(css, /border: 4px solid transparent !important/);
});

test("phone secondary actions stay in the same menu and Back restores the primary view", () => {
  const f = fixture({ compact: true });
  let root = f.render();
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  try {
    nodes(root)
      .find((n) => n.type === "DropdownMenuItem" && text(n) === "More options")
      .props.onSelect({ preventDefault() {} });
    root = f.render();
    let menu = nodes(root).find((n) => n.type === "DropdownMenuContent");
    assert.ok(text(menu).includes("Back"));
    assert.ok(text(menu).includes("Rename"));
    assert.equal(nodes(menu).filter((n) => n.type === "DropdownMenuSub").length, 0);
    nodes(menu)
      .find((n) => n.type === "DropdownMenuItem" && text(n) === "Back")
      .props.onSelect({ preventDefault() {} });
    root = f.render();
    menu = nodes(root).find((n) => n.type === "DropdownMenuContent");
    assert.ok(text(menu).includes("More options"));
    assert.ok(text(menu).includes("Archive"));
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});

test("conversation Delete keeps readable label contrast across menu interaction states", () => {
  const css = readFileSync("src/components/conversation-header.css", "utf8");
  assert.match(
    css,
    /\.kova-conversation-menu \.kova-conversation-delete \{\s*color: var\(--foreground\)/,
  );
  assert.match(css, /\.kova-conversation-delete > svg \{\s*color: var\(--destructive\)/);
  assert.match(
    css,
    /\.kova-conversation-delete:focus,[\s\S]*?\.kova-conversation-delete:hover,[\s\S]*?\.kova-conversation-delete\[data-highlighted\] \{\s*color: var\(--foreground\)/,
  );
});
