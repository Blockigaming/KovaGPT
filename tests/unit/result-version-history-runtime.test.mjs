import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  text,
} from "../helpers/ui-state-harness.mjs";
import * as autosavePolicy from "../../src/lib/canvas-autosave-policy.mjs";

// Execute the actual Result editor with isolated hooks, DOM targets and services.
// No browser, network or autosave timers run in this harness.
const primitives = new Proxy({}, { get: (_target, name) => name });
function fixture({
  durable = false,
  embedded = true,
  kind = "writing",
  downloadFailure,
  onDownloadClick,
} = {}) {
  const hooks = createHookHarness();
  const feedback = loadUiModule("src/lib/use-scoped-action-feedback.ts", { react: hooks.react });
  const focused = [],
    calls = [],
    clipboard = [],
    reads = [],
    downloads = [],
    downloadAnchors = [],
    downloadEvents = [],
    downloadTimers = [],
    revokedUrls = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.children = new Set();
    }
    contains(target) {
      return this === target || this.children.has(target);
    }
    matches() {
      return !!this.disabled || !!this.ariaDisabled;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return this.inert || this.ariaHidden ? {} : null;
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
  }
  const document = { body: new Element("body"), activeElement: null };
  document.body.appendChild = (anchor) => {
    if (downloadFailure === "append") throw Error("Download append failed");
    anchor.isConnected = true;
    downloadEvents.push("append");
  };
  document.createElement = (tag) => {
    assert.equal(tag, "a");
    const anchor = {
      isConnected: false,
      click() {
        assert.equal(this.isConnected, true, "Downloads activate an attached anchor");
        if (downloadFailure === "click") throw Error("Download click failed");
        onDownloadClick?.();
        downloadEvents.push("click");
        calls.push("download");
      },
      remove() {
        this.isConnected = false;
        downloadEvents.push("remove");
      },
    };
    downloadAnchors.push(anchor);
    return anchor;
  };
  document.activeElement = document.body;
  const window = {
    location: { href: "https://kova.test/chat/session-a" },
    setTimeout: (callback, delay) => {
      if (delay === 1000) downloadTimers.push({ callback, delay });
      return 1;
    },
    clearTimeout() {},
  };
  const URL = {
    createObjectURL(blob) {
      if (downloadFailure === "url") throw Error("Download URL failed");
      downloads.push(blob);
      return `blob:fixture-${downloads.length}`;
    },
    revokeObjectURL(url) {
      revokedUrls.push(url);
    },
  };
  const exportCommon = loadUiModule(
    "src/lib/writing-export/common.ts",
    {},
    { window, document, Blob, URL },
  );
  const auth = { isSignedIn: durable, user: durable ? { id: "owner-a" } : null };
  const collaboration = {
    ready: true,
    conflict: false,
    error: null,
    presence: {},
    snapshot: durable
      ? {
          canEdit: true,
          document: { id: "doc-a", revision: 3, content: "Saved current" },
          versions: [
            { revision: 3, created_at: "2026-10-19T00:00:00Z" },
            { revision: 2, created_at: "2026-10-18T00:00:00Z" },
          ],
        }
      : null,
    adopt: () => null,
    save: async () => {
      throw new Error("Unexpected autosave");
    },
    versionContent(revision) {
      const pending = deferred();
      reads.push({ revision, ...pending });
      return pending.promise;
    },
  };
  const module = loadUiModule(
    "src/components/ArtifactEditor.tsx",
    {
      react: { ...hooks.react, useMemo: (fn, deps) => hooks.react.useCallback(fn(), deps) },
      "./ui/dialog": primitives,
      "./ui/dropdown-menu": primitives,
      "./SelectionEditDialog": primitives,
      "./ResultServerExportDialog": primitives,
      "@/lib/writing-export/common": exportCommon,
      "./result-editor.css": {},
      "lucide-react": primitives,
      sonner: {
        toast: {
          message: (message) => calls.push(message),
          error: (message) => calls.push(message),
        },
      },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/lib/library.functions": {
        saveToLibrary: async () => assert.fail("Unexpected Library save"),
      },
      "@/components/auth/ClerkSafe": { useUser: () => auth, useClerkSafe: () => null },
      "@/lib/workspace-handoffs": {},
      "@/components/CollaborationStatus": primitives,
      "@/components/CanvasComments": primitives,
      "@/components/ResultCommentDeleteDialog": primitives,
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
      "@/lib/use-scoped-action-feedback": feedback,
      "@/lib/use-canvas-collaboration": { useCanvasCollaboration: () => collaboration },
      "./artifact-utils": { buildPreviewDoc: () => ({ doc: "", hadScripts: false }) },
      "@/lib/serialized-write-queue": {
        createSerializedWriteQueue: () => ({ enqueue: () => assert.fail("Unexpected autosave") }),
      },
      "@/lib/canvas-autosave-policy.mjs": autosavePolicy,
    },
    {
      window,
      document,
      HTMLElement: Element,
      localStorage: { getItem: () => null },
      clearTimeout() {},
      setTimeout: () => 1,
      Error,
      Blob,
      TextEncoder,
      URL,
      navigator: { clipboard: { writeText: async (value) => clipboard.push(value) } },
    },
  );
  const props = {
    open: true,
    embedded,
    initialContent: "Opening text",
    kind,
    title: "Response draft",
    chatId: "chat-a",
    messageId: "message-a",
    onClose: () => calls.push("result-close"),
  };
  const component = module.ArtifactEditor(props).type;
  const trigger = new Element("Versions opener"),
    exportTrigger = new Element("Export opener"),
    heading = new Element("Versions title"),
    content = new Element("history inspector"),
    root = new Element("Result surface"),
    resultHeading = new Element("Result title"),
    closeResult = new Element("Close result"),
    editor = new Element("content editor"),
    keepEditing = new Element("Keep editing"),
    reviewSurface = new Element("close review"),
    closePreview = new Element("Close preview");
  content.children.add(heading);
  for (const child of [trigger, exportTrigger, resultHeading, closeResult, editor, closePreview])
    root.children.add(child);
  reviewSurface.children.add(keepEditing);
  const render = () => {
    const tree = hooks.render(component, props);
    const title = elements(
      tree,
      (node) => node.type === "DialogTitle" && text(node).startsWith("Versions of"),
    )[0];
    if (title) title.props.ref.current = heading;
    for (const node of elements(tree)) {
      if (node.props.className?.startsWith("kova-result-editor")) node.props.ref.current = root;
      if (node.type === "h2" && text(node) === "Response draft")
        node.props.ref.current = resultHeading;
      if (node.props["aria-label"] === "Close result") node.props.ref.current = closeResult;
      if (node.type === "textarea" && node.props["aria-label"]?.endsWith(" content"))
        node.props.ref.current = editor;
      if (node.type === "button" && text(node).trim() === "Keep editing")
        node.props.ref.current = keepEditing;
      if (node.type === "button" && text(node).trim() === "Export")
        node.props.ref.current = exportTrigger;
    }
    return tree;
  };
  const find = (predicate) => elements(render(), predicate)[0];
  const history = () =>
    find(
      (node) =>
        node.type === "Dialog" &&
        node.props.children?.props?.className === "spec400-library-inspector",
    );
  const historyContent = () => history().props.children;
  const button = (label) => find((node) => node.type === "button" && text(node).trim() === label);
  const previews = () =>
    elements(
      historyContent(),
      (node) => node.type === "button" && text(node).trim() === "Preview version",
    );
  const textarea = () =>
    find((node) => node.type === "textarea" && node.props["aria-label"]?.endsWith(" content"));
  const review = () =>
    find(
      (node) =>
        node.type === "Dialog" &&
        elements(
          node,
          (child) =>
            child.type === "DialogTitle" && text(child) === "Keep your result before closing?",
        ).length,
    );
  const requestClose = () => {
    document.activeElement = closeResult;
    find((node) => node.props["aria-label"] === "Close result").props.onClick({
      currentTarget: closeResult,
    });
    render();
  };
  const open = () => {
    button("Versions").props.onClick({ currentTarget: trigger });
    render();
  };
  render();
  render();
  return {
    props,
    auth,
    collaboration,
    calls,
    clipboard,
    reads,
    downloads,
    downloadAnchors,
    downloadEvents,
    downloadTimers,
    revokedUrls,
    focused,
    document,
    window,
    Element,
    trigger,
    exportTrigger,
    heading,
    content,
    root,
    resultHeading,
    closeResult,
    editor,
    keepEditing,
    reviewSurface,
    closePreview,
    render,
    find,
    history,
    historyContent,
    button,
    previews,
    textarea,
    review,
    requestClose,
    open,
    unmount: () => hooks.unmount(),
  };
}

