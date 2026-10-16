import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const base = "ae955b200f4f85ef87f86bdcac08ef7d0fa28b10";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const edits = {
  "src/routes/unsubscribe.tsx": (s) =>
    s
      .replace(
        '<div className="min-h-[80vh] flex items-center justify-center px-6 py-16">',
        '<main id="main-content" tabIndex={-1} className="min-h-[80vh] flex items-center justify-center px-6 py-16">',
      )
      .replace(/<\/div>(\s*\);\s*}\s*)$/, "</main>$1"),
  "src/routes/~oauth.callback.tsx": (s) =>
    s
      .replace("<main", '<main id="main-content" tabIndex={-1}')
      .replace('className="mt-5 inline-flex', 'className="kova-workspace-action mt-5 inline-flex'),
  "src/routes/admin/kovas.tsx": (s) =>
    s.replace(
      '<SignInButton mode="modal">\n            <button>Sign in to moderation</button>\n          </SignInButton>',
      '<main id="main-content" tabIndex={-1} className="kova-state-screen"><section className="kova-state-panel" aria-labelledby="moderation-sign-in-title"><h1 id="moderation-sign-in-title">Kova moderation</h1><SignInButton mode="modal"><button className="kova-workspace-action mt-4 inline-flex items-center justify-center rounded-lg border px-4 py-2">Sign in to moderation</button></SignInButton></section></main>',
    ),
  "src/routes/developers.pricing.tsx": (s) =>
    s.replace(
      "<Button>Sign in</Button>",
      '<Button className="kova-workspace-action">Sign in</Button>',
    ),
  "src/routes/omega.tsx": (s) =>
    s.replace(
      'className="mt-3 inline-flex min-h-10',
      'className="kova-workspace-action mt-3 inline-flex min-h-10',
    ),
};
for (const [path, edit] of Object.entries(edits))
  test(`All token/auth/admin/subscription handlers and destinations retained: ${path}`, () => {
    const old = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
      expected = edit(old),
      actual = readFileSync(path, "utf8");
    assert.notEqual(expected, old);
    // Shared-header utility placement is explicit; auth/token handlers stay exact.
    if (path === "src/routes/omega.tsx")
      assert.equal((actual.match(/<AppShell utilitiesInHeader>/g) ?? []).length, 1);
    assert.equal(
      compile(
        path === "src/routes/omega.tsx"
          ? actual.replace("<AppShell utilitiesInHeader>", "<AppShell>")
          : actual,
      ),
      compile(expected),
    );
  });
