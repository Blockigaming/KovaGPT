import assert from "node:assert/strict";
import test from "node:test";
import * as pdfMetadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import * as localAttachments from "../../src/lib/composer-local-attachments.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
} from "../helpers/ui-state-harness.mjs";

// Actual ChatInput hooks and callbacks, with an inert dialog leaf. The existing
// dialog tests own recording/provider cleanup; this covers the missing composer
// mount and its owner/context/draft/submission boundary. No browser media runs.
function fixture(initial = {}, initialAccount = { isLoaded: true, user: { id: "owner-a" } }) {
  const hooks = createHookHarness();
  let account = initialAccount;
  let tree;
  const changes = [],
    modeChanges = [],
    submissions = [],
    voiceSubmissions = [],
    focus = [];
  const scopes = new Map();
  const targets = new Map();
  let props = {
    value: "Keep my typed draft",
    attachments: [],
    isStreaming: false,
    attachmentContext: "chat-a",
    latestAssistantText: "Latest completed assistant response.",
    voiceMode: null,
    onChange(value) {
      changes.push(value);
      props.value = value;
    },
    onAttachmentsChange(value) {
      props.attachments = value;
    },
    onSubmit: (...args) => submissions.push(args),
    onStop() {},
    onVoiceModeChange(value) {
      modeChanges.push(value);
      props.voiceMode = value;
    },
    onVoiceSubmit: async (text, signal) => {
      voiceSubmissions.push({ text, signal });
      return {
        ownerId: "owner-a",
        chatId: "chat-a",
        messageId: "assistant-new",
        content: "New reply.",
      };
    },
    ...initial,
  };
  const react = {
    ...hooks.react,
    useLayoutEffect: hooks.react.useEffect,
    useSyncExternalStore: () => true,
    lazy: (loader) => String(loader).match(/Composer[A-Za-z]+/)?.[0] ?? "Lazy",
    Suspense: "Suspense",
  };
  class Target {
    constructor(name) {
      this.name = name;
      this.style = {};
      this.dataset = {};
      this.scrollHeight = 48;
      this.isConnected = true;
    }
    focus() {
      focus.push(this.name);
    }
    click() {}
    getBoundingClientRect() {
      return { width: 500 };
    }
    getClientRects() {
      return [{}];
    }
    closest() {
      return null;
    }
    matches() {
      return false;
    }
  }
  const listeners = new Map();
  const window = {
    location: { href: "https://local.test/chat/unchanged" },
    requestAnimationFrame: (run) => run(),
    getComputedStyle: () => ({
      minHeight: "48",
      lineHeight: "24",
      paddingTop: "12",
      paddingBottom: "12",
    }),
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) ?? []) callback(event);
    },
  };
  const modules = {
    react,
    "lucide-react": {},
    "@tanstack/react-router": {
      useNavigate: () => () => {
        throw Error("Unexpected navigation");
      },
    },
    "@/components/auth/ClerkSafe": { useUser: () => account, SignInButton: "SignInButton" },
    "@/hooks/use-mobile": {
      useLayout: () => ({ isDesktop: true, isMobile: false, interaction: "pointer" }),
    },
    "@/lib/composer-local-attachments.mjs": localAttachments,
    "@/lib/composer-preferences": { useSharedSendOnEnter: () => true },
    "@/lib/limits": {
      tryUseUpload: () => {
        throw Error("Unexpected upload");
      },
    },
    "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 2 } },
    "@/lib/composer-keyboard.mjs": {},
    "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
    "@/lib/composer-paste": { prepareComposerPaste: (plain) => plain },
    "@/lib/document-extraction/pdf-metadata.mjs": pdfMetadata,
    "@/lib/document-extraction/client": {
      extractDocumentFile: () => {
        throw Error("Unexpected extraction");
      },
    },
    sonner: { toast: { error() {}, message() {} } },
    "@/hooks/use-library-attachment-auto-save": {
      useLibraryAttachmentAutoSave: () => {
        const principal = account.user?.id ?? "guest";
        if (!scopes.has(principal)) scopes.set(principal, { principal });
        return {
          scope: scopes.get(principal),
          save: () => {
            throw Error("Unexpected library save");
          },
        };
      },
    },
  };
  for (const name of [
    "ComposerUploadAllowance",
    "ComposerPdfPages",
    "ComposerContextPanel",
    "ComposerModelStatus",
    "MobileBottomSheet",
    "ResponsiveModelSelector",
    "ComposerDrawingDialog",
    "ComposerPluginList",
    "ComposerVoiceDialog",
  ])
    modules[`@/components/${name}`] = { [name]: name };
  for (const [module, names] of [
    ["dialog", ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"]],
    ["popover", ["Popover", "PopoverContent", "PopoverTrigger"]],
    ["select", ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]],
  ])
    modules[`@/components/ui/${module}`] = Object.fromEntries(names.map((name) => [name, name]));
  const { ChatInput } = loadUiModule("src/components/ChatInput.tsx", modules, {
    window,
    document: { activeElement: null },
    navigator: { onLine: true },
    crypto: { randomUUID: () => "synthetic-id" },
    AbortController,
    DOMException,
    Error,
    Set,
    Map,
    Date,
    Promise,
    TextEncoder,
    HTMLElement: Target,
    HTMLButtonElement: Target,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  function render() {
    tree = hooks.render(ChatInput, props);
    for (const node of elements(tree))
      if (node.props.ref && typeof node.props.ref === "object") {
        const label = node.props["aria-label"] ?? node.type;
        if (!targets.has(label)) targets.set(label, new Target(label));
        node.props.ref.current = targets.get(label);
      }
    return tree;
  }
  function button(id) {
    const node = elements(tree, (n) => n.type === "button" && n.props["data-testid"] === id)[0];
    assert.ok(node, `Missing ${id}`);
    return node.props;
  }
  function dialog() {
    const nodes = elements(tree, (n) => n.type === "ComposerVoiceDialog");
    assert.equal(nodes.length, 1, "One real dialog mount is shared by the two explicit modes");
    return nodes[0].props;
  }
  render();
  render();
  return {
    changes,
    modeChanges,
    submissions,
    voiceSubmissions,
    focus,
    dialog,
    button,
    imageHandoff() {
      const target = targets.get("Message KovaGPT");
      assert.ok(target);
      const box = new Target("image composer");
      target.closest = (selector) => (selector === "[data-chat-image-context]" ? box : null);
      let handler;
      window.dispatchEvent({
        type: "kova:prepare-chat-image-attachment",
        target: box,
        detail: {
          accept: (value) => {
            handler = value;
          },
        },
      });
      assert.equal(typeof handler, "function");
      return handler;
    },
    get props() {
      return props;
    },
    render,
    update(next) {
      props = { ...props, ...next };
      render();
      render();
    },
    account(next) {
      account = next;
      render();
      render();
    },
    click(id) {
      const action = button(id);
      assert.equal(Boolean(action.disabled), false, `${id} must be enabled`);
      action.onClick({ currentTarget: new Target(id) });
      render();
      render();
    },
    unmount: () => hooks.unmount(),
  };
}

for (const change of ["chat", "chat-roundtrip", "owner", "unmount", "cancelled-image"]) {
  test(`a prepared image attachment cannot cross ${change}`, async () => {
    const view = fixture();
    const attach = view.imageHandoff();
    if (change === "chat" || change === "chat-roundtrip")
      view.update({ attachmentContext: "chat-b" });
    if (change === "chat-roundtrip") view.update({ attachmentContext: "chat-a" });
    if (change === "owner") view.account({ isLoaded: true, user: { id: "owner-b" } });
    if (change === "unmount") view.unmount();
    await assert.rejects(
      attach(
        { name: "image.png", type: "image/png", size: 10 },
        () => change !== "cancelled-image",
      ),
      { name: "AbortError" },
    );
    assert.deepEqual(view.props.attachments, []);
    assert.equal(view.props.value, "Keep my typed draft");
    assert.deepEqual(view.submissions, []);
  });
}

test("the composer mounts the real voice dialog closed with live owner, context and completed assistant context", () => {
  const f = fixture({ showModelStatus: true });
  assert.equal(f.dialog().open, false);
  assert.equal(f.dialog().userId, "owner-a");
  assert.ok(f.dialog().contextKey.includes("chat-a"));
  assert.equal(f.dialog().latestAssistantText, "Latest completed assistant response.");
  assert.equal(f.dialog().conversationModelControl.type, "ComposerModelStatus");
  assert.equal(f.dialog().conversationModelControl.props.visible, true);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.submissions, []);
  assert.deepEqual(f.voiceSubmissions, []);
});

