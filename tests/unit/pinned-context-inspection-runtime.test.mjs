import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";
import * as contract from "../../src/lib/chat-workspace-contract.mjs";

// Actual component callbacks with explicit service, hook and element doubles.
// No live account, files, provider, DOM, Radix behavior or browser is exercised.
const pin = (id = "pin-a", sourceType = "library", status = "active") => ({
  id,
  chatId: "chat-a",
  sourceType,
  sourceId: `source-${id}`,
  projectId: sourceType === "project_file" ? "project-a" : null,
  status,
  createdAt: "2026-01-01T00:00:00Z",
});
const entry = (row, overrides = {}) => ({
  pinId: row.id,
  sourceId: row.sourceId,
  sourceType: row.sourceType,
  projectId: row.projectId,
  status: row.status,
  statusLabel: contract.describePinStatus(row.status),
  name: `Actual ${row.id}`,
  content: "Readable extracted text",
  truncated: false,
  includedChars: 23,
  ...overrides,
});
const context = (items, overrides = {}) => ({
  items,
  usedChars: items.reduce((sum, item) => sum + item.includedChars, 0),
  totalBudget: 24000,
  truncated: false,
  truncatedCount: 0,
  skippedCount: 0,
  ...overrides,
});

function fixture(initialProps = {}, initialAccount = {}) {
  let account = { isLoaded: true, isSignedIn: true, user: { id: "owner-a" }, ...initialAccount };
  let hooks = createHookHarness();
  const outerHooks = createHookHarness();
  let renderingOuter = false;
  let holdCleanup = false;
  let key, tree, outer;
  const props = { open: true, chatId: "chat-a", onOpenChange() {}, ...initialProps };
  const calls = { rules: [], pins: [], context: [], library: [], unpin: [], pin: [], toasts: [] };
  const targets = new Map();
  const commitEffects = [];
  const focused = [];
  const listeners = new Map();
  const events = (prefix) => ({
    addEventListener(name, listener) {
      const key = prefix + name;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(prefix + name)?.delete(listener);
    },
  });
  const document = { body: {}, activeElement: null, ...events("document:") };
  document.activeElement = document.body;
  const window = { location: { href: "https://kova.test/chat/chat-a" }, ...events("window:") };
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
  }
  const request = (name, args) => {
    const pending = deferred();
    calls[name].push({ args, ...pending });
    return pending.promise;
  };
  const modules = {
    react: {
      ...Object.fromEntries(
        ["useState", "useRef", "useCallback"].map((name) => [
          name,
          (...args) => (renderingOuter ? outerHooks : hooks).react[name](...args),
        ]),
      ),
      useEffect(effect, deps) {
        hooks.react.useEffect(() => {
          let cleanup;
          commitEffects.push(() => {
            cleanup = effect();
          });
          return () => cleanup?.();
        }, deps);
      },
    },
    "@/components/auth/ClerkSafe": { useUser: () => account },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "lucide-react": {},
    sonner: {
      toast: {
        success: (...args) => calls.toasts.push(args),
        message: (...args) => calls.toasts.push(args),
      },
    },
    "@/components/ui/dialog": Object.fromEntries(
      ["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map(
        (name) => [name, name],
      ),
    ),
    "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
    "@/lib/chat-workspace.functions": {
      getChatCustomRules: (...args) => {
        calls.rules.push(args);
        return Promise.resolve(null);
      },
      saveChatCustomRules: () => {
        throw Error("Unexpected save");
      },
      resetChatCustomRules: () => {
        throw Error("Unexpected reset");
      },
      listChatPinnedFiles: (args) => request("pins", args),
      resolvePinnedContext: (args) => request("context", args),
      pinChatFile: (args) => request("pin", args),
      unpinChatFile: (args) => request("unpin", args),
    },
    "@/lib/library.functions": { listMyLibrary: (args) => request("library", args) },
    "@/lib/local-chat-workspace.mjs": { localRules: () => null },
    "@/lib/principal-browser-storage.mjs": { safeBrowserStorage: () => null },
    "@/lib/chat-workspace-contract.mjs": contract,
  };
  const { ChatWorkspaceDialog } = loadUiModule("src/components/ChatWorkspaceDialog.tsx", modules, {
    window,
    document,
    Error,
  });
  function visible(node) {
    if (Array.isArray(node)) return node.map(visible);
    if (!node || typeof node !== "object") return node;
    if (node.type === "Dialog" && !node.props.open) return null;
    return { ...node, props: { ...node.props, children: visible(node.props?.children) } };
  }
  function bind(node, row = "") {
    if (Array.isArray(node)) {
      node.forEach((child) => bind(child, row));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (node.type === "li") row = node.key;
    if (node.type === "button" || (node.props.role === "region" && node.props.tabIndex === -1)) {
      const label = node.props["aria-label"] ?? text(node).trim();
      const identity = row
        ? `${row}:${label.startsWith("Inspect ") ? "inspect" : label.startsWith("Unpin ") ? "unpin" : label}`
        : label;
      let target = targets.get(identity);
      if (!target) {
        target = new Element(label);
        targets.set(identity, target);
      }
      target.name = label;
      target.isConnected = true;
      target.disabled = node.props.disabled;
      node.element = target;
      if (typeof node.props.ref === "function") node.props.ref(target);
      else if (node.props.ref) node.props.ref.current = target;
    }
    bind(node.props?.children, row);
  }
  function render() {
    renderingOuter = true;
    outer = outerHooks.render(ChatWorkspaceDialog, props);
    renderingOuter = false;
    const contents = elements(outer).find((node) => typeof node.type === "function");
    if (key !== contents.key) {
      if (!holdCleanup) hooks.unmount();
      hooks = createHookHarness();
      key = contents.key;
    }
    for (const target of targets.values()) target.isConnected = false;
    tree = visible(hooks.render(contents.type, contents.props));
    bind(tree);
    if (document.activeElement?.isConnected === false) document.activeElement = document.body;
    for (const commit of commitEffects.splice(0)) commit();
    return tree;
  }
  function button(label) {
    const result = elements(
      tree,
      (node) =>
        node.type === "button" &&
        (node.props["aria-label"] === label || text(node).trim() === label),
    )[0];
    assert.ok(result, `Missing button ${label}: ${text(tree)}`);
    return result;
  }
  function click(label) {
    const node = button(label);
    document.activeElement = node.element;
    const result = node.props.onClick({ currentTarget: node.element });
    render();
    return result;
  }
  async function respond(rows = [pin()], result = context(rows.map((row) => entry(row)))) {
    calls.pins.at(-1).resolve(rows);
    calls.context.at(-1).resolve(result);
    await settle();
    render();
  }
  async function openFiles(rows, result) {
    click("Pinned files");
    render();
    render();
    await respond(rows, result);
  }
  function closeInspection() {
    const content = elements(tree, (node) => node.type === "DialogContent").at(-1);
    click("Close inspection");
    render();
    content.props.onCloseAutoFocus({ preventDefault() {} });
  }
  render();
  return {
    render,
    holdCleanup() {
      holdCleanup = true;
    },
    button,
    click,
    respond,
    openFiles,
    closeInspection,
    calls,
    targets,
    focused,
    emit(name, target = document.body, channel = "document") {
      for (const listener of [...(listeners.get(`${channel}:${name}`) ?? [])])
        listener({ type: name, target });
    },
    get listenerCount() {
      return [...listeners.values()].reduce((count, value) => count + value.size, 0);
    },
    document,
    window,
    get tree() {
      return tree;
    },
    get key() {
      return key;
    },
    get outer() {
      return outer;
    },
    change(next, nextAccount) {
      Object.assign(props, next);
      if (nextAccount) account = nextAccount;
      render();
    },
    unmount() {
      hooks.unmount();
    },
  };
}

