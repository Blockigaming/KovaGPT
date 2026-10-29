import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const library = readFileSync("src/routes/library.tsx", "utf8");
test("Library single and bulk chat removal reuse recoverable Trash", () => {
  assert.equal(
    (library.match(/await moveChatToTrash\(userKey, chat, chats, isCurrent\)/g) || []).length,
    2,
  );
  assert.doesNotMatch(library, /saveConversations/);
  assert.match(library, /libraryDeleteConfirmation\(/);
  assert.match(library, /readChatTrash\(userKey\)\.retentionMs/);
  const confirmation = readFileSync("src/lib/library-delete-confirmation.ts", "utf8");
  assert.match(confirmation, /will move to Trash and can be restored for/);
  assert.match(confirmation, /your current retention setting/);
  assert.match(library, /if \(isCurrent\(\)\) restoreDeletedItem\(\)/);
});
test("management Search keeps its keyboard event and the Sidebar's existing inline fallback", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  const parse = (name, text) =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const find = (file, predicate) => {
    let result;
    const visit = (node) => {
      if (!result && predicate(node)) result = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(result, "Compile the actual Search handler");
    return result;
  };
  const compile = (source, deps) =>
    new Function(
      ...Object.keys(deps),
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(...Object.values(deps));
  const file = parse("AppShell.tsx", shell);
  const shortcut = find(
    file,
    (node) => ts.isPropertyAssignment(node) && node.name.getText(file) === "search",
  );
  const events = [];
  const activate = compile(`return (${shortcut.initializer.getText(file)});`, {
    window: { dispatchEvent: (event) => events.push(event.type) },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
  });
  activate();
  assert.deepEqual(events, ["kova-open-search"]);

  const sidebarFile = parse("Sidebar.tsx", sidebar);
  const effect = find(
    sidebarFile,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(sidebarFile) === "useEffect" &&
      node.arguments[0]?.getText(sidebarFile).includes("const openSearch ="),
  );
  for (const open of [false, true]) {
    const calls = [],
      listeners = new Map();
    const install = compile(`return (${effect.arguments[0].getText(sidebarFile)});`, {
      open,
      setSearchOpen: (value) => calls.push(["search-open", value]),
      onToggle: () => calls.push(["open-sidebar"]),
      requestAnimationFrame: (callback) => callback(),
      document: {
        querySelector: (selector) => {
          assert.equal(selector, "#sidebar-chat-search");
          return { focus: () => calls.push(["focus-search"]) };
        },
      },
      window: {
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name, callback) => {
          if (listeners.get(name) === callback) listeners.delete(name);
        },
      },
    });
    const cleanup = install();
    listeners.get(events[0])();
    assert.deepEqual(calls, [
      ["search-open", true],
      ...(!open ? [["open-sidebar"]] : []),
      ["focus-search"],
    ]);
    cleanup();
    assert.equal(listeners.size, 0, "Unmounting removes the Search listener");
  }
});
