import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/library.tsx", "utf8");
const component = readFileSync("src/components/ConfirmActionDialog.tsx", "utf8");
const helper = readFileSync("src/lib/library-delete-confirmation.ts", "utf8");
const parsed = ts.createSourceFile(
  "library.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
function compile(code, dependencies = {}) {
  const javascript = ts
    .transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/^export /gm, "");
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}
const summary = compile(`${helper}; return libraryDeleteConfirmation;`);
const variable = (name) =>
  nodes
    .find((node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name)
    .initializer.getText(parsed);
const handler = (name, marker) => {
  const matching = nodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(marker),
  );
  assert.equal(matching.length, 1, `${name}: ${marker}`);
  return matching[0].initializer.expression.getText(parsed);
};
const chat = { id: "chat:one", title: "Composer review chat", item_type: "chat_artifact" };
const file = {
  id: "file:one",
  title: "Roadmap.pdf",
  file_name: "Roadmap.pdf",
  item_type: "upload",
};
const work = { id: "work:one", title: "Review launch", item_type: "other" };
const month = 30 * 86_400_000;

test("single chat names the selected chat and its recoverable retention without file-deletion copy", () => {
  const result = summary([chat], month);
  assert.equal(result.title, "Move “Composer review chat” to Trash?");
  assert.equal(result.confirmLabel, "Move to Trash");
  assert.match(result.description, /restored for 30 days, your current retention setting/);
  assert.doesNotMatch(result.description, /permanently|file|saved item/i);
});

test("retention describes configured presets and custom durations precisely", () => {
  for (const [milliseconds, label] of [
    [3_600_000, "1 hour"],
    [86_400_000, "1 day"],
    [7 * 86_400_000, "7 days"],
    [90_000, "90 seconds"],
    [15 * 60_000, "15 minutes"],
  ]) {
    assert.ok(summary([chat], milliseconds).description.includes(`restored for ${label},`));
  }
});

test("Instantly and temporary chats retain their separate permanent confirmation", () => {
  const instant = summary([chat], 0);
  assert.equal(instant.title, "Delete “Composer review chat”?");
  assert.equal(instant.confirmLabel, "Continue");
  assert.match(instant.description, /set to Instantly/);
  assert.match(instant.description, /after a separate confirmation and cannot be restored/);
  const temporary = summary([{ ...chat, temporary: true }], month);
  assert.match(temporary.description, /Temporary chats do not go to Trash/);
  assert.match(temporary.description, /after a separate confirmation/);
  assert.doesNotMatch(temporary.description, /30 days/);
});

test("single Library file and saved Work item describe only permanent consequences", () => {
  const result = summary([file], null);
  assert.equal(result.title, "Delete “Roadmap.pdf” permanently?");
  assert.equal(result.confirmLabel, "Delete permanently");
  assert.match(result.description, /^This Library file will be permanently deleted/);
  assert.match(result.description, /not go to Trash and cannot be restored/);
  assert.doesNotMatch(result.description, /chat|retention/i);
  assert.match(summary([work], null).description, /^This saved Work item/);
});

test("bulk mixed deletion names targets and counts recoverable chats and permanent content separately", () => {
  const result = summary([chat, file, work], month);
  assert.equal(result.title, "Delete 3 Library items?");
  for (const title of [chat.title, file.title, work.title])
    assert.ok(result.description.includes(`“${title}”`));
  assert.match(result.description, /1 chat will move to Trash/);
  assert.match(
    result.description,
    /1 Library file and 1 saved item will be permanently deleted when you continue/,
  );
  assert.equal(result.confirmLabel, "Delete selected items");
  const many = summary([chat, file, work, { id: "other", title: "Fourth" }], month);
  assert.match(many.description, /and 1 more\./);
  assert.match(many.description, /1 Library file and 2 saved items/);
  const chats = summary([chat, { ...chat, id: "chat:two", title: "Second chat" }], month);
  assert.equal(chats.title, "Move 2 chats to Trash?");
  assert.match(chats.description, /2 chats will move to Trash/);
});

