import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const topbar = read("src/components/MobileTopBar.tsx");
const sidebar = read("src/components/Sidebar.tsx");
function menuCallback(path) {
  const file = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "onOpenSidebar")
      callback = node.initializer.expression.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(callback);
  return ts.transpileModule(`return (${callback});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

test("chat and shared-shell Open menu callbacks open the sidebar across tablet boundaries", () => {
  assert.match(topbar, /onClick=\{onOpenSidebar\}\s*aria-label="Open menu"/);
  for (const path of ["src/routes/index.tsx", "src/components/AppShell.tsx"]) {
    const callback = menuCallback(path);
    for (const width of [375, 767, 768, 769, 820, 1023]) {
      for (const controllerPresent of [false, true]) {
        let open = false;
        const events = [];
        const readingAnchorControllerRef = {
          current: controllerPresent ? { capture: () => events.push("capture") } : null,
        };
        const onOpen = new Function(
          "setSidebarOpen",
          "window",
          "readingAnchorControllerRef",
          callback,
        )(
          (next) => {
            events.push("open");
            open = typeof next === "function" ? next(open) : next;
          },
          { innerWidth: width },
          readingAnchorControllerRef,
        );
        const expected =
          path === "src/routes/index.tsx" && controllerPresent ? ["capture", "open"] : ["open"];
        onOpen();
        assert.equal(open, true, `${path} must open at ${width}px`);
        assert.deepEqual(
          events,
          expected,
          "Chat captures before reflow; absent controller is safe",
        );
        events.length = 0;
        onOpen();
        assert.equal(open, true, "repeated Open menu action must not toggle the sidebar closed");
        assert.deepEqual(events, expected, "Every activation preserves capture-before-open order");
      }
    }
  }
});

test("mobile menu, sidebar geometry, and modal behavior share the 1024px desktop boundary", () => {
  assert.match(topbar, /<header[\s\S]*?className="[^"]*lg:hidden"/);
  assert.match(sidebar, /matchMedia\("\(max-width: 1023px\)"\)/);
  const geometry = read("src/styles/sidebar-core.css");
  assert.match(geometry, /@media \(max-width: 1023px\)/);
  assert.match(geometry, /position: fixed;/);
  assert.match(geometry, /transform: translateX\(-100%\)/);
  assert.doesNotMatch(sidebar, /max-md:|md:!w-0|max-width: 767px/);
});

function workspaceSearchCallback(deps) {
  const file = ts.createSourceFile(
    "Sidebar.tsx",
    sidebar,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let search;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "openChatSearch")
      search = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(search, "Compile the actual shared Search handler");
  assert.match(sidebar, /onClick=\{openChatSearch\}/);
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(`return (${search});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(deps));
}

for (const [width, mobileViewport, open] of [
  [390, false, true],
  [412, false, true],
  [1023, false, true],
  [1024, true, true],
  [1440, false, true],
  [390, false, false],
]) {
  test(`chat Search opens one dialog at ${width}px with stale mobile=${mobileViewport}, open=${open}`, () => {
    const events = [];
    const toggle = () => events.push("close");
    const activate = workspaceSearchCallback({
      window: {
        matchMedia: (query) => {
          assert.equal(query, "(max-width: 1023px)");
          return { matches: width < 1024 };
        },
      },
      mobileViewport,
      open,
      onToggle: toggle,
      swipeToggleRef: { current: toggle },
      cancelPendingSelection: () => events.push("cancel-pending-selection"),
      onOpenWorkspaceSearch: () => events.push("workspace-search"),
      setSearchOpen: (update) => events.push(update(false) ? "chat-dialog-open" : "chat-dialog-close"),
    });
    activate();
    assert.deepEqual(
      events,
      ["cancel-pending-selection", "chat-dialog-open"],
      "Search preserves the chosen sidebar state at every breakpoint",
    );
  });
}