test("actual pin titles and inspectable context do not fetch or depend on the first 50 Library choices", async () => {
  const view = fixture();
  assert.equal(view.calls.pins.length, 0);
  assert.equal(view.calls.context.length, 0);
  assert.equal(view.calls.library.length, 0);
  const row = pin("older-than-50");
  const item = entry(row, { name: "Old saved research beyond page 50" });
  await view.openFiles([row], context([item]));
  assert.match(text(view.tree), /Old saved research beyond page 50/);
  assert.equal(view.calls.library.length, 0);
  view.click("Inspect Old saved research beyond page 50");
  view.render();
  assert.match(text(view.tree), /Loading pinned context/);
  assert.doesNotMatch(text(view.tree), /Readable extracted text/);
  assert.equal(view.calls.context.at(-1).args.data.chatId, "chat-a");
  await view.respond([row], context([item]));
  assert.match(text(view.tree), /Origin Library Readiness available/);
  assert.match(text(view.tree), /Bounded extracted text/);
  assert.match(text(view.tree), /Readable extracted text/);
  assert.equal(view.calls.library.length, 0);
  view.closeInspection();
  view.click("Choose a Library item to pin");
  view.render();
  assert.equal(view.calls.library.length, 1);
  view.calls.library[0].resolve(
    Array.from({ length: 70 }, (_, i) => ({ id: `choice-${i}`, title: `Choice ${i}` })),
  );
  await settle();
  view.render();
  assert.match(text(view.tree), /up to 50 recent Library items/);
  assert.equal(
    elements(
      view.tree,
      (node) => node.type === "ul" && node.props["aria-label"] === "Library choices",
    )[0].props.children.length,
    50,
  );
  assert.match(text(view.tree), /Old saved research beyond page 50/);
});

