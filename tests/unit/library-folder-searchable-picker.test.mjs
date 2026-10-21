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

// Source component and the real picker execute against explicit hook/service stubs.
// This checks state, filtering and operation identity, not browser/Radix rendering.
const folders = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `folder-${index}`,
    name: index < 2 ? "Same name" : `Folder ${index + 1}`,
    parentId: index === 2 ? "folder-0" : null,
    position: index,
  }));
const primitiveNames = (names) => Object.fromEntries(names.map((name) => [name, name]));
function fixture(count = 8) {
  const hooks = createHookHarness();
  const pickerHooks = createHookHarness();
  const lists = [],
    moves = [],
    callbacks = [],
    lifetimes = [];
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const window = { location: { href: "https://kova.test/library" } };
  const pickerModule = loadUiModule("src/components/ui/searchable-picker.tsx", {
    react: pickerHooks.react,
    "lucide-react": primitiveNames(["Check", "ChevronDown"]),
    "./command": primitiveNames([
      "Command",
      "CommandEmpty",
      "CommandInput",
      "CommandItem",
      "CommandList",
    ]),
    "./popover": primitiveNames(["Popover", "PopoverContent", "PopoverTrigger"]),
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  });
  const component = loadUiModule(
    "src/components/LibraryFolderOrganizer.tsx",
    {
      react: { ...hooks.react, useMemo: (fn, deps) => hooks.react.useCallback(fn(), deps) },
      "lucide-react": primitiveNames([
        "Folder",
        "FolderOpen",
        "FolderPlus",
        "Loader2",
        "Move",
        "Pencil",
        "RefreshCw",
        "Trash2",
      ]),
      sonner: { toast: { success: (message) => callbacks.push(["success", message]) } },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": primitiveNames([
        "Dialog",
        "DialogContent",
        "DialogDescription",
        "DialogTitle",
      ]),
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/searchable-picker": pickerModule,
      "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
      "@/lib/work-view-lifetime.mjs": {
        createWorkViewLifetime(owner, clear) {
          const controller = new AbortController();
          const life = {
            controller,
            dispose() {
              controller.abort();
            },
            clear() {
              controller.abort();
              clear();
            },
          };
          lifetimes.push(life);
          return life;
        },
      },
      "@/lib/library-folders": {
        listLibraryFolders(owner, signal) {
          const pending = deferred();
          lists.push({ ...pending, owner, signal });
          return pending.promise;
        },
        async moveLibraryItems(owner, input, signal) {
          moves.push({ owner, input, signal });
        },
      },
    },
    { document, window, AbortController, Error },
  ).LibraryFolderOrganizer;
  const props = {
    enabled: true,
    ownerId: "owner-a",
    principalKey: "user:a",
    refreshKey: 0,
    itemStateUnavailable: false,
    scope: "all",
    selectedItemIds: ["actual-item-id"],
    onScopeChange() {},
    onBusyChange() {},
    onRefresh() {},
    onFoldersDeleted() {},
    onMoved: (...args) => callbacks.push(["moved", ...args]),
  };
  const render = () => hooks.render(component, props);
  const picker = () => elements(render(), (node) => node.type === pickerModule.SearchablePicker)[0];
  const pickerTree = () => pickerHooks.render(pickerModule.SearchablePicker, picker().props);
  const command = () => {
    const list = elements(
      pickerTree(),
      (node) => node.type === pickerModule.SearchablePickerList,
    )[0];
    return pickerModule.SearchablePickerList(list.props);
  };
  const move = () =>
    elements(render(), (node) => node.type === "Button" && text(node).trim() === "Move")[0];
  render();
  return {
    props,
    render,
    picker,
    pickerTree,
    command,
    move,
    lists,
    moves,
    callbacks,
    lifetimes,
    unmount: () => hooks.unmount(),
    async ready(records = folders(count)) {
      lists.at(-1).resolve(records);
      await settle();
      render();
    },
  };
}

for (const count of [0, 7, 8]) {
  test(`${count} real folders preserves the seven-folder native/search threshold and Unfiled`, async () => {
    const f = fixture(count);
    await f.ready();
    assert.equal(f.picker().props.options.length, count);
    assert.equal(f.picker().props.placeholder, "Unfiled");
    assert.equal(f.picker().props.value, "");
    assert.equal(f.picker().props.disabled, false);
    const tree = f.pickerTree();
    assert.equal(tree.type, count > 7 ? "Popover" : "select");
    if (count <= 7) {
      assert.equal(elements(tree, (node) => node.type === "option").length, count + 1);
      assert.equal(elements(tree, (node) => node.type === "option")[0].props.value, "");
    }
  });
}

