import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/library.tsx", "utf8");
const primitive = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");
const parsed = ts.createSourceFile(
  "library.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let renderActions;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "renderActions")
    renderActions = node.initializer.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);

function fixture({ favorite = false, folderBusy = false } = {}) {
  const calls = [];
  const dependencies = {
    React: {
      Fragment: "Fragment",
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    },
    ...Object.fromEntries(
      [
        "DropdownMenu",
        "DropdownMenuTrigger",
        "DropdownMenuContent",
        "DropdownMenuItem",
        "DropdownMenuSeparator",
        "MoreHorizontal",
        "Eye",
        "LinkIcon",
        "MessageSquarePlus",
        "Download",
        "Pencil",
        "Star",
        "Trash2",
        "WorkOutputDownloadAction",
        "LibraryImageDownloadAction",
      ].map((name) => [name, name]),
    ),
    withItem: async (item, action) => action(item),
    toHandoff: (item) => ({ id: item.id }),
    ...Object.fromEntries(
      [
        "openItemPreview",
        "copyItemLink",
        "reuseInChat",
        "openInWork",
        "continueInChat",
        "addToContextPack",
        "setVersionItem",
        "openRenameItem",
        "toggleFavorite",
        "remove",
      ].map((name) => [name, (...args) => calls.push([name, ...args])]),
    ),
    userKey: "user:a",
    isSignedIn: true,
    libraryItemDetailPath: () => "/library?item=fixture",
    principal: "user:a",
    principalReady: true,
    libraryCleared: false,
    lifecycleGenerationRef: { current: 1 },
    deleteActionButtonsRef: { current: new Map() },
    versionMenuHandoffRef: { current: new Set() },
    renameMenuHandoffRef: { current: new Set() },
    versionReturnFocusRef: { current: null },
    window: { location: { href: "https://kova.test/library" } },
    visibleFavorites: new Set(favorite ? ["release-notes"] : []),
    folderBusy,
    bulkDeleteBusy: false,
    isImageItem: () => false,
    safeNavigationUrl: () => null,
  };
  const javascript = ts.transpileModule(`return (${renderActions});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const render = new Function(...Object.keys(dependencies), javascript)(
    ...Object.values(dependencies),
  );
  const item = { id: "release-notes", title: "Release notes", content_generation: 1 };
  const menu = render(item);
  const elements = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    elements.push(node);
    node.children?.forEach(walk);
  }
  walk(menu);
  const content = elements.find((node) => node.type === "DropdownMenuContent");
  const rows = elements.filter((node) => node.type === "DropdownMenuItem");
  const row = (label) =>
    rows.find(
      (node) =>
        node.children
          .filter((child) => typeof child === "string")
          .join("")
          .trim() === label,
    );
  return { calls, content, row, item };
}

test("Library actions share one icon gutter and 44px minimum row height", () => {
  const { content } = fixture();
  const classes = content.props.className.split(/\s+/);
  for (const expected of [
    "[&_[role=menuitem]]:min-h-11",
    "[&_[role=menuitem]]:pl-8",
    "[&_[role=menuitem]>svg]:absolute",
    "[&_[role=menuitem]>svg]:left-2",
    "[&_[role=menuitem]>svg]:top-1/2",
    "[&_[role=menuitem]>svg]:-translate-y-1/2",
    "[&_[role=menuitem]>svg]:mr-0",
  ]) {
    assert.ok(classes.includes(expected), `Missing shared gutter rule: ${expected}`);
  }
});

test("Library action labels get a wider menu while retaining the phone viewport clamp", () => {
  const { content } = fixture();
  assert.equal(content.props.align, "end");
  assert.ok(content.props.className.split(/\s+/).includes("w-64"));
  assert.doesNotMatch(content.props.className, /whitespace-nowrap|max-w-none|min-w-64/);
  assert.match(primitive, /collisionPadding = 8/);
  assert.ok(
    primitive.includes(
      "max-w-[min(var(--radix-dropdown-menu-content-available-width,100vw),calc(100vw-1rem))]",
    ),
  );
});

test("aligned Library actions retain their callbacks and favorite/delete states", () => {
  const { row, calls, item } = fixture({ favorite: true, folderBusy: true });
  for (const label of [
    "Preview",
    "Copy link",
    "Reuse in chat",
    "Open in Work",
    "Ask Kova",
    "Add to Context Pack",
    "Versions and replacement",
    "Unfavorite",
  ]) {
    assert.ok(row(label), `Missing action: ${label}`);
    row(label).props.onClick({ currentTarget: {} });
  }
  assert.deepEqual(calls, [
    ["openItemPreview", item],
    ["copyItemLink", item],
    ["reuseInChat", item],
    ["openInWork", { id: item.id }, "user:a"],
    ["continueInChat", { id: item.id }, "user:a"],
    ["addToContextPack", { id: item.id }, "user:a"],
    ["setVersionItem", item],
    ["toggleFavorite", item.id],
  ]);
  assert.equal(row("Delete").props.disabled, true);
  const ready = fixture();
  assert.ok(ready.row("Favorite"));
  assert.equal(ready.row("Delete").props.disabled, false);
  ready.row("Delete").props.onClick();
  assert.deepEqual(ready.calls, [["remove", item.id]]);
});
