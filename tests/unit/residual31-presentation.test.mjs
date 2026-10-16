import { supportHierarchy } from "../helpers/settings-support-hierarchy.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import vm from "node:vm";
const base = "31ed20e59d52e30693f6aa45520e803030f3e65a";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const edits = {
  "src/routes/images.tsx": (s) =>
    s
      .replace(
        'className="rounded border bg-background p-2"',
        'className="kova-workspace-action rounded border bg-background p-2"',
      )
      .replace("<AppShell>", "<AppShell utilitiesInHeader>")
      .replace(
        "-mx-4 sm:-mx-6 px-4 sm:px-6 overflow-x-auto scroll-smooth scrollbar-none",
        "kova-image-style-scroll overflow-x-auto scroll-smooth scrollbar-none",
      ),
  "src/routes/work.tsx": (s) =>
    s.replace(
      '<main\n        className="kova-adapted-controls',
      '<main\n        id="main-content"\n        tabIndex={-1}\n        className="kova-adapted-controls',
    ),
  "src/components/SettingsDialog.tsx": (s) =>
    supportHierarchy(s).replace(
      'className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground"',
      'className="kova-workspace-action mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground"',
    ),
  "src/routes/projects.$projectId.tsx": (s) =>
    ["overview", "chats", "tasks", "members", "settings"].reduce(
      (value, tab) =>
        value.replaceAll(
          `<TabsContent value="${tab}" className="mt-4">`,
          `<TabsContent value="${tab}" className="kova-workspace-controls mt-4">`,
        ),
      s,
    ),
};
for (const [path, edit] of Object.entries(edits))
  test(`Only declared presentation changes; values/options/actions/lifecycles preserved: ${path}`, () => {
    const old = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    assert.notEqual(edit(old), old);
    assert.equal(compile(readFileSync(path, "utf8")), compile(edit(old)));
  });
test("Work target matches existing root skip link; pricing anchors/focus and chat/settings handlers are unchanged", () => {
  assert.match(
    readFileSync("src/routes/work.tsx", "utf8"),
    /<main\s+id="main-content"\s+tabIndex=\{-1\}/,
  );
  for (const path of [
    "src/routes/__root.tsx",
    "src/routes/pricing.tsx",
    "src/components/public/PublicShell.tsx",
    "src/components/ChatMessage.tsx",
    "src/components/ui/switch.tsx",
    "src/lib/projects.functions.ts",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
  assert.match(readFileSync("src/routes/__root.tsx", "utf8"), /href="#main-content"/);
});
test("Public header measurement token updates after resize and disconnects cleanly", () => {
  const source = readFileSync("src/components/public/PublicShell.tsx", "utf8"),
    ast = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === "useEffect" &&
      n.getText(ast).includes('"--kova-public-header-height"')
    )
      callback = n.arguments[0].getText(ast);
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.ok(callback);
  let height = 68,
    resize,
    observed,
    disconnected = false;
  const values = [],
    header = { getBoundingClientRect: () => ({ height }) },
    shell = { querySelector: () => header, style: { setProperty: (...v) => values.push(v) } };
  const effect = vm.runInNewContext(compile(`(${callback})`), {
    shellRef: { current: shell },
    ResizeObserver: class {
      constructor(cb) {
        resize = cb;
      }
      observe(el) {
        observed = el;
      }
      disconnect() {
        disconnected = true;
      }
    },
  });
  const cleanup = effect();
  assert.equal(observed, header);
  assert.deepEqual(values.at(-1), ["--kova-public-header-height", "68px"]);
  height = 104;
  resize();
  assert.deepEqual(values.at(-1), ["--kova-public-header-height", "104px"]);
  cleanup();
  assert.equal(disconnected, true);
});
