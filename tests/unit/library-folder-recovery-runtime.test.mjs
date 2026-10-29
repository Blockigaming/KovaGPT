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
import { createWorkViewLifetime } from "../../src/lib/work-view-lifetime.mjs";
import { PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT } from "../../src/lib/principal-browser-storage.mjs";

const folder = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Research",
  parentId: null,
  position: 0,
};
const second = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Other",
  parentId: null,
  position: 1,
};
function fixture() {
  const hooks = createHookHarness();
  const calls = [],
    focused = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
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
    contains(target) {
      return target === this.child;
    }
    focus() {
      focused.push(this.name);
      document.activeElement = this;
    }
  }
  const listeners = new Map();
  const window = {
    location: { href: "https://kova.test/library" },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  const document = { body: new Element("body"), activeElement: null };
  document.activeElement = document.body;
  const api = {
    async listLibraryFolders(owner, signal) {
      calls.push(["list", owner, signal]);
      return [folder, second];
    },
    async createLibraryFolder(owner, input, signal) {
      calls.push(["create", owner, input, signal]);
      return { ...folder, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: input.name };
    },
    async renameLibraryFolder(owner, input, signal) {
      calls.push(["rename", owner, input, signal]);
      return { ...folder, name: input.name };
    },
    async deleteLibraryFolder(owner, id, signal) {
      calls.push(["delete", owner, id, signal]);
      return { deletedFolderCount: 1, movedToRootCount: 1 };
    },
    async moveLibraryItems(owner, input, signal) {
      calls.push(["move", owner, input, signal]);
      return { movedCount: input.itemIds.length, folderId: input.folderId };
    },
  };
  const component = loadUiModule(
    "src/components/LibraryFolderOrganizer.tsx",
    {
      react: { ...hooks.react, useMemo: (fn, deps) => hooks.react.useCallback(fn(), deps) },
      "lucide-react": Object.fromEntries(
        [
          "Folder",
          "FolderOpen",
          "FolderPlus",
          "Loader2",
          "Move",
          "Pencil",
          "RefreshCw",
          "Trash2",
        ].map((name) => [name, name]),
      ),
      sonner: { toast: { success: (message) => calls.push(["success", message]) } },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": {
        Dialog: "Dialog",
        DialogContent: "DialogContent",
        DialogDescription: "DialogDescription",
        DialogTitle: "DialogTitle",
      },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
      "@/lib/work-view-lifetime.mjs": {
        createWorkViewLifetime: (owner, clear) => createWorkViewLifetime(owner, clear, window),
      },
      "@/lib/library-folders": Object.fromEntries(
        Object.keys(api).map((name) => [name, (...args) => api[name](...args)]),
      ),
    },
    { window, document, HTMLElement: Element, AbortController, Error },
  ).LibraryFolderOrganizer;
  const props = {
    enabled: true,
    principalKey: "user:A",
    ownerId: "A",
    refreshKey: 0,
    itemStateUnavailable: false,
    scope: folder.id,
    selectedItemIds: ["item-one"],
    onScopeChange(value) {
      calls.push(["scope", value]);
      props.scope = value;
    },
    onBusyChange(value) {
      calls.push(["busy", value]);
    },
    onRefresh() {
      calls.push(["refresh"]);
    },
    onMoved(...args) {
      calls.push(["moved", ...args]);
    },
    onFoldersDeleted(...args) {
      calls.push(["deleted", ...args]);
    },
  };
  let tree;
  const allItems = new Element("All items"),
    trigger = new Element("Delete Research");
  function render() {
    tree = hooks.render(component, props);
    const all = elements(
      tree,
      (node) => node.type === "Button" && text(node).trim() === "All items",
    )[0];
    if (all?.props.ref) all.props.ref.current = allItems;
    return tree;
  }
  const find = (type, label) =>
    elements(
      tree,
      (node) => node.type === type && (label === undefined || text(node).trim() === label),
    )[0];
  function openDelete() {
    find("Button", "Delete").props.onClick({ currentTarget: trigger });
    render();
    return find("ConfirmActionDialog");
  }
  render();
  return {
    calls,
    focused,
    props,
    api,
    document,
    window,
    Element,
    trigger,
    allItems,
    render,
    find,
    openDelete,
    unmount: () => hooks.unmount(),
    reset: (owner = "A") =>
      listeners.get(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT)?.({
        detail: { principal: `user:${owner}` },
      }),
    async ready() {
      await settle();
      render();
    },
  };
}

