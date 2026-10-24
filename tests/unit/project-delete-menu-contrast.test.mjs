import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/routes/projects.tsx", import.meta.url), "utf8");
const item = source.match(
  /<DropdownMenuItem\s+onClick=\{\(\) => setDeletingProject\(p\)\}[\s\S]*?<\/DropdownMenuItem>/,
)?.[0];

test("project Delete and Retry deletion labels retain foreground contrast in normal and focused menu states", () => {
  assert.ok(item);
  assert.match(item, /className="text-foreground focus:text-foreground"/);
  assert.doesNotMatch(item, /className="text-destructive focus:text-destructive"/);
  assert.match(item, /p\.deletion_requested_at \? "Retry deletion" : "Delete"/);
});

test("destructive icon and owner/deletion guards remain on the same action", () => {
  assert.match(item, /<Trash2 className="w-4 h-4 mr-2 text-destructive"/);
  assert.match(item, /disabled=\{p\.role !== "owner" \|\| deletingProjectIds\.has\(p\.id\)\}/);
  assert.match(item, /onClick=\{\(\) => setDeletingProject\(p\)\}/);
});
