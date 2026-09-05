import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveProjectStorageRows,
  survivingProjectStoragePaths,
} from "../../src/lib/project-storage-references.server.ts";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";
const OTHER = "623e4567-e89b-42d3-a456-426614174000";
const FILE = "723e4567-e89b-42d3-a456-426614174000";
const PROMOTION = "823e4567-e89b-42d3-a456-426614174000";
const DELIVERABLE = "923e4567-e89b-42d3-a456-426614174000";

function client(tables) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        in(column, values) {
          query.column = column;
          query.values = values;
          return query;
        },
        order() {
          return query;
        },
        async range(start, end) {
          return {
            data: (tables[table] ?? [])
              .filter((row) => query.values.includes(row[query.column]))
              .slice(start, end + 1),
            error: null,
          };
        },
      };
      return query;
    },
  };
}

test("surviving canonical and promoted rows preserve exact project sources", async () => {
  const path = `${PROJECT}/source.txt`;
  const row = {
    id: FILE,
    project_id: OTHER,
    uploaded_by: OWNER,
    storage_path: path,
    kind: "agent-deliverable",
  };
  const promotion = {
    id: PROMOTION,
    destination_id: FILE,
    destination_type: "project_file",
    status: "completed",
    project_id: OTHER,
    owner_id: OWNER,
    deliverable_id: DELIVERABLE,
  };
  const deliverable = {
    id: DELIVERABLE,
    owner_id: OWNER,
    storage_reference: `project-files:${path}`,
  };
  const db = client({
    project_files: [row],
    agent_resource_promotions: [promotion],
    agent_deliverables: [deliverable],
  });
  assert.deepEqual(await survivingProjectStoragePaths(db, PROJECT, [path]), new Set([path]));
  assert.deepEqual(await survivingProjectStoragePaths(db, OTHER, [path]), new Set([path]));
  assert.deepEqual(await survivingProjectStoragePaths(db, OTHER, [path], [], OWNER), new Set());
});

test("legacy canonical files remain resolvable after uploader Auth SET NULL", async () => {
  const row = {
    id: FILE,
    project_id: PROJECT,
    uploaded_by: null,
    storage_path: `${PROJECT}/source.txt`,
    kind: "file",
  };
  const db = client({ project_files: [row] });
  assert.equal((await resolveProjectStorageRows(db, [row]))[0].source, "canonical");
  assert.deepEqual(
    await survivingProjectStoragePaths(db, OTHER, [row.storage_path]),
    new Set([row.storage_path]),
  );
});

test("unresolved promoted references fail closed", async () => {
  const row = {
    id: FILE,
    project_id: OTHER,
    uploaded_by: OWNER,
    storage_path: `${PROJECT}/source.txt`,
    kind: "agent-deliverable",
  };
  const db = client({ project_files: [row] });
  await assert.rejects(
    () => survivingProjectStoragePaths(db, PROJECT, [row.storage_path]),
    /reference_invalid/u,
  );
});
