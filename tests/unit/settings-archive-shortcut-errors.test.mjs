import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as trashPolicy from "../../src/lib/chat-trash-policy.mjs";
import {
  createHookHarness,
  elements,
  text,
  deferred,
  settle,
  jsxRuntime,
  loadUiModule,
} from "../helpers/ui-state-harness.mjs";

// Run the actual local section functions with explicit storage and DOM stubs.
// The fixtures do not delete user data or run browser/provider operations.
const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const parsed = ts.createSourceFile(
  "SettingsDialog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function loadSection(name, hooks, dependencies, shortcuts = () => ({})) {
  const node = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(node);
  const compiled = ts.transpileModule(`${node.getText(parsed)}\nexports.component = ${name};`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    ...hooks.react,
    useMemo: (fn, deps) => hooks.react.useCallback(fn(), deps),
    Button: "Button",
    ShortcutRow: "ShortcutRow",
    Trash2: "Trash2",
    ...Object.fromEntries(
      [
        "AlertDialog",
        "AlertDialogContent",
        "AlertDialogHeader",
        "AlertDialogTitle",
        "AlertDialogDescription",
        "AlertDialogFooter",
        "AlertDialogCancel",
      ].map((name) => [name, name]),
    ),
    require(id) {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "@/lib/shortcuts") return shortcuts();
      throw new Error(`Unexpected dependency ${id}`);
    },
    Error,
    Event,
    ...dependencies,
  });
  return exports.component;
}
function dom() {
  const focused = [],
    events = [],
    listeners = new Map();
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.children = new Set();
    }
    contains(node) {
      return this.children.has(node);
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
  }
  const document = { body: new Element("body"), activeElement: null };
  document.activeElement = document.body;
  const window = {
    location: { href: "https://kova.test/settings/privacy" },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    dispatchEvent: (event) => events.push(event.type),
  };
  return { focused, events, listeners, Element, document, window, HTMLElement: Element };
}
const chat = { id: "chat-a", title: "Research notes", messages: [], updatedAt: 5 };
function archiveFixture() {
  const hooks = createHookHarness(),
    browser = dom(),
    calls = [],
    notices = [];
  const stored = { active: [], archived: [chat] };
  const trashData = new Map();
  const behavior = {
    now: 1_700_000_000_000,
    failTrashRead: false,
    failTrashWrite: false,
    canWrite: true,
    afterTrashWrite: () => {},
    active: async (_owner, rows) => {
      stored.active = rows;
      return true;
    },
    archived: async (_owner, rows) => {
      stored.archived = rows;
      return true;
    },
  };
  const props = { userKey: "owner-a" };
  class Clock extends Date {
    static now() {
      return behavior.now;
    }
  }
  class CustomEvent extends Event {
    constructor(type, init) {
      super(type);
      this.detail = init.detail;
    }
  }
  const trash = loadUiModule(
    "src/lib/chat-trash.ts",
    {
      "../components/ChatDeleteConfirmation": {
        confirmPermanentChat: () => {
          throw new Error("Unexpected nested confirmation");
        },
      },
      "./chat-store": {
        chatStoragePrincipal: (owner) => (owner ? `user:${owner}` : "guest"),
        sanitizeArchivedConversations: (rows) => rows,
      },
      "./chat-history-bridge": { canWriteChatHistory: () => behavior.canWrite },
      "./chat-trash-policy.mjs": trashPolicy,
    },
    {
      window: browser.window,
      CustomEvent,
      Date: Clock,
      Error,
      localStorage: {
        getItem: (key) => {
          if (behavior.failTrashRead) throw new Error("Storage blocked");
          return trashData.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (behavior.failTrashWrite) throw new Error("Storage full");
          trashData.set(key, value);
          behavior.afterTrashWrite();
        },
      },
    },
  );
  const component = loadSection("ArchivedChatsPanel", hooks, {
    ...browser,
    Date: Clock,
    TRASH_RETENTION_OPTIONS: trashPolicy.TRASH_RETENTION_OPTIONS,
    readChatTrash: trash.readChatTrash,
    writeChatTrash: (...args) => {
      calls.push(["trash", ...args]);
      return trash.writeChatTrash(...args);
    },
    loadArchivedConversations: () => stored.archived,
    loadConversations: () => stored.active,
    mergeConversations: (a, b) => [...new Map([...a, ...b].map((row) => [row.id, row])).values()],
    saveConversations: (...args) => {
      calls.push(["active", ...args]);
      return behavior.active(...args);
    },
    saveArchivedConversations: (...args) => {
      calls.push(["archive", ...args]);
      return behavior.archived(...args);
    },
    toast: { success: (...args) => notices.push(args) },
    PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "clear",
    isPrincipalBrowserStorageClearedEvent: (event, owner) => event.owner === owner,
    restoreDialogFocus: loadUiModule(
      "src/lib/dialog-return-focus.ts",
      {},
      { window: browser.window },
    ).restoreDialogFocus,
  });
  const heading = new browser.Element("Archived heading"),
    cancel = new browser.Element("Cancel"),
    deleteHeading = new browser.Element("Delete heading"),
    dialog = new browser.Element("Confirmation");
  dialog.children.add(cancel);
  dialog.children.add(deleteHeading);
  const render = () => {
    const tree = hooks.render(component, props);
    elements(tree, (node) => node.type === "h4")[0].props.ref.current = heading;
    elements(tree, (node) => node.type === "AlertDialogCancel")[0].props.ref.current = cancel;
    elements(tree, (node) => node.type === "AlertDialogTitle")[0].props.ref.current = deleteHeading;
    return tree;
  };
  const find = (predicate) => elements(render(), predicate)[0];
  const button = (label) =>
    find(
      (node) =>
        node.type === "Button" &&
        (node.props["aria-label"] === label || text(node).trim() === label),
    );
  const confirmation = () => find((node) => node.type === "AlertDialog");
  const content = () => find((node) => node.type === "AlertDialogContent");
  const openDelete = () => {
    const trigger = new browser.Element("Delete Research notes");
    browser.document.activeElement = trigger;
    button("Delete archived chat Research notes").props.onClick({ currentTarget: trigger });
    render();
    return trigger;
  };
  render();
  render();
  return {
    ...browser,
    props,
    stored,
    readTrash: (owner = props.userKey) => trash.readChatTrash(owner),
    setTrash: (state, owner = props.userKey) =>
      trashData.set(trash.trashStorageKey(owner), JSON.stringify(state)),
    behavior,
    calls,
    notices,
    render,
    find,
    button,
    confirmation,
    content,
    openDelete,
    heading,
    cancel,
    deleteHeading,
    dialog,
    unmount: () => hooks.unmount(),
  };
}