function fixture() {
  const calls = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.hidden = false;
      this.disabled = false;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return null;
    }
    matches() {
      return this.disabled;
    }
    contains(other) {
      return this === other;
    }
    focus() {
      calls.push(["focus", this.name]);
    }
  }
  const trigger = new Element("Actions for Composer review chat");
  const search = new Element("Search Library");
  const root = new Element("Library");
  const document = { body: new Element("body"), activeElement: null };
  document.activeElement = document.body;
  const window = { location: { href: "https://local.invalid/library" } };
  const deps = {
    principal: "user:a",
    principalRef: { current: "user:a" },
    userKey: "a",
    principalReady: true,
    folderBusy: false,
    bulkDeleteBusy: false,
    libraryCleared: false,
    lifecycleGenerationRef: { current: 7 },
    deleteReturnFocusRef: { current: null },
    confirmedDeleteRef: { current: null },
    deleteActionButtonsRef: { current: new Map([[chat.id, trigger]]) },
    deleteMenuHandoffRef: { current: new Set() },
    versionMenuHandoffRef: { current: new Set() },
    renameMenuHandoffRef: { current: new Set() },
    librarySearchRef: { current: search },
    libraryRootRef: { current: root },
    window,
    document,
    HTMLElement: Element,
    items: [chat, file, work],
    selected: [chat.id],
    loadConversations: () => [{ id: "one", title: chat.title }],
    readChatTrash: () => ({ retentionMs: month }),
    toast: { error: (message) => calls.push(["error", message]) },
    setPendingDelete(value) {
      deps.visiblePendingDelete = value;
    },
    setDeleteDialogOpen(value) {
      calls.push(["open", value]);
    },
    remove: (...args) => calls.push(["remove", ...args]),
    deleteSelected: (...args) => calls.push(["deleteSelected", ...args]),
  };
  deps.restoreDialogFocus = compile(
    `${readFileSync("src/lib/dialog-return-focus.ts", "utf8")}; return restoreDialogFocus;`,
    { window },
  );
  return {
    deps,
    calls,
    trigger,
    search,
    root,
    begin(kind = "one", targets = [chat], from = trigger) {
      compile(`return (${variable("beginLibraryDelete")});`, deps)(kind, targets, from);
    },
    confirm() {
      compile(`return (${handler("onConfirm", "const pending = visiblePendingDelete")});`, deps)();
    },
    close() {
      compile(
        `return (${handler("onCloseAutoFocus", "let confirmed = confirmedDeleteRef.current")});`,
        deps,
      )({
        target: new Element("closing-dialog"),
        preventDefault: () => calls.push(["prevent"]),
      });
    },
    menuClose() {
      compile(`return (${handler("onCloseAutoFocus", "deleteMenuHandoffRef")});`, {
        ...deps,
        item: chat,
      })({ preventDefault: () => calls.push(["prevent-menu"]) });
    },
  };
}

test("opening captures the original owner, generation, target title, and live retention without deleting", () => {
  const f = fixture();
  f.begin();
  assert.deepEqual(f.deps.visiblePendingDelete, {
    kind: "one",
    items: [{ ...chat, temporary: false }],
    principal: "user:a",
    generation: 7,
    retentionMs: month,
  });
  assert.equal(f.deps.deleteReturnFocusRef.current.trigger, f.trigger);
  assert.deepEqual(f.calls, [["open", true]]);
});

test("Cancel and Escape close paths preserve data and restore the exact source Actions", () => {
  for (const dismissal of ["Cancel", "Escape"]) {
    const f = fixture();
    f.begin();
    f.menuClose();
    f.close();
    assert.deepEqual(
      f.calls,
      [["open", true], ["prevent-menu"], ["prevent"], ["focus", f.trigger.name]],
      dismissal,
    );
    assert.equal(f.deps.deleteReturnFocusRef.current, null);
    assert.equal(f.deps.visiblePendingDelete, null);
  }
});

test("menu close focus is consumed once and cannot race a fast dialog cancellation", () => {
  const f = fixture();
  f.begin();
  f.close();
  f.menuClose();
  f.menuClose();
  assert.equal(f.calls.filter(([type]) => type === "prevent-menu").length, 1);
  assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
  const ordinary = fixture();
  ordinary.menuClose();
  assert.deepEqual(ordinary.calls, []);
});

test("hidden, removed, or disabled invokers use Search Library, then the stable Library root", () => {
  for (const change of ["detached", "hidden", "disabled", "no-search"]) {
    const f = fixture();
    f.begin();
    if (change === "hidden") f.trigger.hidden = true;
    else if (change === "disabled") f.trigger.disabled = true;
    else f.trigger.isConnected = false;
    if (change === "no-search") f.deps.librarySearchRef.current = null;
    f.close();
    assert.deepEqual(f.calls.at(-1), [
      "focus",
      change === "no-search" ? "Library" : "Search Library",
    ]);
  }
});

