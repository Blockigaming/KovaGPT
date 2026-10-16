import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const base = "c1999927dcddc4c057588e2dd5f1a802e748b8a4";
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path + "/" + e.name)
      : e.name.endsWith(".tsx")
        ? [path + "/" + e.name]
        : [],
  );
}
function nativeInputs(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    out = [];
  const visit = (n) => {
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === "input") {
      const type = n.attributes.properties.find((p) => p.name?.getText(ast) === "type")?.initializer
        ?.text;
      if (["checkbox", "radio"].includes(type))
        out.push({
          type,
          source: n.getText(ast),
          line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
        });
    }
    ts.forEachChild(n, visit);
  };
  visit(ast);
  return out;
}
test("Every native checkbox/radio declaration and checked/default/change contract remains unchanged", () => {
  const inventory = [];
  for (const path of walk("src")) {
    const current = nativeInputs(readFileSync(path, "utf8"), path);
    if (!current.length) continue;
    const prior = nativeInputs(
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
      path,
    );
    assert.deepEqual(
      current.map((x) => x.source),
      prior.map((x) => x.source),
      path,
    );
    for (const item of current) {
      assert.doesNotMatch(item.source, /appearance-none/);
      inventory.push({
        path,
        type: item.type,
        line: item.line,
        explicitClass: item.source.match(/className="([^"]*)"/)?.[1] ?? null,
      });
    }
  }
  assert.ok(inventory.some((x) => x.path.endsWith("AcademyPractice.tsx")));
  assert.ok(inventory.some((x) => x.path.endsWith("PersonalitySliders.tsx")));
  assert.ok(inventory.some((x) => x.path.endsWith("developers.console.tsx")));
  assert.ok(inventory.some((x) => x.type === "radio"));
  if (process.env.KOVA_NATIVE_INVENTORY)
    writeFileSync(process.env.KOVA_NATIVE_INVENTORY, JSON.stringify(inventory, null, 2) + "\n");
});
test("Custom checkbox/radio/switch primitives are byte-identical", () => {
  for (const path of [
    "src/components/ui/checkbox.tsx",
    "src/components/ui/radio-group.tsx",
    "src/components/ui/switch.tsx",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
});
test("Developer Console only opts into scoped action sizing; limits/permissions/defaults/actions unchanged", () => {
  const path = "src/routes/developers.console.tsx",
    before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    after = readFileSync(path, "utf8");
  assert.equal(after.replaceAll('      className="kova-developer-console"\n', ""), before);
});