test("Version history uses the shared inspector, named 56px header and its own scroll body", () => {
  const f = fixture();
  f.open();
  const content = f.historyContent();
  assert.equal(f.history().props.open, true);
  assert.equal(content.props.className, "spec400-library-inspector");
  assert.equal(content.props.closeLabel, "Close version history");
  assert.match(
    text(elements(content, (node) => node.type === "DialogTitle")[0]),
    /Versions of\s+Response draft/,
  );
  assert.ok(
    elements(content, (node) => node.props.className?.includes("spec400-inspector-body")).length,
  );
  content.props.onOpenAutoFocus({ preventDefault() {} });
  assert.equal(f.document.activeElement, f.heading);
});

for (const dirty of [false, true]) {
  test(`${dirty ? "dirty" : "unchanged"} Result survives history dismissal without closing the editor`, () => {
    const f = fixture();
    if (dirty) f.textarea().props.onChange({ target: { value: "Unsaved working draft" } });
    f.open();
    f.historyContent().props.onOpenAutoFocus({ preventDefault() {} });
    f.history().props.onOpenChange(false);
    assert.equal(f.history().props.open, false);
    assert.equal(f.textarea().props.value, dirty ? "Unsaved working draft" : "Opening text");
    assert.deepEqual(f.calls, []);
    f.historyContent().props.onCloseAutoFocus({ preventDefault() {}, target: f.content });
    assert.equal(f.document.activeElement, f.trigger);
    f.open();
    assert.equal(f.textarea().props.value, dirty ? "Unsaved working draft" : "Opening text");
  });
}