test("confirming defers execution until dialog close and restores a stable control before row deletion", () => {
  const f = fixture();
  f.begin();
  f.confirm();
  assert.deepEqual(f.calls, [["open", true]]);
  f.close();
  assert.deepEqual(f.calls.slice(-2), [
    ["focus", "Search Library"],
    ["remove", chat.id, true],
  ]);
  assert.equal(f.deps.confirmedDeleteRef.current, null);
});

test("bulk execution uses the confirmed snapshot rather than a later selection", () => {
  const f = fixture();
  f.begin("many", [chat, file]);
  f.deps.selected = [work.id];
  f.confirm();
  f.close();
  assert.deepEqual(f.calls.at(-1), ["deleteSelected", true, [chat.id, file.id]]);
  const body = variable("deleteSelected");
  assert.match(body, /ids = selected/);
  assert.doesNotMatch(body, /selected\.(?:filter|includes)/);
});

test("a retention change during the closing animation cancels execution and restores Actions", () => {
  const f = fixture();
  f.begin();
  f.confirm();
  f.deps.readChatTrash = () => ({ retentionMs: 60_000 });
  f.close();
  assert.equal(
    f.calls.some(([type]) => type === "remove"),
    false,
  );
  assert.deepEqual(f.calls.at(-1), ["focus", f.trigger.name]);
});

test("changed retention, missing target, unreadable Trash or busy state cannot authorize deletion", () => {
  for (const change of ["retention", "missing", "corrupt", "busy", "not-ready"]) {
    const f = fixture();
    f.begin();
    if (change === "retention") f.deps.readChatTrash = () => ({ retentionMs: 0 });
    if (change === "missing") f.deps.items = [];
    if (change === "corrupt")
      f.deps.readChatTrash = () => {
        throw new Error("Corrupt");
      };
    if (change === "busy") f.deps.folderBusy = true;
    if (change === "not-ready") f.deps.principalReady = false;
    f.confirm();
    assert.equal(f.deps.confirmedDeleteRef.current, null, change);
    f.close();
    assert.equal(
      f.calls.some(([type]) => type === "remove" || type === "deleteSelected"),
      false,
    );
  }
});

test("account, reset, route and browser-clear changes block both stale focus and deletion", () => {
  for (const change of ["account", "generation", "route", "cleared"]) {
    const f = fixture();
    f.begin();
    f.confirm();
    if (change === "account") f.deps.principalRef.current = "user:b";
    if (change === "generation") f.deps.lifecycleGenerationRef.current++;
    if (change === "route") f.deps.window.location.href += "?item=other";
    if (change === "cleared") f.deps.libraryCleared = true;
    f.close();
    assert.deepEqual(f.calls, [["open", true], ["prevent"]], change);
  }
});

test("subsequent user focus is never stolen by the closing dialog", () => {
  const f = fixture();
  f.begin();
  f.deps.document.activeElement = f.search;
  f.close();
  assert.equal(
    f.calls.some(([type]) => type === "focus"),
    false,
  );
});

test("unreadable chat retention fails closed while file-only deletion needs no Trash read", () => {
  const f = fixture();
  f.deps.readChatTrash = () => {
    throw new Error("Corrupt");
  };
  f.begin();
  assert.equal(f.deps.visiblePendingDelete, undefined);
  assert.equal(f.calls.at(-1)[0], "error");
  f.begin("one", [file]);
  assert.equal(f.deps.visiblePendingDelete.retentionMs, null);
  assert.equal(f.deps.visiblePendingDelete.items[0].id, file.id);
});

test("shared dialog forwards only the optional close-focus hook and deletion APIs stay in place", () => {
  assert.match(component, /onCloseAutoFocus\?: \(event: Event\) => void/);
  assert.match(component, /onCloseAutoFocus=\{onCloseAutoFocus\}/);
  assert.match(source, /moveChatToTrash\(userKey, chat, chats, isCurrent\)/);
  assert.match(source, /expectedOwnerId: userKey \?\? undefined/);
  assert.match(source, /contentGeneration: existing\.find/);
  assert.doesNotMatch(source, /Remove selected Library content\?/);
});
