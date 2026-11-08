import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const detail = loadUiModule("src/lib/library-detail.ts", {});
const { libraryListMetadata } = loadUiModule("src/lib/library-list-metadata.ts", {
  "./library-detail": detail,
});
const item = { title: "Saved title", file_name: "source.txt", created_at: "2026-10-01T00:00:00Z" };
test("list preserves filename and saved instant without fabricating modification time", () => {
  const result = libraryListMetadata(item);
  assert.equal(result.filename, "source.txt");
  assert.equal(result.savedAt, item.created_at);
  assert.equal(result.modifiedAt, undefined);
  assert.equal(libraryListMetadata({ ...item, file_name: "  " }).filename, item.title);
});
test("only a validated actual modified instant is shown", () => {
  for (const updated_at of [null, "", "yesterday", 123])
    assert.equal(libraryListMetadata({ ...item, updated_at }).modifiedAt, undefined);
  const updated_at = "2026-10-02T17:30:00+02:00";
  assert.equal(libraryListMetadata({ ...item, updated_at }).modifiedAt, updated_at);
});
test("Library labels date semantics and uses confirmed permanent chat deletion", () => {
  const source = readFileSync("src/routes/library.tsx", "utf8");
  assert.match(source, /Saved \{dateLabel\}/);
  assert.doesNotMatch(source, /<ChatTrashPanel/);
  assert.match(source, /permanentlyDeleteChat\(userKey, chat, isCurrent\)/);
});

test("Library metadata does not visually capitalize exact filenames", () => {
  const css = readFileSync("src/styles/spec400-management.css", "utf8");
  assert.match(
    css,
    /\.kova-core-page\.kova-file-directory\.spec400-library \.kova-file-row-type\s*\{\s*text-transform: none;/,
  );
  assert.equal(
    libraryListMetadata({ ...item, file_name: "Mixed_CASE-notes.txt" }).filename,
    "Mixed_CASE-notes.txt",
  );
});