test("project origin, bounded text and explicit truncation are server-derived", async () => {
  const view = fixture();
  const row = pin("project-pin", "project_file");
  const item = entry(row, {
    name: "Project design.pdf",
    content: "Only the bounded excerpt",
    truncated: true,
    includedChars: 24,
  });
  const resolved = context([item], { truncated: true, truncatedCount: 1 });
  await view.openFiles([row], resolved);
  view.click("Inspect Project design.pdf");
  await view.respond([row], resolved);
  assert.match(text(view.tree), /Origin Project files Readiness available/);
  assert.match(text(view.tree), /Truncated: only\s+24\s+characters/);
  assert.match(text(view.tree), /This is not the full file/);
  assert.match(text(view.tree), /Only the bounded excerpt/);
});

for (const [status, name] of [
  ["deleted", "Removed item"],
  ["permission_lost", "Unavailable file"],
  ["indexing", "Processing report"],
  ["failed", "Unreadable file"],
]) {
  test(`${status} inspection discloses readiness without exposing previous or inaccessible content`, async () => {
    const view = fixture();
    const row = pin("pin-a", status === "permission_lost" ? "project_file" : "library");
    await view.openFiles([row], context([entry(row, { content: "Old readable secret" })]));
    view.click("Inspect Actual pin-a");
    view.render();
    assert.doesNotMatch(text(view.tree), /Old readable secret/);
    const corrected = { ...row, status };
    await view.respond([row], context([entry(corrected, { name, content: "", includedChars: 0 })]));
    assert.match(text(view.tree), new RegExp(contract.describePinStatus(status)));
    assert.match(text(view.tree), /No readable text is included/);
    assert.doesNotMatch(text(view.tree), /Old readable secret/);
    assert.equal(view.button("Unpin from this chat").props.disabled, false);
  });
}

