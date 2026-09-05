import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const [library, folders, client, functions, supabaseTypes] = await Promise.all([
  read("src/routes/library.tsx"),
  read("src/components/LibraryFolderOrganizer.tsx"),
  read("src/lib/library-folders.ts"),
  read("src/lib/library.functions.ts"),
  read("src/integrations/supabase/types.ts"),
]);

test("Library loads folder membership and scopes visible items", () => {
  assert.match(functions, /folder_id/);
  assert.match(
    functions,
    /file_size, folder_id, metadata, content_generation, content_revision, created_at/,
  );
  assert.match(supabaseTypes, /library_folders: \{/);
  assert.match(supabaseTypes, /folder_id: string \| null/);
  assert.match(supabaseTypes, /user_library_items_folder_id_fkey/);
  assert.match(library, /LibraryFolderOrganizer/);
  assert.match(
    library,
    /folderScope === "unfiled"\) return UUID_PATTERN\.test\(item\.id\) && !item\.folder_id/,
  );
  assert.match(library, /folderScope !== "all"\) return item\.folder_id === folderScope/);
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
  assert.match(library, /onFoldersDeleted=\{\(\) => \{[\s\S]*void load\(\)/);
});

test("folder UI keeps async loads, principals, and mutation state consistent", () => {
  assert.match(folders, /refreshKey: number/);
  assert.match(folders, /\[enabled, load, principalKey, refreshKey\]/);
  assert.match(folders, /const generation = \+\+generationRef\.current/);
  assert.match(folders, /if \(!isCurrent\(\)\) return/);
  assert.match(folders, /if \(isCurrent\(\)\) setBusy\(null\)/);
  assert.match(folders, /setEditorError\(errorMessage\(mutationError\)\)/);
  assert.match(folders, /role="alert"[\s\S]*\{editorError\}/);
  assert.match(folders, /folderPath\(folder, folders\)/);
  assert.match(folders, /moveTarget !== "root"[\s\S]*setMoveTarget\("root"\)/);
  assert.match(library, /refreshKey=\{folderRefreshKey\}/);
  assert.match(library, /setFolderRefreshKey\(\(current\) => current \+ 1\)/);
});

test("Library invalidates stale item loads and distinguishes filter emptiness", () => {
  assert.match(
    library,
    /onMoved=[\s\S]*loadGenerationRef\.current \+= 1;[\s\S]*folder_id: folderId/,
  );
  assert.match(library, /const folderItems = useMemo/);
  assert.match(library, /folderScope !== "all" && folderItems\.length === 0/);
  assert.match(library, /return folderItems[\s\S]*filter === "favorites"/);
});

test("page refresh cannot invalidate an active folder mutation", () => {
  assert.match(folders, /onBusyChange: \(busy: boolean\) => void/);
  assert.match(folders, /onBusyChange\(Boolean\(busy\)\)/);
  assert.match(library, /onBusyChange=\{setFolderBusy\}/);
  assert.match(library, /if \(folderBusy\) return/);
  assert.match(library, /disabled=\{loading \|\| folderBusy \|\| sharesLoading\}/);
  assert.match(
    folders,
    /const folderStateUnavailable = loading \|\| Boolean\(error\) \|\| !foldersLoaded/,
  );
  assert.match(folders, /onClick=\{onRefresh\}/);
  assert.match(library, /onRefresh=\{refreshLibrary\}/);
  assert.match(library, /setLoadError[\s\S]*setSelected\(\[\]\)[\s\S]*toast\.error/);
  assert.match(library, /!principalReady \|\| !principal \|\| folderBusy/);
  assert.match(library, /disabled=\{folderBusy\}[\s\S]*deleteSelected/);
  assert.match(library, /itemStateUnavailable=\{loading \|\| Boolean\(loadError\)\}/);
  assert.match(
    folders,
    /folderStateUnavailable \|\|[\s\S]*itemStateUnavailable \|\|[\s\S]*selectedItemIds\.length/,
  );
});
