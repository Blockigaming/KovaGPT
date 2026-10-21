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
  assert.match(topbar, /<header className="[^"]*lg:hidden"/);
  assert.match(sidebar, /matchMedia\("\(max-width: 1023px\)"\)/);
  assert.match(sidebar, /max-lg:fixed max-lg:inset-y-0 max-lg:left-0/);
  assert.match(sidebar, /open \? "max-lg:translate-x-0" : "max-lg:-translate-x-full"/);
  assert.doesNotMatch(sidebar, /max-md:|md:!w-0|max-width: 767px/);
});