test("archive restore failure stays named and visible until retry succeeds or dismissal", async () => {
  const f = archiveFixture();
  f.behavior.active = async () => false;
  f.button("Restore").props.onClick();
  await settle();
  assert.match(text(f.find((node) => node.props.role === "alert")), /restore “Research notes”/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.notices, []);
  for (let i = 0; i < 8; i++) f.render();
  assert.ok(f.button("Retry restore"));
  f.button("Dismiss error").props.onClick();
  assert.equal(
    f.find((node) => node.props.role === "alert"),
    undefined,
  );
  assert.equal(f.document.activeElement, f.heading);
  f.button("Restore").props.onClick();
  await settle();
  f.behavior.active = async (_owner, rows) => {
    f.stored.active = rows;
    return true;
  };
  f.button("Retry restore").props.onClick();
  await settle();
  assert.equal(f.stored.archived.length, 0);
  assert.deepEqual(f.notices, [["Chat restored"]]);
  assert.deepEqual(f.events, ["kova:conversations-imported"]);
  assert.equal(f.document.activeElement, f.heading);
});

test("partial restore retries only archive cleanup and does not repeat a confirmed active save", async () => {
  const f = archiveFixture();
  f.behavior.archived = async () => false;
  f.button("Restore").props.onClick();
  await settle();
  assert.match(text(f.render()), /Research notes.*restored.*archive update could not be confirmed/);
  assert.equal(f.stored.active[0].id, chat.id);
  assert.deepEqual(f.notices, []);
  f.behavior.archived = async (_owner, rows) => {
    f.stored.archived = rows;
    return true;
  };
  f.button("Retry archive update").props.onClick();
  await settle();
  assert.equal(f.calls.filter(([action]) => action === "active").length, 1);
  assert.equal(f.calls.filter(([action]) => action === "archive").length, 2);
  assert.deepEqual(f.notices, [["Chat restored"]]);
});