test("selected comparison and current draft persist while history closes and reopens", async () => {
  const f = fixture();
  f.textarea().props.onChange({ target: { value: "Unsaved working draft" } });
  f.open();
  await f.previews()[0].props.onClick();
  const comparison = () => f.find((node) => node.props["aria-label"] === "Version comparison");
  assert.equal(f.history().props.open, false);
  assert.match(text(comparison()), /Opening text/);
  assert.match(text(comparison()), /Unsaved working draft/);
  f.open();
  f.history().props.onOpenChange(false);
  assert.ok(comparison());
  assert.equal(f.textarea().props.value, "Unsaved working draft");
  assert.deepEqual(f.calls, []);
});

for (const outcome of ["success", "error"]) {
  test(`dismissal invalidates a pending version ${outcome} without losing the draft or reopening history`, async () => {
    const f = fixture({ durable: true });
    f.textarea().props.onChange({ target: { value: "Private working draft" } });
    f.open();
    const pending = f.previews()[1].props.onClick();
    f.history().props.onOpenChange(false);
    if (outcome === "success") f.reads[0].resolve("Earlier saved text");
    else f.reads[0].reject(new Error("Late failed read"));
    await pending;
    assert.equal(f.history().props.open, false);
    assert.equal(
      f.find((node) => node.props["aria-label"] === "Version comparison"),
      undefined,
    );
    assert.equal(f.textarea().props.value, "Private working draft");
    assert.doesNotMatch(text(f.render()), /Late failed read/);
    f.open();
    const retry = f.previews()[1].props.onClick();
    assert.equal(f.reads.length, 2);
    f.reads[1].resolve("Earlier saved text");
    await retry;
    assert.match(
      text(f.find((node) => node.props["aria-label"] === "Version comparison")),
      /Earlier saved text/,
    );
  });
}