test("a pin omitted by the shared budget stays removable and explicitly unresolved", async () => {
  const view = fixture();
  const row = pin("omitted");
  const resolved = context([], { skippedCount: 1, truncated: true, usedChars: 24000 });
  await view.openFiles([row], resolved);
  assert.match(text(view.tree), /1 pinned item\(s\) omitted by the context budget/);
  view.click("Inspect Pinned Library item");
  await view.respond([row], resolved);
  assert.match(text(view.tree), /shared text budget may be exhausted/);
  assert.match(text(view.tree), /name and content are unavailable here/);
  assert.equal(view.button("Unpin from this chat").props.disabled, false);
});

test("resolver failure hides cached text and supports explicit retry without Library access", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Inspect Actual pin-a");
  view.calls.pins.at(-1).resolve([pin()]);
  view.calls.context.at(-1).reject(Error("Synthetic context failure"));
  await settle();
  view.render();
  assert.match(text(view.tree), /Synthetic context failure/);
  assert.doesNotMatch(text(view.tree), /Readable extracted text/);
  view.click("Retry inspection");
  await view.respond();
  assert.match(text(view.tree), /Readable extracted text/);
  assert.doesNotMatch(text(view.tree), /Synthetic context failure/);
  assert.equal(view.calls.library.length, 0);
});

test("initial pin loading and error do not falsely claim an empty chat", async () => {
  const view = fixture();
  view.click("Pinned files");
  view.render();
  view.render();
  assert.match(text(view.tree), /Loading pinned context/);
  assert.doesNotMatch(text(view.tree), /No files pinned/);
  view.calls.pins.at(-1).reject(Error("Synthetic list failure"));
  view.calls.context.at(-1).resolve(context([]));
  await settle();
  view.render();
  assert.match(text(view.tree), /Synthetic list failure/);
  assert.doesNotMatch(text(view.tree), /No files pinned/);
  view.click("Retry pinned context");
  await view.respond([], context([]));
  assert.match(text(view.tree), /No files pinned/);
});

test("Library failure is visible and retryable, rather than reported as an empty Library", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Choose a Library item to pin");
  view.calls.library.at(-1).reject(Error("Synthetic Library failure"));
  await settle();
  view.render();
  assert.match(text(view.tree), /Synthetic Library failure/);
  assert.doesNotMatch(text(view.tree), /Your Library is empty/);
  view.click("Retry Library choices");
  view.calls.library.at(-1).resolve([]);
  await settle();
  view.render();
  assert.match(text(view.tree), /Your Library is empty/);
});

test("closing inspection returns focus to its exact original row invoker", async () => {
  const view = fixture();
  await view.openFiles([pin("pin-a"), pin("pin-b")]);
  const invoker = view.button("Inspect Actual pin-b").element;
  view.click("Inspect Actual pin-b");
  await view.respond([pin("pin-a"), pin("pin-b")]);
  view.closeInspection();
  assert.equal(view.document.activeElement, invoker);
  assert.deepEqual(view.focused, ["Inspect Actual pin-b"]);
});

test("inspection return focus never crosses navigation or detached invokers", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Inspect Actual pin-a");
  await view.respond();
  view.window.location.href = "https://kova.test/library";
  view.closeInspection();
  assert.deepEqual(view.focused, []);
});

test("row unpin is synchronously locked and focuses the next corresponding row action", async () => {
  const view = fixture();
  const rows = [pin("pin-a"), pin("pin-b")];
  await view.openFiles(rows);
  const handler = view.button("Unpin Actual pin-a");
  view.click("Unpin Actual pin-a");
  handler.props.onClick({ currentTarget: handler.element });
  assert.equal(view.calls.unpin.length, 1);
  view.render();
  assert.equal(view.button("Unpin Actual pin-b").props.disabled, true);
  view.calls.unpin[0].resolve({ ok: true });
  await settle();
  view.render();
  assert.equal(view.document.activeElement, view.button("Unpin Actual pin-b").element);
  assert.doesNotMatch(text(view.tree), /Actual pin-a/);
  await view.respond([rows[1]]);
});