test("archived delete names the captured chat, defaults to Cancel, and canceled handlers cannot delete", async () => {
  const f = archiveFixture();
  const trigger = f.openDelete();
  assert.match(text(f.find((node) => node.type === "AlertDialogTitle")), /Research notes/);
  assert.deepEqual(f.calls, []);
  f.content().props.onOpenAutoFocus({ preventDefault() {} });
  assert.equal(f.document.activeElement, f.cancel);
  const staleConfirm = f.button("Move to Trash").props.onClick;
  f.confirmation().props.onOpenChange(false);
  f.content().props.onCloseAutoFocus({ preventDefault() {}, target: f.dialog });
  assert.equal(f.document.activeElement, trigger);
  staleConfirm();
  await settle();
  assert.deepEqual(f.calls, []);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("function ArchivedChatsPanel"),
      source.indexOf("// ---------- Family safety"),
    ),
    /window\.confirm/,
  );
});

test("failed archived deletion stays open with named error and safe explicit retry", async () => {
  const f = archiveFixture();
  f.behavior.archived = async () => {
    throw new Error("Storage unavailable");
  };
  f.openDelete();
  f.button("Move to Trash").props.onClick();
  await settle();
  assert.equal(f.confirmation().props.open, true);
  assert.match(
    text(f.find((node) => node.props.role === "alert")),
    /Research notes.*in Trash.*Archived chats/,
  );
  assert.equal(f.document.activeElement, f.deleteHeading);
  assert.deepEqual(f.notices, []);
  f.behavior.archived = async (_owner, rows) => {
    f.stored.archived = rows;
    return true;
  };
  f.button("Retry archive cleanup").props.onClick();
  await settle();
  assert.equal(f.confirmation().props.open, false);
  assert.equal(f.stored.archived.length, 0);
  assert.deepEqual(f.notices, [["Chat moved to Trash"]]);
  f.content().props.onCloseAutoFocus({ preventDefault() {}, target: f.dialog });
  assert.equal(f.document.activeElement, f.heading);
});

for (const interruption of ["account", "clear", "unmount"]) {
  test(`pending archive restore cannot continue or publish after ${interruption}`, async () => {
    const f = archiveFixture(),
      pending = deferred();
    f.behavior.active = () => pending.promise;
    f.button("Restore").props.onClick();
    if (interruption === "account") {
      f.props.userKey = "owner-b";
      f.render();
    }
    if (interruption === "clear") f.listeners.get("clear")({ owner: "owner-a" });
    if (interruption === "unmount") f.unmount();
    pending.resolve(true);
    await settle();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.events, []);
  });
}
for (const interruption of ["account", "clear", "unmount", "navigation", "later-focus"]) {
  test(`archived cancellation does not steal focus after ${interruption}`, () => {
    const f = archiveFixture();
    f.openDelete();
    const content = f.content();
    if (interruption === "account") {
      f.props.userKey = "owner-b";
      f.render();
    }
    if (interruption === "clear") f.listeners.get("clear")({ owner: "owner-a" });
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = new f.Element("later input");
    content.props.onCloseAutoFocus({ preventDefault() {}, target: f.dialog });
    assert.deepEqual(f.focused, []);
  });
}

