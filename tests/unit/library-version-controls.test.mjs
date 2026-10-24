import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/components/LibraryVersionsDialog.tsx", import.meta.url),
  "utf8",
);
test("version rows retain rounded surfaces and narrow-screen wrapping", () => {
  assert.match(source, /gap-3 rounded-xl border p-3/);
  assert.match(source, /min-w-0 break-words text-sm/);
  assert.match(source, /flex flex-wrap gap-2/);
});
test("each version action identifies its revision and keeps a touch-sized target", () => {
  assert.match(
    source,
    /className="min-h-11"\s+aria-label=\{`Read version \$\{version.revision\}`\}/,
  );
  assert.match(
    source,
    /className="min-h-11"\s+aria-label=\{`Download version \$\{version.revision\}`\}/,
  );
});