test("last-row unpin restores the preceding row, and final unpin restores the Library chooser", async () => {
  const view = fixture();
  const rows = [pin("pin-a"), pin("pin-b")];
  await view.openFiles(rows);
  view.click("Unpin Actual pin-b");
  view.calls.unpin.at(-1).resolve({ ok: true });
  await settle();
  view.render();
  assert.equal(view.document.activeElement, view.button("Unpin Actual pin-a").element);
  await view.respond([rows[0]]);
  view.click("Unpin Actual pin-a");
  view.calls.unpin.at(-1).resolve({ ok: true });
  await settle();
  view.render();
  assert.equal(view.document.activeElement, view.button("Choose a Library item to pin").element);
  await view.respond([], context([]));
});

test("unpin inside inspection closes it and returns to the nearest inspect action", async () => {
  const view = fixture();
  const rows = [pin("pin-a"), pin("pin-b")];
  await view.openFiles(rows);
  view.click("Inspect Actual pin-a");
  await view.respond(rows);
  const inspector = elements(view.tree, (node) => node.type === "DialogContent").at(-1);
  view.click("Unpin from this chat");
  view.calls.unpin.at(-1).resolve({ ok: true });
  await settle();
  view.render();
  inspector.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(view.document.activeElement, view.button("Inspect Actual pin-b").element);
  assert.equal(elements(view.tree, (node) => node.type === "Dialog" && node.props.open).length, 0);
  await view.respond([rows[1]]);
});

test("unpin rejection preserves the pin and supports an explicit retry; late success respects moved focus", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Unpin Actual pin-a");
  view.calls.unpin[0].reject(Error("Synthetic unpin failure"));
  await settle();
  view.render();
  assert.match(text(view.tree), /Synthetic unpin failure/);
  assert.equal(view.button("Unpin Actual pin-a").props.disabled, false);
  view.click("Unpin Actual pin-a");
  const other = view.button("Pinned files").element;
  view.document.activeElement = other;
  view.calls.unpin[1].resolve({ ok: true });
  await settle();
  view.render();
  assert.equal(view.document.activeElement, other);
  assert.deepEqual(view.focused, []);
  await view.respond([], context([]));
});

for (const [label, nextProps, nextAccount] of [
  ["account", {}, { isLoaded: true, isSignedIn: true, user: { id: "owner-b" } }],
  ["chat", { chatId: "chat-b" }],
  ["temporary", { temporary: true }],
  ["close", { open: false }],
  ["sign out", {}, { isLoaded: true, isSignedIn: false, user: null }],
]) {
  test(`late context, Library and unpin responses cannot cross a ${label} boundary`, async () => {
    const view = fixture();
    await view.openFiles();
    const originalKey = view.key;
    view.click("Choose a Library item to pin");
    const oldLibrary = view.calls.library.at(-1);
    view.click("Inspect Actual pin-a");
    const oldPins = view.calls.pins.at(-1),
      oldContext = view.calls.context.at(-1);
    view.click("Unpin from this chat");
    const oldUnpin = view.calls.unpin.at(-1);
    const priorFocus = [...view.focused];
    view.change(nextProps, nextAccount);
    assert.notEqual(view.key, originalKey);
    const before = view.calls.pins.length;
    oldPins.resolve([pin("private-old-pin")]);
    oldContext.resolve(
      context([entry(pin("private-old-pin"), { content: "Private old-owner text" })]),
    );
    oldLibrary.resolve([{ id: "private-choice", title: "Private old-owner choice" }]);
    oldUnpin.resolve({ ok: true });
    await settle();
    view.render();
    assert.doesNotMatch(text(view.tree), /Private old-owner|private-old-pin|Actual pin-a/);
    assert.equal(view.calls.pins.length, before);
    assert.deepEqual(view.calls.toasts, []);
    assert.deepEqual(view.focused, priorFocus);
  });
}

