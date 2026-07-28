import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeMarkup,
  parseCsv,
  textDiff,
  jsonDiff,
  csvDiff,
  PREVIEW_LIMITS,
} from "../../src/lib/deliverable-content.mjs";
test("preview sanitizer removes active content", () => {
  const value = sanitizeMarkup(
    '<script>alert(1)</script><p onclick="x()"><a href="javascript:x">safe</a></p>',
  );
  assert.doesNotMatch(value, /script|onclick|javascript:/i);
});
test("CSV parser supports quotes escaped delimiters and bounded previews", () => {
  const result = parseCsv('name,note\nAda,"a,b"\nBob,"say ""hi"""');
  assert.deepEqual(result.headers, ["name", "note"]);
  assert.equal(result.rows[0][1], "a,b");
  assert.equal(result.rows[1][1], 'say "hi"');
  assert.equal(PREVIEW_LIMITS.csvRows, 2000);
});
test("text diff reports semantic line changes", () => {
  assert.deepEqual(
    { ...textDiff("a\nb", "a\nc"), lines: undefined },
    { lines: undefined, added: 0, removed: 0, modified: 1 },
  );
});
test("JSON diff reports paths additions removals and types", () => {
  const result = jsonDiff({ a: 1, b: true }, { a: "1", c: 2 });
  assert.deepEqual(
    result.map((x) => x.path),
    ["$.a", "$.b", "$.c"],
  );
});
test("CSV diff reports rows columns and cells", () => {
  const result = csvDiff("id,name\n1,A\n2,B", "id,name,age\n1,AA,4\n3,C,5", "id");
  assert.equal(result.addedRows, 1);
  assert.equal(result.removedRows, 1);
  assert.equal(result.changedCells, 2);
  assert.deepEqual(result.addedColumns, ["age"]);
});