test("failed version reads stay visible in the inspector and preserve the working draft for retry", async () => {
  const f = fixture({ durable: true });
  f.textarea().props.onChange({ target: { value: "Keep this draft" } });
  f.open();
  const pending = f.previews()[1].props.onClick();
  f.reads[0].reject(new Error("History unavailable"));
  await pending;
  assert.equal(f.history().props.open, true);
  assert.match(text(f.historyContent()), /History unavailable.*current draft is preserved/);
  assert.equal(f.textarea().props.value, "Keep this draft");
});

for (const interruption of ["account", "document", "unmount", "navigation", "later-focus"]) {
  test(`history close cannot restore an old opener after ${interruption}`, () => {
    const f = fixture({ durable: true });
    f.open();
    const content = f.historyContent();
    f.document.activeElement = f.heading;
    if (interruption === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    }
    if (interruption === "document") {
      f.props.messageId = "message-b";
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = new f.Element("later input");
    content.props.onCloseAutoFocus({ preventDefault() {}, target: f.content });
    assert.deepEqual(f.focused, []);
  });
}

test("history dismissal preserves inspector scroll and makes detached preview handlers inert", async () => {
  const f = fixture({ durable: true });
  f.open();
  const body = () =>
    elements(f.historyContent(), (node) =>
      node.props.className?.includes("spec400-inspector-body"),
    )[0];
  body().props.onScroll({ currentTarget: { scrollTop: 185 } });
  const preview = f.previews()[1].props.onClick;
  f.history().props.onOpenChange(false);
  await preview();
  assert.equal(f.reads.length, 0);
  f.open();
  const node = { scrollTop: 0 };
  body().props.ref(node);
  assert.equal(node.scrollTop, 185);
});

for (const embedded of [true, false]) {
  for (const dismissal of ["Keep editing", "Escape", "backdrop", "review Close"]) {
    test(`dirty Code ${embedded ? "embedded" : "modal"} ${dismissal} keeps exact code and restores Close result`, () => {
      const f = fixture({ embedded, kind: "code" });
      const code = "const draft = 'never discard';\n  // exact whitespace\n";
      f.textarea().props.onChange({ target: { value: code } });
      f.requestClose();
      assert.equal(f.review().props.open, true);
      assert.match(text(f.review()), /not confirmed saved beyond this session/);
      const content = f.review().props.children;
      let prevented = 0;
      content.props.onOpenAutoFocus({
        preventDefault() {
          prevented++;
        },
      });
      assert.equal(prevented, 1);
      assert.equal(f.document.activeElement, f.keepEditing);
      assert.deepEqual(f.calls, []);
      if (dismissal === "Keep editing") f.button("Keep editing").props.onClick();
      else f.review().props.onOpenChange(false);
      assert.equal(f.review().props.open, false);
      content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
      assert.equal(f.document.activeElement, f.closeResult);
      assert.equal(f.textarea().props.value, code);
      assert.deepEqual(f.calls, []);
    });
  }
}

test("Result Escape review returns to the exact content field, including its selection", () => {
  const f = fixture({ embedded: false, kind: "code" });
  f.textarea().props.onChange({ target: { value: "const retained = true;" } });
  f.editor.selectionStart = 3;
  f.editor.selectionEnd = 8;
  f.document.activeElement = f.editor;
  f.find(
    (node) =>
      node.type === "Dialog" && node.props.children?.props.className === "kova-result-dialog",
  ).props.onOpenChange(false);
  const content = f.review().props.children;
  content.props.onOpenAutoFocus({ preventDefault() {} });
  f.review().props.onOpenChange(false);
  content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.equal(f.document.activeElement, f.editor);
  assert.equal(f.editor.selectionStart, 3);
  assert.equal(f.editor.selectionEnd, 8);
});

for (const unavailable of [
  "detached",
  "disabled",
  "ariaDisabled",
  "hidden",
  "inert",
  "ariaHidden",
  "unrelated",
]) {
  test(`dirty review uses the editor fallback when the invoker is ${unavailable}`, () => {
    const f = fixture();
    f.textarea().props.onChange({ target: { value: "Keep this draft" } });
    f.requestClose();
    const content = f.review().props.children;
    content.props.onOpenAutoFocus({ preventDefault() {} });
    if (unavailable === "detached") f.closeResult.isConnected = false;
    else if (unavailable === "unrelated") f.root.children.delete(f.closeResult);
    else f.closeResult[unavailable] = true;
    f.button("Keep editing").props.onClick();
    content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
    assert.equal(f.document.activeElement, f.editor);
    assert.equal(f.textarea().props.value, "Keep this draft");
  });
}

test("dirty review can fall back to the retained result heading when no editor/control is usable", () => {
  const f = fixture();
  f.textarea().props.onChange({ target: { value: "Keep this draft" } });
  f.requestClose();
  const content = f.review().props.children;
  content.props.onOpenAutoFocus({ preventDefault() {} });
  f.closeResult.disabled = true;
  f.editor.hidden = true;
  f.button("Keep editing").props.onClick();
  content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.equal(f.document.activeElement, f.resultHeading);
});

for (const interruption of [
  "account",
  "document",
  "unmount",
  "navigation",
  "later-focus",
  "later-editor-focus",
  "removed-result",
]) {
  test(`dirty review cannot restore stale focus or close a Result after ${interruption}`, () => {
    const f = fixture();
    f.textarea().props.onChange({ target: { value: "Keep this draft" } });
    f.requestClose();
    const content = f.review().props.children;
    content.props.onOpenAutoFocus({ preventDefault() {} });
    f.button("Close without keeping changes").props.onClick();
    f.focused.length = 0;
    if (interruption === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    }
    if (interruption === "document") {
      f.props.messageId = "message-b";
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = new f.Element("later input");
    if (interruption === "later-editor-focus") f.document.activeElement = f.editor;
    if (interruption === "removed-result") f.root.isConnected = false;
    content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
    assert.deepEqual(f.focused, []);
    assert.deepEqual(f.calls, []);
  });
}

test("repeated dirty review ignores an older close callback and restores the current invoker only once", () => {
  const f = fixture();
  f.textarea().props.onChange({ target: { value: "Retained draft" } });
  f.requestClose();
  const previous = f.review().props.children;
  f.button("Keep editing").props.onClick();
  f.render();
  f.requestClose();
  const current = f.review().props.children;
  current.props.onOpenAutoFocus({ preventDefault() {} });
  f.focused.length = 0;
  previous.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.equal(f.review().props.open, true);
  assert.deepEqual(f.focused, []);
  f.button("Keep editing").props.onClick();
  current.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  current.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.deepEqual(f.focused, ["Close result"]);
  assert.equal(f.textarea().props.value, "Retained draft");
});

test("Download current draft remains explicit and downloads exact content without closing or claiming a save", async () => {
  const f = fixture({ kind: "code" });
  const code = "let exact = '<draft>';\n";
  f.textarea().props.onChange({ target: { value: code } });
  f.requestClose();
  f.review().props.children.props.onOpenAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.downloads, []);
  f.button("Download current draft").props.onClick();
  assert.equal(await f.downloads[0].text(), code);
  assert.equal(f.review().props.open, true);
  assert.equal(f.textarea().props.value, code);
  assert.deepEqual(f.calls, ["download"]);
  assert.match(text(f.review()), /not confirmed saved beyond this session/);
});

const exportItem = (f, label) =>
  f.find(
    (node) => node.type === "DropdownMenuItem" && text(node).replace(/\s+/g, " ").trim() === label,
  );

for (const [kind, label, extension] of [
  ["writing", "Markdown", "md"],
  ["website", "HTML", "html"],
  ["code", "text", "txt"],
]) {
  test(`Result ${label} export preserves UTF-8 bytes, MIME and safe filename through the mounted-anchor helper`, async () => {
    const f = fixture({ kind });
    f.props.title = '  Ａ report/with:unsafe*?"<>|\\name\u0001  ';
    const source = "# Café 😀\r\n<script>inert text</script>\n  exact whitespace\t\n";
    f.textarea().props.onChange({ target: { value: source } });
    f.render();
    assert.deepEqual(f.downloads, []);
    exportItem(f, `Download ${label}`).props.onSelect();
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].type, "text/plain;charset=utf-8");
    assert.deepEqual(
      new Uint8Array(await f.downloads[0].arrayBuffer()),
      new TextEncoder().encode(source),
    );
    assert.equal(f.downloadAnchors[0].download, `A reportwithunsafename.${extension}`);
    assert.equal(f.downloadAnchors[0].href, "blob:fixture-1");
    assert.deepEqual(f.downloadEvents, ["append", "click", "remove"]);
    assert.equal(f.downloadAnchors[0].isConnected, false);
    assert.deepEqual(f.revokedUrls, [], "The URL remains valid after the click");
    assert.equal(f.downloadTimers.length, 1);
    assert.equal(f.downloadTimers[0].delay, 1000);
    f.downloadTimers[0].callback();
    assert.deepEqual(f.revokedUrls, ["blob:fixture-1"]);
    assert.equal(f.textarea().props.value, source);
    assert.deepEqual(f.calls, ["download"], "No save, close, or success claim is added");
    f.unmount();
  });
}

