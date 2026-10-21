import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("task cards distinguish schedule zone from viewer-local timestamps and wrap metadata", () => {
  const source = readFileSync(
    new URL("../../src/routes/scheduled-tasks.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Schedule zone: \{t\.timezone\}/);
  assert.match(source, /text-xs text-muted-foreground flex flex-wrap items-center gap-1\.5 mt-1/);
});