test("temporary, signed-out and unresolved principals do not read or mutate pinned context", async () => {
  for (const [props, account] of [
    [{ temporary: true }, {}],
    [{}, { isLoaded: true, isSignedIn: false, user: null }],
    [{}, { isLoaded: false, isSignedIn: true, user: { id: "owner-a" } }],
    [{}, { isLoaded: true, isSignedIn: true, user: null }],
  ]) {
    const view = fixture(props, account);
    view.click("Pinned files");
    view.render();
    await settle();
    view.render();
    for (const name of ["pins", "context", "library", "unpin", "pin"])
      assert.equal(view.calls[name].length, 0);
    assert.match(text(view.tree), /Temporary chats cannot pin files|Sign in to pin/);
  }
});

test("newer context request wins and a removed pin cannot be resurrected by a stale read", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Inspect Actual pin-a");
  const oldPins = view.calls.pins.at(-1),
    oldContext = view.calls.context.at(-1);
  view.click("Unpin from this chat");
  view.calls.unpin.at(-1).resolve({ ok: true });
  await settle();
  view.render();
  await view.respond([], context([]));
  oldPins.resolve([pin()]);
  oldContext.resolve(context([entry(pin(), { content: "Stale content" })]));
  await settle();
  view.render();
  assert.match(text(view.tree), /No files pinned/);
  assert.doesNotMatch(text(view.tree), /Actual pin-a|Stale content/);
});

test("scope invalidation blocks a late pin receipt before passive cleanup, including A-to-B-to-A", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Choose a Library item to pin");
  view.calls.library.at(-1).resolve([{ id: "choice", title: "New file" }]);
  await settle();
  view.render();
  view.click("New file");
  const pending = view.calls.pin.at(-1);
  view.holdCleanup();
  view.change({}, { isLoaded: true, isSignedIn: true, user: { id: "owner-b" } });
  view.change({}, { isLoaded: true, isSignedIn: true, user: { id: "owner-a" } });
  const before = view.calls.pins.length;
  pending.resolve(pin("late-pin"));
  await settle();
  view.render();
  assert.equal(view.calls.pins.length, before);
  assert.deepEqual(view.calls.toasts, []);
  assert.doesNotMatch(text(view.tree), /late-pin|New file/);
});

test("closing an externally removed pin falls back to the chooser instead of a detached invoker", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Inspect Actual pin-a");
  await view.respond([], context([]));
  assert.match(text(view.tree), /no longer pinned to this chat/);
  view.closeInspection();
  assert.equal(view.document.activeElement, view.button("Choose a Library item to pin").element);
});

test("last-pin removal uses the files tab if the Library chooser is loading", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Choose a Library item to pin");
  view.click("Unpin Actual pin-a");
  view.calls.unpin.at(-1).resolve({ ok: true });
  await settle();
  view.render();
  assert.equal(view.document.activeElement, view.button("Pinned files").element);
  view.calls.library.at(-1).resolve([]);
  await view.respond([], context([]));
});

test("Library chooser, refresh and retry keep focus on one stable result region through all read states", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Choose a Library item to pin");
  const region = view.targets.get("Library choice results");
  assert.equal(view.document.activeElement, region);
  assert.equal(view.listenerCount, 0);
  assert.equal(view.button("Refresh Library choices").props.disabled, true);
  view.calls.library.at(-1).resolve([{ id: "choice-b", title: "Another sample" }]);
  await settle();
  view.render();
  assert.equal(view.document.activeElement, region);
  assert.match(text(view.tree), /Another sample/);
  view.click("Refresh Library choices");
  view.calls.library.at(-1).reject(Error("Synthetic failed refresh"));
  await settle();
  view.render();
  assert.equal(view.document.activeElement, region);
  view.click("Retry Library choices");
  view.calls.library.at(-1).resolve([]);
  await settle();
  view.render();
  assert.equal(view.document.activeElement, region);
  assert.match(text(view.tree), /Your Library is empty/);
  assert.deepEqual(view.focused, Array(3).fill("Library choice results"));
});

