import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compactDeveloperConsole } from "../helpers/developer-console-compact.mjs";
const path = "src/routes/developers.console.tsx";
const source = readFileSync(path, "utf8");
const before = process.env.KOVA_COMPACT_BASE_SOURCE
  ? readFileSync(process.env.KOVA_COMPACT_BASE_SOURCE, "utf8")
  : execFileSync("git", ["show", "1084d980209276d19f28590317141bbe464bee6c:" + path], {
      encoding: "utf8",
    });
test("Only declared pager and calls-table classes change; all data and handlers remain exact", () => {
  assert.equal(source, compactDeveloperConsole(before));
});
test("Page indicator stays whole and cannot shrink while its control row can wrap", () => {
  assert.match(
    source,
    /className="flex flex-wrap items-center gap-3">\s+<Button\s+variant="outline"\s+disabled=\{limitsPage === 0 \|\| busy\}/,
  );
  assert.match(
    source,
    /<span className="shrink-0 whitespace-nowrap">Page \{limitsPage \+ 1\}<\/span>/,
  );
  for (const handler of [
    "onClick={() => setLimitsPage((page) => Math.max(0, page - 1))}",
    "onClick={() => setLimitsPage((page) => page + 1)}",
  ])
    assert.ok(source.includes(handler));
});
test("API calls keep semantic readable headers inside their existing horizontal scroller", () => {
  const start = source.indexOf("Latest 100 API calls</h2>");
  const end = source.indexOf("</table>", start) + "</table>".length;
  const table = source.slice(start, end);
  assert.match(table, /<div className="overflow-x-auto">/);
  assert.match(table, /<table className="w-full min-w-\[28rem\] text-left">/);
  for (const label of ["Model", "Status", "Charge (minor units)"])
    assert.ok(table.includes(`<th className="whitespace-nowrap p-2">${label}</th>`));
  assert.equal((table.match(/<th /g) || []).length, 3);
  for (const tag of ["thead", "tbody", "tr"]) assert.match(table, new RegExp("<" + tag + "[ >]"));
  assert.doesNotMatch(table, /overflow-hidden|overflow-x-hidden/);
  assert.equal(
    table.slice(table.indexOf("<tbody>")),
    before.slice(
      before.indexOf("<tbody>", before.indexOf("Latest 100 API calls</h2>")),
      before.indexOf("</table>", before.indexOf("Latest 100 API calls</h2>")) + "</table>".length,
    ),
  );
});
test("Layout transformation rejects missing or repeated targets instead of silently changing another section", () => {
  assert.throws(() => compactDeveloperConsole(source));
  assert.throws(() => compactDeveloperConsole(before + before));
});
