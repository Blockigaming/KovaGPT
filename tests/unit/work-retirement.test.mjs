import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { SIDEBAR_ITEMS } from "../../src/lib/sidebar-layout.mjs";

test("retired Work bookmarks redirect to chat without mounting the old workspace", () => {
  let config;
  const exports = {};
  const source = readFileSync("src/routes/work.tsx", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "exports", code)(
    () => ({
      createFileRoute: (path) => (value) => {
        assert.equal(path, "/work");
        config = value;
      },
      redirect: (value) => value,
    }),
    exports,
  );
  assert.throws(
    () => config.beforeLoad(),
    (value) => value.to === "/" && value.replace === true,
  );
  assert.equal(config.component, undefined);
  assert.equal(
    SIDEBAR_ITEMS.some((item) => item.to === "/work"),
    false,
  );
});
