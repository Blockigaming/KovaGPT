import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_IDS } from "../../src/lib/notification-catalog.mjs";

test("first project onboarding requires a server-loaded empty directory and saved project", () => {
  const src = readFileSync("src/routes/projects.tsx", "utf8");
  const created = src.indexOf('id: "project_created", title: "Project created"');
  const first = src.indexOf('id: "first_project"');
  assert.ok(first >= 0 && first < created);
  assert.match(src, /resolvedUserKey === userKey && !loading && !loadError && projects\.length === 0/);
  assert.ok(NOTIFICATION_IDS.includes("first_project"));
});

test("Library file lifecycle notices follow actual selection, extraction and save", () => {
  const src = readFileSync("src/components/LibraryUploadDialog.tsx", "utf8");
  for (const id of ["file_selected", "file_processing", "upload_started", "upload_completed", "upload_failed", "upload_limit"]) {
    assert.ok(src.includes(`"${id}"`), `missing ${id}`);
  }
  const extraction = src.indexOf("await extractDocumentFile");
  const saving = src.indexOf("await saveOriginalLibraryFile");
  assert.ok(extraction > src.indexOf('id: "file_processing"'));
  assert.ok(saving > src.indexOf('id: "upload_started"'));
  assert.ok(src.indexOf('id: "upload_completed"') > saving);
});