test("Result download failure releases resources and preserves the exact draft with visible feedback", () => {
  for (const downloadFailure of ["url", "append", "click"]) {
    const f = fixture({ downloadFailure });
    f.textarea().props.onChange({ target: { value: "Keep this unsaved draft.\n" } });
    exportItem(f, "Download Markdown").props.onSelect();
    assert.equal(f.textarea().props.value, "Keep this unsaved draft.\n");
    assert.deepEqual(f.calls, []);
    assert.equal(f.downloadTimers.length, 0);
    assert.deepEqual(f.revokedUrls, downloadFailure === "url" ? [] : ["blob:fixture-1"]);
    assert.ok(f.downloadAnchors.every((anchor) => !anchor.isConnected));
    const alert = elements(f.render(), (node) => node.props.role === "alert")[0];
    assert.match(text(alert), /Download could not be started\./);
    assert.match(text(alert), /Your draft is preserved\./);
    f.unmount();
  }
});

test("Result download keeps the synchronous pending ticket and stale-scope/unmount guards", () => {
  let download;
  const pending = fixture({ onDownloadClick: () => download() });
  download = exportItem(pending, "Download Markdown").props.onSelect;
  download();
  assert.equal(pending.downloads.length, 1, "A reentrant activation cannot start a second export");
  assert.deepEqual(pending.calls, ["download"]);
  download();
  assert.equal(pending.downloads.length, 2, "A later deliberate activation remains available");
  pending.unmount();

  for (const interruption of ["account", "document", "unmount"]) {
    const f = fixture();
    const oldDownload = exportItem(f, "Download Markdown").props.onSelect;
    if (interruption === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    } else if (interruption === "document") {
      f.props.messageId = "message-b";
      f.render();
    } else f.unmount();
    oldDownload();
    assert.deepEqual(f.downloads, [], `${interruption} blocks the old action`);
    assert.deepEqual(f.calls, []);
    if (interruption !== "unmount") f.unmount();
  }
});

