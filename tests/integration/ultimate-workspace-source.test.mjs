import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Writing Workspace keeps bounded local versions and exports portable formats", () => {
  const source = read("src/routes/write.tsx");
  assert.match(source, /kova-write-draft/);
  assert.match(source, /saveToLibrary/);
  assert.match(source, /Download \.md/);
  assert.doesNotMatch(source, /\bconfirm\(/);
});

test("destructive workspace actions use accessible application dialogs", () => {
  for (const path of [
    "src/routes/write.tsx",
    "src/routes/memory.tsx",
    "src/routes/library.tsx",
    "src/routes/projects.tsx",
    "src/routes/apps.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\bconfirm\(/);
  }
});

test("GitHub disconnect distinguishes retained and removed synchronized data", () => {
  const source = read("src/routes/apps.tsx");
  assert.match(source, /Disconnect only/);
  assert.match(source, /Disconnect and remove data/);
  assert.match(source, /removeData: false/);
  assert.match(source, /removeData: true/);
});

test("dialog positioning is not overwritten by the shared menu transform animation", () => {
  const styles = read("src/styles.css");
  assert.doesNotMatch(styles, /:where\(\[role="dialog"\],[^\n]+\)\[data-state="open"\]/);
  assert.match(styles, /:where\(\[role="menu"\], \[role="listbox"\]\)\[data-state="open"\]/);
});