const shortcuts = [
  { id: "new-chat", label: "New chat", description: "Start a conversation", combo: "Mod+N" },
  { id: "search", label: "Search chats", description: "Search conversations", combo: "Mod+K" },
];
function shortcutFixture() {
  const hooks = createHookHarness(),
    browser = dom(),
    calls = [],
    notices = [];
  const props = { userKey: "owner-a", principalResolved: true };
  const behavior = { save: true, reset: true, throwImport: false, combo: "Mod+J" };
  const mod = {
    DEFAULT_SHORTCUTS: shortcuts,
    loadShortcuts: () => shortcuts,
    shortcutComboFromKeyboardEvent: () => behavior.combo,
    saveShortcuts(owner, rows) {
      calls.push(["save", owner, rows]);
      return behavior.save;
    },
    resetShortcuts(owner) {
      calls.push(["reset", owner]);
      return behavior.reset;
    },
  };
  const component = loadSection(
    "ShortcutsEditor",
    hooks,
    {
      ...browser,
      browserStoragePrincipal: (owner) => (owner ? `user:${owner}` : "guest"),
      isPrincipalBrowserStorageClearedEvent: (event, owner) => event.owner === owner,
      PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "clear",
      toast: { success: (...args) => notices.push(args) },
    },
    () => {
      if (behavior.throwImport) throw new Error("Chunk unavailable");
      return mod;
    },
  );
  const heading = new browser.Element("Shortcut status");
  const render = () => {
    const tree = hooks.render(component, props);
    elements(tree, (node) => node.type === "p" && node.props.ref)[0].props.ref.current = heading;
    return tree;
  };
  const find = (predicate) => elements(render(), predicate)[0];
  const button = (label) => find((node) => node.type === "Button" && text(node).trim() === label);
  const row = (id) => find((node) => node.type === "ShortcutRow" && node.props.id === id);
  const record = (id = "new-chat") => {
    row(id).props.onRecord();
    render();
  };
  const key = () =>
    browser.listeners.get("keydown")?.({ key: "j", preventDefault() {}, stopPropagation() {} });
  render();
  return {
    ...browser,
    props,
    behavior,
    calls,
    notices,
    heading,
    render,
    find,
    button,
    row,
    record,
    key,
    unmount: () => hooks.unmount(),
    async ready() {
      await settle();
      render();
    },
  };
}

test("shortcut save failure retains the existing binding, named inline error and exact attempted retry", async () => {
  const f = shortcutFixture();
  await f.ready();
  f.behavior.save = false;
  f.record();
  f.key();
  await settle();
  assert.match(text(f.find((node) => node.props.role === "alert")), /New chat.*could not be saved/);
  assert.equal(f.row("new-chat").props.combo, "Mod+N");
  assert.deepEqual(f.notices, []);
  for (let i = 0; i < 8; i++) f.render();
  f.behavior.save = true;
  f.button("Retry save").props.onClick();
  await settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1][2][0].combo, "Mod+J");
  assert.equal(f.row("new-chat").props.combo, "Mod+J");
  assert.equal(
    f.find((node) => node.props.role === "alert"),
    undefined,
  );
  assert.equal(f.document.activeElement, f.heading);
  assert.deepEqual(f.notices, []);
});

test("shortcut reset failure stays visible until explicit retry and keeps the existing success-toast default", async () => {
  const f = shortcutFixture();
  await f.ready();
  f.behavior.reset = false;
  f.button("Reset to defaults").props.onClick();
  await settle();
  assert.match(
    text(f.find((node) => node.props.role === "alert")),
    /Keyboard shortcuts could not be reset/,
  );
  assert.deepEqual(f.notices, []);
  f.behavior.reset = true;
  f.button("Retry reset").props.onClick();
  await settle();
  assert.deepEqual(f.notices, [["Shortcuts reset"]]);
  assert.equal(
    f.find((node) => node.props.role === "alert"),
    undefined,
  );
});