test("a new owner and conversation refresh dialog context and never retain the previous completed reply", () => {
  const f = fixture();
  f.click("dictate-button");
  f.account({ isLoaded: true, user: { id: "owner-b" } });
  f.update({ attachmentContext: "chat-b", latestAssistantText: "Owner B completed reply." });
  assert.equal(f.dialog().open, false);
  assert.equal(f.dialog().userId, "owner-b");
  assert.equal(f.dialog().contextKey, "chat-b");
  assert.equal(f.dialog().latestAssistantText, "Owner B completed reply.");
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.voiceSubmissions, []);
});

test("Dictate and Voice open separate explicit modes; opening never submits a draft", () => {
  const dictate = fixture();
  dictate.click("dictate-button");
  assert.equal(dictate.dialog().open, true);
  assert.equal(dictate.dialog().mode, "dictate");
  const voice = fixture();
  voice.click("voice-button");
  assert.equal(voice.dialog().open, true);
  assert.equal(voice.dialog().mode, "voice");
  for (const f of [dictate, voice]) {
    assert.deepEqual(f.submissions, []);
    assert.deepEqual(f.voiceSubmissions, []);
    assert.equal(f.props.value, "Keep my typed draft");
  }
});

test("standalone composers preserve local Dictate state when no route controls the mode", () => {
  const f = fixture({
    voiceMode: undefined,
    onVoiceModeChange: undefined,
    onVoiceSubmit: undefined,
  });
  f.click("dictate-button");
  assert.equal(f.dialog().open, true);
  assert.equal(f.dialog().mode, "dictate");
  f.dialog().onOpenChange(false);
  f.render();
  assert.equal(f.dialog().open, false);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.submissions, []);
});