test("folder Delete names its captured target and cancellation preserves data and restores exact invoker", async () => {
  const f = fixture();
  await f.ready();
  const dialog = f.openDelete();
  assert.equal(dialog.props.title, "Delete “Research” folder?");
  dialog.props.onOpenChange(false);
  f.render();
  f.find("ConfirmActionDialog").props.onCloseAutoFocus({
    preventDefault() {},
    target: new f.Element("dialog"),
  });
  assert.deepEqual(f.focused, ["Delete Research"]);
  assert.ok(!f.calls.some(([kind]) => kind === "delete"));
});
test("folder confirmation deletes the captured folder even when visible scope changes, and success returns focus to All items", async () => {
  const f = fixture();
  await f.ready();
  f.openDelete();
  f.props.scope = second.id;
  f.render();
  const dialog = f.find("ConfirmActionDialog");
  assert.equal(dialog.props.title, "Delete “Research” folder?");
  dialog.props.onConfirm();
  dialog.props.onOpenChange(false);
  await settle();
  f.render();
  f.find("ConfirmActionDialog").props.onCloseAutoFocus({
    preventDefault() {},
    target: new f.Element("dialog"),
  });
  assert.equal(f.calls.find(([kind]) => kind === "delete")[2], folder.id);
  assert.deepEqual(f.focused, ["All items"]);
  assert.ok(f.calls.some(([kind]) => kind === "deleted"));
});
test("folder deletion error keeps folders and has explicit feedback with safe close focus", async () => {
  const f = fixture();
  await f.ready();
  f.api.deleteLibraryFolder = async () => {
    throw Error("Folder service unavailable");
  };
  const dialog = f.openDelete();
  dialog.props.onConfirm();
  dialog.props.onOpenChange(false);
  await settle();
  f.render();
  assert.match(text(f.render()), /Folder service unavailable/);
  assert.ok(f.find("Button", "Research"));
  assert.ok(!f.calls.some(([kind]) => kind === "deleted" || kind === "success"));
  f.find("ConfirmActionDialog").props.onCloseAutoFocus({
    preventDefault() {},
    target: new f.Element("dialog"),
  });
  assert.deepEqual(f.focused, ["All items"]);
});
for (const change of ["later-focus", "navigation", "account", "refresh", "reset", "unmount"])
  test(`folder close does not steal focus after ${change}`, async () => {
    const f = fixture();
    await f.ready();
    const dialog = f.openDelete();
    if (change === "later-focus") f.document.activeElement = new f.Element("later");
    if (change === "navigation") f.window.location.href += "?other";
    if (change === "account") {
      f.props.principalKey = "user:B";
      f.props.ownerId = "B";
      f.props.scope = "all";
      f.render();
    }
    if (change === "refresh") {
      f.props.refreshKey++;
      f.render();
    }
    if (change === "reset") f.reset();
    if (change === "unmount") f.unmount();
    dialog.props.onCloseAutoFocus({ preventDefault() {}, target: new f.Element("dialog") });
    assert.deepEqual(f.focused, []);
  });
for (const operation of ["create", "rename", "delete", "move"])
  for (const interruption of ["account", "refresh", "reset", "unmount"])
    test(`${operation} lifetime aborts and rejects late completion after ${interruption}`, async () => {
      const f = fixture();
      await f.ready();
      const pending = deferred();
      let signal;
      const method = {
        create: "createLibraryFolder",
        rename: "renameLibraryFolder",
        delete: "deleteLibraryFolder",
        move: "moveLibraryItems",
      }[operation];
      f.api[method] = async (owner, input, requestSignal) => {
        assert.equal(owner, "A");
        signal = requestSignal;
        return pending.promise;
      };
      if (operation === "delete") f.openDelete().props.onConfirm();
      else if (operation === "move")
        f.find("Button", "Move").props.onClick({ currentTarget: new f.Element("Move") });
      else {
        f.find("Button", operation === "create" ? "New subfolder" : "Rename").props.onClick({
          currentTarget: new f.Element(operation),
        });
        f.render();
        f.find("Input").props.onChange({ target: { value: "Renamed" } });
        f.render();
        f.find("form").props.onSubmit({ preventDefault() {} });
      }
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      if (interruption === "account") {
        f.props.ownerId = "B";
        f.props.principalKey = "user:B";
        f.props.scope = "all";
        f.render();
      }
      if (interruption === "refresh") {
        f.props.refreshKey++;
        f.render();
      }
      if (interruption === "reset") f.reset();
      if (interruption === "unmount") f.unmount();
      assert.equal(signal.aborted, true);
      f.calls.length = 0;
      pending.resolve(
        operation === "delete"
          ? { deletedFolderCount: 1, movedToRootCount: 1 }
          : operation === "move"
            ? { movedCount: 1, folderId: null }
            : { ...folder, name: "Renamed" },
      );
      await settle();
      assert.ok(
        !f.calls.some(([kind]) => ["success", "scope", "moved", "deleted"].includes(kind)),
        JSON.stringify(f.calls),
      );
    });
test("Move reports only the IDs captured by that request despite later selection changes", async () => {
  const f = fixture();
  await f.ready();
  const pending = deferred();
  let captured;
  f.api.moveLibraryItems = async (owner, input) => {
    captured = input;
    return pending.promise;
  };
  f.find("Button", "Move").props.onClick({ currentTarget: new f.Element("Move") });
  f.props.selectedItemIds = ["later-item"];
  f.render();
  pending.resolve({ movedCount: 1, folderId: null });
  await settle();
  assert.deepEqual(captured.itemIds, ["item-one"]);
  assert.deepEqual(
    f.calls.find(([kind]) => kind === "moved"),
    ["moved", ["item-one"], null],
  );
});

test("another owner's browser-clear event does not abort a current folder request", async () => {
  const f = fixture();
  await f.ready();
  const pending = deferred();
  let signal;
  f.api.moveLibraryItems = async (owner, input, requestSignal) => {
    signal = requestSignal;
    return pending.promise;
  };
  f.find("Button", "Move").props.onClick({ currentTarget: new f.Element("Move") });
  f.reset("B");
  assert.equal(signal.aborted, false);
  pending.resolve({ movedCount: 1, folderId: null });
  await settle();
  assert.ok(f.calls.some(([kind]) => kind === "moved"));
});