test("invalid and conflicting shortcut errors name the action and support focused recording retry/dismissal", async () => {
  for (const combo of [null, "Mod+K"]) {
    const f = shortcutFixture();
    await f.ready();
    f.behavior.combo = combo;
    f.record();
    f.key();
    await settle();
    assert.match(text(f.find((node) => node.props.role === "alert")), /New chat/);
    if (combo) assert.match(text(f.render()), /Search chats/);
    assert.equal(f.calls.length, 0);
    f.button("Record again").props.onClick();
    assert.equal(f.row("new-chat").props.recording, true);
    assert.equal(f.document.activeElement, f.heading);
    f.key();
    await settle();
    f.button("Dismiss error").props.onClick();
    assert.equal(
      f.find((node) => node.props.role === "alert"),
      undefined,
    );
    assert.equal(f.document.activeElement, f.heading);
  }
});

for (const action of ["save", "reset"]) {
  for (const interruption of ["account", "clear", "unmount"]) {
    test(`shortcut ${action} import cannot mutate or publish after ${interruption}`, async () => {
      const f = shortcutFixture();
      await f.ready();
      if (action === "save") {
        f.record();
        f.key();
      } else f.button("Reset to defaults").props.onClick();
      if (interruption === "account") {
        f.props.userKey = "owner-b";
        f.render();
      }
      if (interruption === "clear") f.listeners.get("clear")({ owner: "owner-a" });
      if (interruption === "unmount") f.unmount();
      await settle();
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.notices, []);
    });
  }
}

test("shortcut async operation is synchronously latched against double activation", async () => {
  const f = shortcutFixture();
  await f.ready();
  const reset = f.button("Reset to defaults").props.onClick;
  reset();
  reset();
  await settle();
  assert.equal(f.calls.length, 1);
});

test("cancellation falls back to Archived chats when the review-error opener was removed", () => {
  const f = archiveFixture();
  const trigger = f.openDelete();
  f.content().props.onOpenAutoFocus({ preventDefault() {} });
  trigger.isConnected = false;
  f.confirmation().props.onOpenChange(false);
  f.content().props.onCloseAutoFocus({ preventDefault() {}, target: f.dialog });
  assert.equal(f.document.activeElement, f.heading);
});

test("stale delete open and confirm callbacks cannot focus or mutate a replacement account", async () => {
  const f = archiveFixture();
  f.openDelete();
  const autoFocus = f.content().props.onOpenAutoFocus;
  const confirm = f.button("Move to Trash").props.onClick;
  f.props.userKey = "owner-b";
  f.render();
  autoFocus({ preventDefault() {} });
  confirm();
  await settle();
  assert.deepEqual(f.focused, []);
  assert.deepEqual(f.calls, []);
});

test("shortcut loader failure stays named and an explicit reload recovers", async () => {
  const f = shortcutFixture();
  f.behavior.throwImport = true;
  await f.ready();
  assert.match(
    text(f.find((node) => node.props.role === "alert")),
    /Keyboard shortcuts could not be loaded/,
  );
  f.behavior.throwImport = false;
  f.button("Retry loading shortcuts").props.onClick();
  f.render();
  await f.ready();
  assert.equal(
    f.find((node) => node.props.role === "alert"),
    undefined,
  );
  assert.equal(f.row("new-chat").props.combo, "Mod+N");
});

test("shortcut module failures during an action remain named and safely retryable", async () => {
  const f = shortcutFixture();
  await f.ready();
  f.behavior.throwImport = true;
  f.button("Reset to defaults").props.onClick();
  await settle();
  assert.match(text(f.find((node) => node.props.role === "alert")), /reset keyboard shortcuts/);
  assert.deepEqual(f.calls, []);
  f.behavior.throwImport = false;
  f.button("Retry reset").props.onClick();
  await settle();
  assert.deepEqual(f.notices, [["Shortcuts reset"]]);
});