test("a pending attachment prevents Voice reflow while Dictate preserves the draft and attachment", () => {
  const attachment = {
    kind: "text_file",
    status: "uploading",
    name: "Pending.txt",
    dataUrl: "",
    textContent: "Pending local attachment",
  };
  const f = fixture({ attachments: [attachment] });
  const voice = f.button("voice-button");
  assert.equal(voice.disabled, true);
  // Even a captured callback must enforce the gate before a disabled DOM node
  // can be re-enabled by a later render or invoked outside the browser.
  voice.onClick({ currentTarget: {} });
  f.render();
  assert.equal(f.dialog().open, false);
  assert.deepEqual(f.modeChanges, []);
  assert.deepEqual(f.voiceSubmissions, []);
  f.click("dictate-button");
  assert.equal(f.dialog().open, true);
  assert.equal(f.dialog().mode, "dictate");
  assert.equal(f.props.value, "Keep my typed draft");
  assert.deepEqual(f.props.attachments, [attachment]);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.submissions, []);
});

test("Dictate appends the reviewed transcript to the latest editable draft without sending", () => {
  const f = fixture();
  f.click("dictate-button");
  const callback = f.dialog().onTranscript;
  f.update({ value: "Newer typed draft" });
  callback("  reviewed transcript  ");
  assert.equal(f.props.value, "Newer typed draft\nreviewed transcript");
  assert.equal(f.changes.length, 1);
  assert.deepEqual(f.submissions, []);
  assert.deepEqual(f.voiceSubmissions, []);
});

for (const transition of [
  "chat",
  "logout",
  "loading",
  "disabled",
  "chat-roundtrip",
  "owner-roundtrip",
  "unmount",
]) {
  test(`a captured transcript callback cannot cross ${transition}`, () => {
    const f = fixture();
    f.click("dictate-button");
    const callback = f.dialog().onTranscript;
    if (transition === "chat" || transition === "chat-roundtrip") {
      f.update({ attachmentContext: "chat-b" });
      if (transition === "chat-roundtrip") f.update({ attachmentContext: "chat-a" });
    }
    if (transition === "logout" || transition === "owner-roundtrip") {
      f.account({ isLoaded: true, user: null });
      if (transition === "owner-roundtrip") f.account({ isLoaded: true, user: { id: "owner-a" } });
    }
    if (transition === "loading") f.account({ isLoaded: false, user: { id: "owner-a" } });
    if (transition === "disabled") f.update({ disabled: true });
    if (transition === "unmount") f.unmount();
    callback("Stale private transcript");
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.submissions, []);
    assert.deepEqual(f.voiceSubmissions, []);
    assert.equal(f.props.value, "Keep my typed draft");
  });
}

