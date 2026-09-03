import assert from "node:assert/strict";
import test from "node:test";

import {
  LibraryFolderInputError,
  MAX_LIBRARY_BULK_ITEMS,
  libraryMutationErrorStatus,
  normalizeLibraryFolderName,
  parseBulkMoveLibraryItems,
  parseCreateLibraryFolder,
  parseDeleteLibraryFolder,
  parseUpdateLibraryFolder,
} from "../../src/lib/library-folders-policy.mjs";

const folder = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";

function rejectsInput(fn, code) {
  assert.throws(fn, (error) => error instanceof LibraryFolderInputError && error.code === code);
}

test("folder inputs are normalized and reject ambiguous names or unknown fields", () => {
  assert.equal(normalizeLibraryFolderName("  Research   Notes  "), "Research Notes");
  assert.deepEqual(parseCreateLibraryFolder({ name: "  Café  ", parentId: folder }), {
    name: "Café",
    parentId: folder,
  });
  rejectsInput(() => parseCreateLibraryFolder({ name: "../private" }), "invalid_folder_name");
  rejectsInput(() => parseCreateLibraryFolder({ name: "Safe", userId: folder }), "unknown_field");
});

test("folder updates distinguish an omitted parent from an explicit move to root", () => {
  assert.deepEqual(parseUpdateLibraryFolder({ id: folder, name: "Renamed" }), {
    id: folder,
    name: "Renamed",
    parentId: null,
    parentSupplied: false,
  });
  assert.deepEqual(parseUpdateLibraryFolder({ id: folder, parentId: null }), {
    id: folder,
    name: null,
    parentId: null,
    parentSupplied: true,
  });
  assert.deepEqual(parseDeleteLibraryFolder({ id: folder }), { id: folder });
  rejectsInput(() => parseUpdateLibraryFolder({ id: folder }), "empty_folder_update");
});

test("bulk moves are exact, bounded, unique, and support the Library root", () => {
  assert.deepEqual(parseBulkMoveLibraryItems({ itemIds: [item], folderId: null }), {
    itemIds: [item],
    folderId: null,
  });
  rejectsInput(
    () => parseBulkMoveLibraryItems({ itemIds: [item, item], folderId: folder }),
    "duplicate_library_item_id",
  );
  rejectsInput(
    () =>
      parseBulkMoveLibraryItems({
        itemIds: Array.from({ length: MAX_LIBRARY_BULK_ITEMS + 1 }, () => item),
        folderId: folder,
      }),
    "invalid_library_item_count",
  );
});

test("database errors map to stable public statuses without exposing SQL messages", () => {
  assert.equal(libraryMutationErrorStatus("23505"), 409);
  assert.equal(libraryMutationErrorStatus("P0002"), 404);
  assert.equal(libraryMutationErrorStatus("23514"), 400);
  assert.equal(libraryMutationErrorStatus("XX000"), 503);
});