for (const option of [
  ...trashPolicy.TRASH_RETENTION_OPTIONS.filter((option) => option.value > 0),
  { label: "90 minutes", value: 90 * 60_000 },
]) {
  test(`archived Delete confirms ${option.label} and saves its scoped Trash copy before archive removal`, async () => {
    const f = archiveFixture();
    f.setTrash({ retentionMs: option.value, entries: [] });
    f.openDelete();
    assert.ok(
      text(f.find((node) => node.type === "AlertDialogDescription")).includes(option.label),
    );
    assert.deepEqual(f.calls, []);
    f.button("Move to Trash").props.onClick();
    await settle();
    assert.deepEqual(
      f.calls.map(([action]) => action),
      ["trash", "archive"],
    );
    assert.ok(f.calls.every(([, owner]) => owner === "owner-a"));
    const entry = f.readTrash().entries[0];
    assert.equal(entry.conversation.id, chat.id);
    assert.equal(entry.deletedAt, f.behavior.now);
    assert.equal(entry.expiresAt, f.behavior.now + option.value);
    assert.equal(f.stored.archived.length, 0);
    assert.equal(f.stored.active.length, 0);
    assert.equal(f.readTrash("owner-b").entries.length, 0);
    assert.deepEqual(f.notices, [["Chat moved to Trash"]]);
  });
}

test("default archived Delete has a 30-day recovery period; instant deletion explicitly warns and cancellation changes nothing", async () => {
  const normal = archiveFixture();
  normal.openDelete();
  assert.match(text(normal.render()), /One month \(30 days\)/);
  const f = archiveFixture();
  f.setTrash({ retentionMs: 0, entries: [] });
  f.openDelete();
  assert.match(
    text(f.find((node) => node.type === "AlertDialogTitle")),
    /Research notes.*permanently/,
  );
  assert.match(
    text(f.find((node) => node.type === "AlertDialogDescription")),
    /Instantly.*Research notes.*without a recoverable Trash copy.*cannot be undone/,
  );
  f.confirmation().props.onOpenChange(false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.stored.archived.length, 1);
  f.openDelete();
  f.button("Delete permanently").props.onClick();
  await settle();
  assert.deepEqual(
    f.calls.map(([action]) => action),
    ["archive"],
  );
  assert.equal(f.readTrash().entries.length, 0);
  assert.deepEqual(f.notices, [["Archived chat deleted"]]);
});

for (const fault of ["failTrashRead", "failTrashWrite", "canWrite"]) {
  test(`Trash ${fault} cannot remove an archived chat and an explicit retry recovers`, async () => {
    const f = archiveFixture();
    f.openDelete();
    f.behavior[fault] = fault !== "canWrite";
    f.button("Move to Trash").props.onClick();
    await settle();
    assert.equal(f.calls.filter(([action]) => action === "archive").length, 0);
    assert.equal(f.stored.archived.length, 1);
    assert.match(
      text(f.find((node) => node.props.role === "alert")),
      /Research notes.*archived copy.*available/,
    );
    assert.equal(f.document.activeElement, f.deleteHeading);
    f.behavior[fault] = fault === "canWrite";
    f.button("Retry delete").props.onClick();
    await settle();
    assert.equal(f.stored.archived.length, 0);
    assert.equal(f.readTrash().entries.length, 1);
  });
}

test("unreadable retention does not open an unsafe confirmation and supports a named review retry", () => {
  const f = archiveFixture();
  f.behavior.failTrashRead = true;
  f.openDelete();
  assert.equal(f.confirmation().props.open, false);
  assert.match(
    text(f.find((node) => node.props.role === "alert")),
    /Research notes.*Trash storage.*unchanged/,
  );
  assert.equal(f.document.activeElement, f.heading);
  f.behavior.failTrashRead = false;
  f.button("Review delete").props.onClick({ currentTarget: new f.Element("Review") });
  assert.equal(f.confirmation().props.open, true);
  assert.deepEqual(f.calls, []);
});