test("Result server delivery opens explicitly for a Guest draft and returns to the persistent Export opener", () => {
  const f = fixture();
  f.textarea().props.onChange({
    target: { value: "Exact unsaved Temporary draft\n  keep whitespace" },
  });
  f.document.activeElement = new f.Element("Transient export menu item");
  exportItem(f, "Download via server…").props.onSelect();
  const dialog = f.find((node) => node.type === "ResultServerExportDialog");
  assert.equal(dialog.props.content, "Exact unsaved Temporary draft\n  keep whitespace");
  assert.equal(dialog.props.isCurrent(), true);
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(f.calls, []);
  dialog.props.onClose();
  assert.equal(
    f.find((node) => node.type === "ResultServerExportDialog"),
    undefined,
  );
  f.document.activeElement = f.document.body;
  dialog.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.deepEqual(f.focused, ["Export opener"]);
  assert.equal(dialog.props.isCurrent(), false);
  assert.equal(f.textarea().props.value, "Exact unsaved Temporary draft\n  keep whitespace");
});

test("Result server delivery rejects stale account, document, route, close and unmount callbacks", () => {
  for (const interruption of ["account", "document", "navigation", "close", "unmount"]) {
    const f = fixture();
    exportItem(f, "Download via server…").props.onSelect();
    const old = f.find((node) => node.type === "ResultServerExportDialog");
    if (interruption === "account") f.auth.user = { id: "owner-b" };
    if (interruption === "document") f.props.messageId = "message-b";
    if (interruption === "navigation") f.window.location.href += "?new-route";
    if (interruption === "close") f.props.open = false;
    if (interruption === "unmount") f.unmount();
    else f.render();
    assert.equal(old.props.isCurrent(), false, interruption);
    f.document.activeElement = f.document.body;
    old.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
    assert.deepEqual(f.focused, [], interruption);
  }
});