test("Voice requires the route submission bridge and passes the exact text and abort signal", async () => {
  const unavailable = fixture({ onVoiceSubmit: undefined });
  assert.equal(unavailable.button("voice-button").disabled, true);
  const f = fixture();
  f.click("voice-button");
  const controller = new AbortController();
  const result = await f.dialog().onVoiceSubmit("spoken turn", controller.signal);
  assert.equal(f.voiceSubmissions.length, 1);
  assert.equal(f.voiceSubmissions[0].text, "spoken turn");
  assert.equal(f.voiceSubmissions[0].signal, controller.signal);
  assert.equal(result.messageId, "assistant-new");
  assert.deepEqual(f.submissions, []);
});

test("aborted or stale voice submit callbacks cannot invoke the route bridge", async () => {
  for (const transition of ["aborted", "chat", "logout", "disabled", "closed", "unmount"]) {
    const f = fixture();
    f.click("voice-button");
    const callback = f.dialog().onVoiceSubmit;
    const controller = new AbortController();
    if (transition === "aborted") controller.abort();
    if (transition === "chat") f.update({ attachmentContext: "chat-b" });
    if (transition === "logout") f.account({ isLoaded: true, user: null });
    if (transition === "disabled") f.update({ disabled: true });
    if (transition === "closed") {
      f.dialog().onOpenChange(false);
      f.render();
    }
    if (transition === "unmount") f.unmount();
    await assert.rejects(
      Promise.resolve().then(() => callback("stale spoken turn", controller.signal)),
    );
    assert.deepEqual(f.voiceSubmissions, [], transition);
  }
});

test("late route results cannot complete a voice turn after close, abort, or ownership changes", async () => {
  for (const transition of ["close", "abort", "chat", "logout", "owner-roundtrip"]) {
    const pending = deferred();
    const f = fixture({ onVoiceSubmit: () => pending.promise });
    f.click("voice-button");
    const controller = new AbortController();
    const result = f.dialog().onVoiceSubmit("spoken request", controller.signal);
    if (transition === "close") {
      f.dialog().onOpenChange(false);
      f.render();
    }
    if (transition === "abort") controller.abort();
    if (transition === "chat") f.update({ attachmentContext: "chat-b" });
    if (transition === "logout" || transition === "owner-roundtrip") {
      f.account({ isLoaded: true, user: null });
      if (transition === "owner-roundtrip") f.account({ isLoaded: true, user: { id: "owner-a" } });
    }
    pending.resolve({
      ownerId: "owner-a",
      chatId: "chat-a",
      messageId: "assistant-new",
      content: "Late private reply",
    });
    await assert.rejects(result, undefined, transition);
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.submissions, []);
  }
});

test("unloaded owners cannot open either mode, and guests get a truthful Dictate dialog without callbacks", async () => {
  const loading = fixture({}, { isLoaded: false, user: { id: "owner-a" } });
  assert.equal(loading.button("dictate-button").disabled, true);
  assert.equal(loading.button("voice-button").disabled, true);
  assert.equal(loading.dialog().userId, null);
  assert.equal(loading.dialog().open, false);
  const guest = fixture({}, { isLoaded: true, user: null });
  assert.equal(guest.button("voice-button").disabled, true);
  guest.click("dictate-button");
  assert.equal(guest.dialog().userId, null);
  assert.equal(guest.dialog().mode, "dictate");
  guest.dialog().onTranscript("Guest private transcript");
  await assert.rejects(guest.dialog().onVoiceSubmit("guest turn", new AbortController().signal));
  assert.deepEqual(guest.changes, []);
  assert.deepEqual(guest.submissions, []);
  assert.deepEqual(guest.voiceSubmissions, []);
});