test("cleanup retry after a successful Trash transfer never rewrites the copy or resets its deadline", async () => {
  const f = archiveFixture();
  f.behavior.archived = async () => false;
  f.openDelete();
  f.button("Move to Trash").props.onClick();
  await settle();
  const entry = JSON.stringify(f.readTrash().entries[0]);
  f.behavior.now += 3_600_000;
  // Cleanup needs only the archive write, even if Trash cannot currently be read.
  f.behavior.failTrashRead = true;
  f.behavior.archived = async (_owner, rows) => {
    f.stored.archived = rows;
    return true;
  };
  f.button("Retry archive cleanup").props.onClick();
  await settle();
  f.behavior.failTrashRead = false;
  assert.equal(JSON.stringify(f.readTrash().entries[0]), entry);
  assert.equal(f.calls.filter(([action]) => action === "trash").length, 1);
  assert.equal(f.calls.filter(([action]) => action === "archive").length, 2);
  assert.equal(f.stored.archived.length, 0);
});

test("canceling a failed transfer cleanup and reviewing it again preserves the original Trash deadline", async () => {
  const f = archiveFixture();
  f.behavior.archived = async () => false;
  f.openDelete();
  f.button("Move to Trash").props.onClick();
  await settle();
  const original = JSON.stringify(f.readTrash().entries[0]);
  f.confirmation().props.onOpenChange(false);
  f.button("Dismiss error").props.onClick();
  f.behavior.now += 6 * 3_600_000;
  f.openDelete();
  assert.match(
    text(f.find((node) => node.type === "AlertDialogDescription")),
    /original deadline.*will not extend recovery time/,
  );
  f.behavior.archived = async (_owner, rows) => {
    f.stored.archived = rows;
    return true;
  };
  f.button("Move to Trash").props.onClick();
  await settle();
  assert.equal(JSON.stringify(f.readTrash().entries[0]), original);
  assert.equal(f.calls.filter(([action]) => action === "trash").length, 1);
  assert.equal(f.stored.archived.length, 0);
});

for (const retentionMs of [0, 3_600_000]) {
  test(`changed retention to ${retentionMs} while confirming requires a fresh review before any mutation`, async () => {
    const f = archiveFixture();
    f.openDelete();
    const stale = f.button("Move to Trash").props.onClick;
    f.setTrash({ retentionMs, entries: [] });
    stale();
    await settle();
    assert.deepEqual(f.calls, []);
    assert.match(
      text(f.find((node) => node.props.role === "alert")),
      /Trash retention changed.*Research notes/,
    );
    stale();
    await settle();
    assert.deepEqual(f.calls, []);
    f.button("Retry delete").props.onClick();
    await settle();
    assert.equal(f.stored.archived.length, 0);
    assert.equal(f.readTrash().entries.length, retentionMs === 0 ? 0 : 1);
  });
}

for (const interruption of ["account", "clear", "unmount"]) {
  test(`a Trash transfer interrupted by ${interruption} cannot continue archive removal or publish success`, async () => {
    const f = archiveFixture();
    f.behavior.afterTrashWrite = () => {
      if (interruption === "account") {
        f.props.userKey = "owner-b";
        f.render();
      }
      if (interruption === "clear") f.listeners.get("clear")({ owner: "owner-a" });
      if (interruption === "unmount") f.unmount();
    };
    f.openDelete();
    f.button("Move to Trash").props.onClick();
    await settle();
    assert.equal(f.calls.filter(([action]) => action === "archive").length, 0);
    assert.equal(f.stored.archived.length, 1);
    assert.deepEqual(f.notices, []);
    assert.equal(f.readTrash("owner-b").entries.length, 0);
  });
}