test("folder search matches complete paths, preserves duplicate names by ID, and has a no-match state", async () => {
  const f = fixture();
  await f.ready();
  const tree = f.command();
  assert.equal(tree.props.loop, true);
  const input = elements(tree, (node) => node.type === "CommandInput")[0];
  assert.equal(input.props["aria-label"], "Search folders");
  const choices = elements(tree, (node) => node.type === "CommandItem");
  assert.equal(choices.length, 9);
  assert.equal(choices[1].props.value, "option:folder-0");
  assert.equal(choices[2].props.value, "option:folder-1");
  assert.equal(choices[1].props.keywords[0], "Same name");
  assert.equal(choices[2].props.keywords[0], "Same name");
  assert.equal(choices[3].props.keywords[0], "Same name / Folder 3");
  assert.equal(
    tree.props.filter("option:folder-2", " SAME NAME / FOLDER 3 ", choices[3].props.keywords),
    1,
  );
  assert.equal(tree.props.filter("option:folder-2", "missing", choices[3].props.keywords), 0);
  assert.equal(
    text(elements(tree, (node) => node.type === "CommandEmpty")[0]),
    "No folders match your search.",
  );
  choices[2].props.onSelect();
  assert.equal(f.picker().props.value, "folder-1");
  const updated = elements(f.command(), (node) => node.type === "CommandItem");
  assert.equal(elements(updated[2], (node) => node.type === "Check").length, 1);
  assert.equal(elements(updated[1], (node) => node.type === "Check").length, 0);
  f.move().props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(f.moves.length, 1);
  assert.equal(f.moves[0].owner, "owner-a");
  assert.deepEqual(JSON.parse(JSON.stringify(f.moves[0].input)), {
    itemIds: ["actual-item-id"],
    folderId: "folder-1",
  });
  assert.equal(f.moves[0].signal, f.lifetimes[0].controller.signal);
});

test("Unfiled remains a working destination when no custom folders exist", async () => {
  const f = fixture(0);
  await f.ready();
  f.picker().props.onValueChange("missing-folder");
  assert.equal(f.picker().props.value, "");
  f.move().props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(f.moves[0].input.folderId, null);
  assert.deepEqual(f.moves[0].input.itemIds, ["actual-item-id"]);
});

for (const reason of ["loading", "failed", "items-unavailable", "moving"]) {
  test(`the ${reason} picker cannot change destination or start another move`, async () => {
    const f = fixture();
    if (reason === "failed") {
      f.lists[0].reject(new Error("Folders unavailable"));
      await settle();
    }
    if (["items-unavailable", "moving"].includes(reason)) await f.ready();
    if (reason === "items-unavailable") f.props.itemStateUnavailable = true;
    if (reason === "moving") f.move().props.onClick({ currentTarget: {} });
    const priorMoves = f.moves.length;
    assert.equal(f.picker().props.disabled, true);
    f.picker().props.onValueChange("folder-1");
    assert.equal(f.picker().props.value, "");
    f.move().props.onClick({ currentTarget: {} });
    assert.equal(f.moves.length, priorMoves);
  });
}

for (const interruption of ["account", "refresh", "disabled", "clear", "unmount"]) {
  test(`retained folder choice and move callbacks are inert after ${interruption}`, async () => {
    const f = fixture();
    await f.ready();
    f.picker().props.onValueChange("folder-2");
    const choose = f.picker().props.onValueChange;
    const move = f.move().props.onClick;
    if (interruption === "account") {
      f.props.ownerId = "owner-b";
      f.props.principalKey = "user:b";
    }
    if (interruption === "refresh") f.props.refreshKey++;
    if (interruption === "disabled") f.props.enabled = false;
    if (interruption === "clear") f.lifetimes[0].clear();
    if (interruption === "unmount") f.unmount();
    else f.render();
    choose("folder-1");
    move({ currentTarget: {} });
    assert.equal(f.moves.length, 0);
    if (interruption === "account" || interruption === "refresh") {
      await f.ready(folders(8));
      assert.equal(f.picker().props.value, "");
      choose("folder-1");
      move({ currentTarget: {} });
      assert.equal(f.picker().props.value, "");
      assert.equal(f.moves.length, 0);
    }
  });
}
