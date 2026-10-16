import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const base = "1270185bcea0becf9a70cbdf41af91f69b5753ba";
const files = [
  "ai-safety",
  "blog.ai-market-research-guide",
  "blog.best-ai-market-research-tools",
  "blog.best-ai-assistants",
];
const emit = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  }).outputText;
for (const name of files)
  test(`${name}: only declared typography wrapper changes; all content, dates, metadata, links, tables and explicit classes retained`, () => {
    const path = "src/routes/" + name + ".tsx",
      before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
      after = readFileSync(path, "utf8");
    let expected;
    if (name === "ai-safety") {
      expected = before.replace(
        "import { PublicShell }",
        'import { LegalArticle } from "@/components/LegalArticle";\nimport { PublicShell }',
      );
      const start = expected.indexOf("      <main\n"),
        end = expected.indexOf("        <h1>", start);
      assert.ok(start >= 0 && end > start);
      expected = expected.slice(0, start) + "      <LegalArticle>\n" + expected.slice(end);
      expected = expected.replace("      </main>", "      </LegalArticle>");
    } else {
      assert.equal(before.split('className="prose prose-invert max-w-none"').length, 2);
      expected = before.replace(
        'className="prose prose-invert max-w-none"',
        'className="kova-public-article max-w-none"',
      );
    }
    if (name === "blog.ai-market-research-guide")
      expected = expected.replace(
        "retrieved material. Search are",
        "retrieved material. Search is",
      );
    assert.equal(emit(after), emit(expected));
  });
test("Terms, Privacy, Refund, shared LegalArticle and dynamic blog mode facts remain untouched", () => {
  for (const path of [
    "src/routes/terms.tsx",
    "src/routes/privacy.tsx",
    "src/routes/refund.tsx",
    "src/components/LegalArticle.tsx",
    "src/lib/modes.ts",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
      path,
    );
});
