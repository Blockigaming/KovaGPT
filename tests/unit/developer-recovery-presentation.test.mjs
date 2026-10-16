import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { consentPresentation } from "../helpers/consent-presentation-contract.mjs";
const base = "1d4b743a63f418af0f206def733a9d8f8982f5f0";
const paths = [
  "src/routes/share-inbox.tsx",
  "src/components/DeveloperMcpAccess.tsx",
  "src/routes/oauth.consent.tsx",
  "src/routes/reset-password.tsx",
  "src/routes/developers.authorize.tsx",
  "src/routes/developers.$docSlug.tsx",
];
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
for (const path of paths)
  test(`Presentation-only contract: ${path}`, () => {
    let before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    const after = readFileSync(path, "utf8");
    if (path.endsWith("developers.authorize.tsx"))
      before = before.replace(
        "<p>Invalid authorization request. Restart from your client.</p>",
        '<main id="main-content" tabIndex={-1} className="kova-state-screen"><section className="kova-state-panel" aria-labelledby="developer-authorization-error"><h1 id="developer-authorization-error">Authorization unavailable</h1><p>Invalid authorization request. Restart from your client.</p></section></main>',
      );
    else if (path.endsWith("reset-password.tsx")) {
      before = before
        .replace(
          '<div className="kova-auth-page',
          '<main id="main-content" tabIndex={-1} className="kova-auth-page',
        )
        .replace(/<\/div>(\s*\);\s*}\s*)$/, "</main>$1")
        .replace(
          'className="text-sm text-destructive',
          'className="kova-reset-error text-sm text-destructive',
        );
    } else if (!path.endsWith("$docSlug.tsx"))
      before = before.replace("<main", '<main id="main-content" tabIndex={-1}');
    if (path.endsWith("DeveloperMcpAccess.tsx"))
      before = before
        .replace(
          'className="text-sm underline"',
          'className="kova-developer-link kova-workspace-action text-sm underline"',
        )
        .replace(
          'return (\n    <div className="space-y-6">',
          'return (\n    <div className="kova-workspace-controls space-y-6">',
        );
    if (path.endsWith("$docSlug.tsx"))
      before = before.replace(
        'className="underline"',
        'className="kova-developer-link kova-workspace-action underline"',
      );
    if (path.endsWith("DeveloperMcpAccess.tsx")) before = consentPresentation(before);
    assert.equal(
      compile(after),
      compile(before),
      "All code, handlers, text and native control contracts preserved except declared presentation edits",
    );
  });
test("Checkout invalid-session implementation is byte-identical", () => {
  const p = "src/routes/checkout.return.tsx";
  assert.equal(
    readFileSync(p, "utf8"),
    execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
  );
});
