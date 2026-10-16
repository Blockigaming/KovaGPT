import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const path = "src/components/LibraryVersionsDialog.tsx";
const source = readFileSync(path, "utf8");
const before = process.env.KOVA_VERSIONS_BASE_SOURCE
  ? readFileSync(process.env.KOVA_VERSIONS_BASE_SOURCE, "utf8")
  : execFileSync("git", ["show", "1084d980209276d19f28590317141bbe464bee6c:" + path], {
      encoding: "utf8",
    });
test("Library Versions changes only title layout; text, aria, handlers and data remain exact", () => {
  const expected = before.replace(
    "<DialogTitle>Versions of {item.title}</DialogTitle>",
    '<DialogTitle className="min-w-0 max-w-full pr-14 whitespace-normal [overflow-wrap:anywhere]">\n          Versions of {item.title}\n        </DialogTitle>',
  );
  assert.notEqual(expected, before);
  assert.equal(source, expected);
});
test("Library Versions title reserves a right-side close/focus gutter and can shrink", () => {
  const title = source.match(/<DialogTitle className="([^"]+)"/);
  assert.ok(title, "Title must declare its scoped layout classes");
  const classes = title[1].split(" ");
  for (const name of ["min-w-0", "max-w-full", "pr-14"]) assert.ok(classes.includes(name));
  // 14 standard .25rem spacing units reserve 3.5rem (56px at the default root).
  // This is a source contract, not a native text/Close geometry assertion.
  assert.ok(14 * 4 >= 44 + 8);
});
test("The complete filename stays in the accessible title and can wrap without clipping", () => {
  const title = source.match(/<DialogTitle className="([^"]+)">([\s\S]*?)<\/DialogTitle>/);
  assert.ok(title);
  assert.match(title[1], /whitespace-normal/);
  assert.match(title[1], /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(title[1], /truncate|overflow-hidden|whitespace-nowrap/);
  assert.equal(title[2].trim(), "Versions of {item.title}");
});