test("pinned retry and inspection retry/refresh focus stable result regions instead of removed triggers", async () => {
  const view = fixture();
  view.click("Pinned files");
  view.render();
  view.calls.pins.at(-1).reject(Error("Read failed"));
  view.calls.context.at(-1).resolve(context([]));
  await settle();
  view.render();
  view.click("Retry pinned context");
  const list = view.targets.get("Pinned context results");
  assert.equal(view.document.activeElement, list);
  await view.respond();
  assert.equal(view.document.activeElement, list);
  view.click("Inspect Actual pin-a");
  view.calls.pins.at(-1).resolve([pin()]);
  view.calls.context.at(-1).reject(Error("Inspection failed"));
  await settle();
  view.render();
  view.click("Retry inspection");
  const inspection = view.targets.get("Pinned inspection results");
  assert.equal(view.document.activeElement, inspection);
  await view.respond();
  assert.equal(view.document.activeElement, inspection);
  view.click("Refresh context");
  await view.respond();
  assert.equal(view.document.activeElement, inspection);
  view.closeInspection();
  assert.equal(view.document.activeElement, view.button("Inspect Actual pin-a").element);
});

for (const interaction of [
  "focusin",
  "pointerdown",
  "keydown",
  "popstate",
  "hashchange",
  "pagehide",
  "blur",
]) {
  test(`an intervening ${interaction} cancels chooser focus even if focus later falls back to body`, async () => {
    const view = fixture();
    await view.openFiles();
    const trigger = view.button("Choose a Library item to pin");
    view.document.activeElement = trigger.element;
    trigger.props.onClick({ currentTarget: trigger.element });
    assert.equal(view.listenerCount, 7);
    view.emit(
      interaction,
      view.button("Rules").element,
      ["popstate", "hashchange", "pagehide", "blur"].includes(interaction) ? "window" : "document",
    );
    view.document.activeElement = view.document.body;
    view.render();
    view.calls.library.at(-1).resolve([{ id: "sample", title: "Synthetic choice" }]);
    await settle();
    view.render();
    assert.deepEqual(view.focused, []);
    assert.equal(view.document.activeElement, view.document.body);
    assert.equal(view.listenerCount, 0);
  });
}

test("completion never reclaims focus from a later interaction in the same dialog", async () => {
  const view = fixture();
  await view.openFiles();
  view.click("Choose a Library item to pin");
  const other = view.button("Pinned files").element;
  view.document.activeElement = other;
  view.calls.library.at(-1).resolve([{ id: "sample", title: "Synthetic choice" }]);
  await settle();
  view.render();
  assert.equal(view.document.activeElement, other);
  assert.deepEqual(view.focused, ["Library choice results"]);
});

for (const boundary of ["account", "chat", "close", "navigation", "unmount"]) {
  test(`queued chooser focus cannot cross ${boundary}, even before passive cleanup`, async () => {
    const view = fixture();
    await view.openFiles();
    const trigger = view.button("Choose a Library item to pin");
    view.document.activeElement = trigger.element;
    trigger.props.onClick({ currentTarget: trigger.element });
    const pending = view.calls.library.at(-1);
    view.holdCleanup();
    if (boundary === "account")
      view.change({}, { isLoaded: true, isSignedIn: true, user: { id: "owner-b" } });
    else if (boundary === "chat") view.change({ chatId: "chat-b" });
    else if (boundary === "close") view.change({ open: false });
    else if (boundary === "navigation") {
      view.window.location.href = "https://kova.test/library";
      view.render();
    } else view.unmount();
    pending.resolve([{ id: "old", title: "Old scope choice" }]);
    await settle();
    if (boundary !== "unmount") view.render();
    assert.deepEqual(view.focused, []);
  });
}
