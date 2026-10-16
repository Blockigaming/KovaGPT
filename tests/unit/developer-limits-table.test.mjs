import { compactDeveloperConsole } from "../helpers/developer-console-compact.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { readableLimitsTable } from "../helpers/developer-limits-table.mjs";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
test("Only scoped spending table presentation changes; semantic table, all data and handlers preserved", () => {
  const path = "src/routes/developers.console.tsx",
    source = readFileSync(path, "utf8");
  const before = execFileSync("git", ["show", "a103d4ffdaada0e5311ccf199610d7b2fe784433:" + path], {
    encoding: "utf8",
  });
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source), compile(compactDeveloperConsole(readableLimitsTable(before))));
  assert.deepEqual(eventAttributes(source), eventAttributes(before));
  const table = source.slice(
    source.indexOf("Stored spending limits"),
    source.indexOf("</table>", source.indexOf("Stored spending limits")),
  );
  assert.match(table, /<div className="overflow-x-auto">/);
  assert.equal((table.match(/<th className="whitespace-nowrap p-2">/g) || []).length, 6);
  for (const tag of ["thead", "tbody", "tr"]) assert.match(table, new RegExp("<" + tag + "[ >]"));
  assert.doesNotMatch(table, /overflow-hidden|overflow-x-hidden/);
});