test("an older server dialog cannot close or restore focus over a newly opened dialog", () => {
  const f = fixture();
  exportItem(f, "Download via server…").props.onSelect();
  const old = f.find((node) => node.type === "ResultServerExportDialog");
  old.props.onClose();
  f.render();
  exportItem(f, "Download via server…").props.onSelect();
  const next = f.find((node) => node.type === "ResultServerExportDialog");
  old.props.onClose();
  old.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.ok(f.find((node) => node.type === "ResultServerExportDialog"));
  assert.equal(old.props.isCurrent(), false);
  assert.equal(next.props.isCurrent(), true);
  assert.deepEqual(f.focused, []);
});

test("explicit Close without keeping changes finishes the review before closing Result exactly once", () => {
  const f = fixture();
  f.textarea().props.onChange({ target: { value: "Draft being explicitly discarded" } });
  f.requestClose();
  const content = f.review().props.children;
  content.props.onOpenAutoFocus({ preventDefault() {} });
  f.button("Close without keeping changes").props.onClick();
  assert.equal(f.review().props.open, false);
  assert.deepEqual(f.calls, []);
  content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  content.props.onCloseAutoFocus({ preventDefault() {}, target: f.reviewSurface });
  assert.deepEqual(f.calls, ["result-close"]);
});

test("unchanged Result still closes directly without dirty review", () => {
  const f = fixture();
  f.requestClose();
  assert.equal(f.review().props.open, false);
  assert.deepEqual(f.calls, ["result-close"]);
});

function conflictedFixture(options) {
  const f = fixture({ durable: true, ...options });
  const draft = "Unsent draft to keep\n  with exact whitespace.\n";
  const current = "Fixed current revision from the other editor.";
  f.textarea().props.onChange({ target: { value: draft } });
  f.collaboration.snapshot = {
    ...f.collaboration.snapshot,
    document: { id: "doc-a", revision: 4, content: current },
    versions: [
      { revision: 4, created_at: "2026-10-19T01:00:00Z" },
      ...f.collaboration.snapshot.versions,
    ],
  };
  f.collaboration.conflict = true;
  f.collaboration.adopt = () => {
    f.collaboration.conflict = false;
    return current;
  };
  const recovery = new f.Element("Load current version");
  f.root.children.add(recovery);
  f.document.activeElement = recovery;
  return { ...f, draft, current, recovery };
}

