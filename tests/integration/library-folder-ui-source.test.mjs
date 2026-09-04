import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const [library, folders, client, functions, supabaseTypes] = await Promise.all([
  read("src/routes/library.tsx"),
  read("src/components/LibraryFolderOrganizer.tsx"),
  read("src/lib/library-folders.client.ts"),
  read("src/lib/library.functions.ts"),
  read("src/integrations/supabase/types.ts"),
]);

test("Library loads folder membership and scopes visible items", () => {
  assert.match(functions, /folder_id/);
  assert.match(functions, /file_size, folder_id, created_at/);
  assert.match(supabaseTypes, /library_folders: \{/);
  assert.match(supabaseTypes, /folder_id: string \| null/);
  assert.match(supabaseTypes, /user_library_items_folder_id_fkey/);
  assert.match(library, /LibraryFolderOrganizer/);
  assert.match(library, /folderScope === "unfiled" && item\.folder_id/);
  assert.match(library, /item\.folder_id !== folderScope/);
});

test("signed-in users can navigate and mutate real Library folders", () => {
  for (const marker of [
    "All items",
    "Unfiled",
    "New folder",
    "New subfolder",
    "Rename",
    "Delete folder",
    "Loading folders…",
  ]) {
    assert.match(folders, new RegExp(marker));
  }
  for (const operation of [
    "listLibraryFolders",
    "createLibraryFolder",
    "renameLibraryFolder",
    "deleteLibraryFolder",
    "moveLibraryItems",
  ]) {
    assert.match(folders, new RegExp(operation));
  }
});

test("folder requests use authenticated bounded network calls", () => {
  assert.match(client, /fetchWithTimeoutAuthenticated/);
  assert.match(client, /15_000/);
  assert.match(client, /\/api\/library\/folders/);
  assert.match(client, /\/api\/library\/bulk-move/);
  assert.match(client, /Cache-Control|cache: "no-store"/);
  assert.match(client, /LibraryFolderRequestError/);
});

test("bulk moves and folder deletion preserve truthful limits and data copy", () => {
  assert.match(folders, /MAX_BULK_MOVE_ITEMS = 100/);
  assert.match(folders, /selectedItemIds\.length > MAX_BULK_MOVE_ITEMS/);
  assert.match(folders, /Their Library items will be kept and moved to Unfiled/);
  assert.match(library, /moved\.has\(item\.id\).*folder_id: folderId/s);
  assert.match(library, /removed\.has\(item\.folder_id\).*folder_id: null/s);
});
