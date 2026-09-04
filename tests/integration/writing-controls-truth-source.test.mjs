import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const writeRoute = readFileSync(join(root, "src/routes/write.tsx"), "utf8");
const exportCommon = readFileSync(join(root, "src/lib/writing-export/common.ts"), "utf8");

test("writing drafts surface persistence failures without crossing principals", () => {
  assert.match(writeRoute, /principalScopedStorageKey\(STORAGE_KEY_BASE, userKey\)/);
  assert.match(writeRoute, /principalScopedStorageKey\(VERSIONS_KEY_BASE, userKey\)/);
  assert.match(writeRoute, /if \(!storage\) throw new Error\("Browser storage is unavailable\."\)/);
  assert.match(writeRoute, /setAutosaveError\(/);
  assert.match(writeRoute, /role=\{autosaveError \? "alert" : "status"\}/);
  assert.match(writeRoute, /draft could not be autosaved/);
  assert.doesNotMatch(writeRoute, /Document version history/);
  assert.match(writeRoute, />\s*Save version\s*</);
  assert.match(writeRoute, /Document version could not be saved/);
  assert.match(writeRoute, /Saved document versions could not be read/);
  assert.match(writeRoute, /No saved document versions yet/);
});

test("writing copy and download controls expose failure states and safe URL lifecycles", () => {
  assert.match(writeRoute, /Could not copy the document/);
  assert.match(writeRoute, /Markdown download failed/);
  assert.match(writeRoute, /Document export failed/);
  assert.match(writeRoute, /escapeHtml\(title\)/);
  assert.match(writeRoute, /document\.body\.appendChild\(anchor\)/);
  assert.match(
    writeRoute,
    /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(completedUrl\), 1_000\)/,
  );
  assert.match(exportCommon, /document\.body\.appendChild\(anchor\)/);
  assert.match(exportCommon, /finally\s*\{\s*anchor\?\.remove\(\)/);
  assert.match(
    exportCommon,
    /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(completedUrl\), 1_000\)/,
  );
  assert.ok((writeRoute.match(/min-h-11/g) ?? []).length >= 12);
  assert.match(writeRoute, /aria-busy=\{!documentReady\}/);
  assert.match(writeRoute, /Loading document/);
});
