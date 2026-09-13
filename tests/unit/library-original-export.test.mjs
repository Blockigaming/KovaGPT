import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as crypto from "node:crypto";
import * as buffer from "node:buffer";
import * as policy from "../../src/lib/library-original-policy.mjs";
import * as exportPolicy from "../../src/lib/account-export-policy.mjs";
import * as projectPolicy from "../../src/lib/project-file-storage-policy.mjs";
import * as sitesExport from "../../src/lib/account-export-sites.mjs";
import * as exportPagination from "../../src/lib/account-export-pagination.mjs";
import * as cleanupPolicy from "../../src/lib/account-export-cleanup-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  gen = "22222222-2222-4222-8222-222222222222";
function loader() {
  const calls = [],
    original = "%PDF-1.7 exact original bytes";
  const modules = {
    "./library-original-policy.mjs": policy,
    "node:buffer": buffer,
    "node:crypto": crypto,
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        storage: {
          from: (bucket) => ({
            download: async (path) => {
              calls.push({ bucket, path });
              return { data: new Blob([original]) };
            },
          }),
        },
      },
    },
    "@/lib/account-export-policy.mjs": exportPolicy,
    "@/lib/account-export-cleanup-policy.mjs": cleanupPolicy,
    "@/lib/project-file-storage-policy.mjs": projectPolicy,
    "@/lib/account-export-pagination.mjs": exportPagination,
    "@/lib/account-export-sites.mjs": sitesExport,
  };
  const source =
      fs.readFileSync("src/lib/account-export.server.ts", "utf8") + "\nexport { collectFiles };",
    exports = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, (name) => {
    assert.ok(modules[name], name);
    return modules[name];
  });
  return { calls, original, ...exports };
}
test("account export embeds the original private document bytes from the correct bucket and exports attempt metadata", async () => {
  const state = loader(),
    path = `${owner}/${gen}.pdf`;
  const files = await state.collectFiles(
    exportPagination.createAccountExportReadBudget(exportPolicy.ACCOUNT_EXPORT_MAX_BYTES),
    {
      user_library_items: [
        {
          user_id: owner,
          file_url: path,
          file_type: "application/pdf",
          metadata: { file_bucket: "library-files", storage_generation: gen },
        },
      ],
    },
  );
  assert.deepEqual(state.calls, [{ bucket: "library-files", path }]);
  assert.equal(files.length, 1);
  assert.equal(files[0].bucket, "library-files");
  assert.ok(
    Object.values(files[0]).some(
      (value) =>
        typeof value === "string" && value === Buffer.from(state.original).toString("base64"),
    ),
  );
  assert.ok(
    exportPolicy.ACCOUNT_EXPORT_DIRECT_TABLES.some(
      ([table, ownerKey]) => table === "library_file_uploads" && ownerKey === "owner_id",
    ),
  );
});
test("a mismatched owner/generation in original-file export metadata fails before any storage download", async () => {
  const state = loader();
  await assert.rejects(
    state.collectFiles(
      exportPagination.createAccountExportReadBudget(exportPolicy.ACCOUNT_EXPORT_MAX_BYTES),
      {
        user_library_items: [
          {
            user_id: owner,
            file_url: `${gen}/${gen}.pdf`,
            metadata: { file_bucket: "library-files", storage_generation: gen },
          },
        ],
      },
    ),
    /file_reference_invalid/,
  );
  assert.equal(state.calls.length, 0);
});

test("account export includes immutable historical originals and rejects foreign history bindings before reading bytes", async () => {
  const state = loader(),
    path = `${owner}/${gen}.pdf`;
  const files = await state.collectFiles(
    exportPagination.createAccountExportReadBudget(exportPolicy.ACCOUNT_EXPORT_MAX_BYTES),
    {
      library_file_versions: [
        {
          owner_id: owner,
          generation: gen,
          storage_path: path,
          mime_type: "application/pdf",
          state: "ready",
          delete_requested: false,
        },
      ],
    },
  );
  assert.equal(files.length, 1);
  assert.deepEqual(state.calls, [{ bucket: "library-files", path }]);
  assert.ok(
    exportPolicy.ACCOUNT_EXPORT_DIRECT_TABLES.some(
      ([table, key]) => table === "library_text_versions" && key === "owner_id",
    ),
  );
  const invalid = loader();
  await assert.rejects(
    invalid.collectFiles(
      exportPagination.createAccountExportReadBudget(exportPolicy.ACCOUNT_EXPORT_MAX_BYTES),
      {
        library_file_versions: [
          { owner_id: owner, generation: gen, storage_path: `${gen}/${gen}.pdf`, state: "ready" },
        ],
      },
    ),
    /file_reference_invalid/,
  );
  assert.equal(invalid.calls.length, 0);
  const retired = loader();
  assert.deepEqual(
    await retired.collectFiles(
      exportPagination.createAccountExportReadBudget(exportPolicy.ACCOUNT_EXPORT_MAX_BYTES),
      {
        library_file_versions: [
          { owner_id: owner, generation: gen, storage_path: path, state: "deleting" },
        ],
      },
    ),
    [],
  );
  assert.equal(retired.calls.length, 0);
});
