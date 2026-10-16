import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
const path = "src/lib/public-academy-content.ts";
const before = execFileSync("git", ["show", "b189324cf843bcf276e6458fb273a86ebc1ae149:" + path], {
  encoding: "utf8",
});
const source = process.env.KOVA_REGRESSION_BASE ? before : readFileSync(path, "utf8");
function pages(s) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(s, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports },
  );
  return JSON.parse(JSON.stringify(exports.PUBLIC_ACADEMY_PAGES));
}
const current = pages(source),
  original = pages(before);
const opener = "Practice this topic with a focused exercise. ";
const retained =
  "Start with an outcome, the context you are allowed to use, and the person responsible for the finished work.";
for (const slug of [
  "image-generation",
  "personalization",
  "projects",
  "skills",
  "using-chatgpt",
  "responsible-and-safe-use",
])
  test(`${slug}: neutral opener with unchanged follow-on guidance`, () => {
    const page = current.find((p) => p.slug === slug);
    assert.ok(page);
    assert.equal(page.sections[0].body, opener + retained);
  });
test("Every topic retains exact title/acronyms, practice, safeguards, actions and all other content", () => {
  assert.equal(current.length, original.length);
  assert.ok(current.some((p) => /AI/.test(p.title)));
  assert.ok(current.some((p) => /KovaGPT/.test(p.title)));
  for (let i = 0; i < current.length; i++) {
    assert.equal(current[i].sections[0].body, opener + retained);
    const expected = structuredClone(original[i]);
    expected.sections[0].body = opener + retained;
    assert.deepEqual(current[i], expected);
  }
});
test("Source differs only by the generic opener", () => {
  const expected = before.replace(
    "`This Kova Academy guide turns ${topic.title.toLowerCase()} into a bounded exercise. " +
      retained +
      "`",
    JSON.stringify(opener + retained),
  );
  assert.notEqual(expected, before);
  assert.equal(source, expected);
});