for (const embedded of [true, false]) {
  test(`Load current version hands focus to the ${embedded ? "embedded" : "modal"} editor before its button disappears and preserves the copied draft`, async () => {
    const f = conflictedFixture({ embedded });
    f.button("Copy my draft").props.onClick();
    await Promise.resolve();
    assert.deepEqual(f.clipboard, [f.draft]);
    assert.equal(f.textarea().props.value, f.draft);
    assert.equal(f.collaboration.conflict, true);
    f.button("Load current version").props.onClick({ currentTarget: f.recovery });
    // This is synchronous, before React removes the focused recovery control.
    assert.equal(f.document.activeElement, f.editor);
    assert.deepEqual(f.focused, ["content editor"]);
    assert.equal(f.button("Load current version"), undefined);
    assert.equal(f.textarea().props.value, f.current);
    assert.equal(f.collaboration.snapshot.document.revision, 4);
    assert.equal(f.collaboration.conflict, false);
    assert.deepEqual(f.clipboard, [f.draft]);
    assert.deepEqual(f.calls, []);
    const later = new f.Element("later input");
    f.document.activeElement = later;
    f.render();
    assert.equal(f.document.activeElement, later, "Subsequent renders do not steal focus");
  });
}

for (const unavailable of ["detached", "hidden", "inert"]) {
  test(`Load current version falls back to surviving Close result when the editor is ${unavailable}`, () => {
    const f = conflictedFixture();
    if (unavailable === "detached") f.editor.isConnected = false;
    if (unavailable === "hidden") f.editor.hidden = true;
    if (unavailable === "inert") f.editor.inert = true;
    f.button("Load current version").props.onClick({ currentTarget: f.recovery });
    assert.equal(f.document.activeElement, f.closeResult);
    assert.deepEqual(f.focused, ["Close result"]);
    assert.equal(f.button("Load current version"), undefined);
    assert.equal(f.textarea().props.value, f.current);
  });
}

test("a null conflict adoption preserves the draft, recovery control and its focus", () => {
  const f = conflictedFixture();
  f.collaboration.adopt = () => null;
  f.button("Load current version").props.onClick({ currentTarget: f.recovery });
  assert.equal(f.document.activeElement, f.recovery);
  assert.deepEqual(f.focused, []);
  assert.equal(f.textarea().props.value, f.draft);
  assert.equal(f.collaboration.conflict, true);
  assert.ok(f.button("Load current version"));
});

test("conflict adoption does not take focus away from another active surface", () => {
  const f = conflictedFixture();
  const later = new f.Element("later input");
  f.document.activeElement = later;
  f.button("Load current version").props.onClick({ currentTarget: f.recovery });
  assert.equal(f.document.activeElement, later);
  assert.deepEqual(f.focused, []);
  assert.equal(f.button("Load current version"), undefined);
  assert.equal(f.textarea().props.value, f.current);
});

for (const fallback of [false, true]) {
  test(`Close preview restores ${fallback ? "editor fallback" : "Versions opener"} before removing its control`, async () => {
    const f = fixture();
    f.textarea().props.onChange({ target: { value: "Unsaved comparison draft" } });
    f.open();
    await f.previews()[0].props.onClick();
    if (fallback) f.trigger.isConnected = false;
    f.document.activeElement = f.closePreview;
    f.button("Close preview").props.onClick({ currentTarget: f.closePreview });
    assert.equal(f.document.activeElement, fallback ? f.editor : f.trigger);
    assert.equal(
      f.find((node) => node.props["aria-label"] === "Version comparison"),
      undefined,
    );
    assert.equal(f.textarea().props.value, "Unsaved comparison draft");
    assert.deepEqual(f.calls, []);
  });
}

for (const interruption of [
  "account",
  "document",
  "unmount",
  "navigation",
  "later-focus",
  "replacement-preview",
]) {
  test(`Close preview cannot restore stale focus after ${interruption}`, async () => {
    const f = fixture();
    f.open();
    await f.previews()[0].props.onClick();
    const close = f.button("Close preview").props.onClick;
    f.document.activeElement = f.closePreview;
    if (interruption === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    }
    if (interruption === "document") {
      f.props.messageId = "message-b";
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = new f.Element("later input");
    if (interruption === "replacement-preview") {
      f.open();
      await f.previews()[0].props.onClick();
    }
    close({ currentTarget: f.closePreview });
    assert.deepEqual(f.focused, []);
    if (interruption === "replacement-preview")
      assert.ok(f.find((node) => node.props["aria-label"] === "Version comparison"));
  });
}
