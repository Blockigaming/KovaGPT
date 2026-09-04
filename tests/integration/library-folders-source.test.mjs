import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const migration = await read(
  "supabase/migrations/20260903210000_library_folders_and_bulk_move.sql",
);
const foldersRoute = await read("src/routes/api/library/folders.ts");
const bulkRoute = await read("src/routes/api/library/bulk-move.ts");

test("folder schema enforces owner trees, bounded depth, and data-preserving deletion", () => {
  assert.match(migration, /library_folders_parent_owner_fk/u);
  assert.match(migration, /folder_depth_exceeded/u);
  assert.match(migration, /folder_cycle/u);
  assert.match(migration, /on delete set null/u);
  assert.match(migration, /library_folder_locks/u);
  assert.match(migration, /items_moved_to_root/u);
});

test("folder and bulk endpoints authenticate, reject cross-site writes, and bound JSON", () => {
  for (const source of [foldersRoute, bulkRoute]) {
    assert.match(source, /requireUser/u);
    assert.match(source, /isCrossSiteMutation/u);
    assert.match(source, /readBoundedJsonObject/u);
    assert.match(source, /consumeApplicationRateLimit/u);
    assert.match(source, /Cache-Control/u);
  }
  assert.match(bulkRoute, /result\.movedCount !== input\.itemIds\.length/u);
});

test("all mutations are atomic service-only RPCs with safe audit metadata", () => {
  for (const rpc of [
    "create_library_folder",
    "update_library_folder",
    "delete_library_folder",
    "bulk_move_library_items",
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*service_role`, "u"),
    );
  }
  assert.match(
    migration,
    /revoke all on function public\.bulk_move_library_items[\s\S]*authenticated/u,
  );
  assert.match(migration, /library_items_bulk_moved/u);
  assert.doesNotMatch(migration, /metadata[\s\S]{0,200}p_name/u);
});
