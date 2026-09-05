import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAgentStorageReference,
  resolveProjectFileStorage,
} from "../../src/lib/project-file-storage-policy.mjs";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const DESTINATION_PROJECT = "223e4567-e89b-42d3-a456-426614174000";
const SOURCE_PROJECT = "323e4567-e89b-42d3-a456-426614174000";
const FILE = "423e4567-e89b-42d3-a456-426614174000";
const PROMOTION = "523e4567-e89b-42d3-a456-426614174000";
const DELIVERABLE = "623e4567-e89b-42d3-a456-426614174000";

function association(storageReference) {
  return {
    promotion: {
      id: PROMOTION,
      destination_id: FILE,
      destination_type: "project_file",
      status: "completed",
      project_id: DESTINATION_PROJECT,
      owner_id: OWNER,
      deliverable_id: DELIVERABLE,
    },
    deliverable: {
      id: DELIVERABLE,
      owner_id: OWNER,
      storage_reference: storageReference,
    },
  };
}

test("project file policy resolves a cross-project promoted source", () => {
  const path = `${SOURCE_PROJECT}/source.txt`;
  assert.deepEqual(
    resolveProjectFileStorage(
      {
        id: FILE,
        project_id: DESTINATION_PROJECT,
        uploaded_by: OWNER,
        storage_path: path,
        kind: "agent-deliverable",
      },
      association(`project-files:${path}`),
    ),
    {
      id: FILE,
      bucket: "project-files",
      path,
      source: "promoted",
      sourceProjectId: SOURCE_PROJECT,
      sourceOwnerId: OWNER,
    },
  );
});

test("project file policy resolves promoted agent evidence to its real bucket", () => {
  const path = `${OWNER}/evidence.json`;
  assert.equal(
    resolveProjectFileStorage(
      {
        id: FILE,
        project_id: DESTINATION_PROJECT,
        uploaded_by: OWNER,
        storage_path: path,
        kind: "agent-deliverable",
      },
      association(`agent-evidence:${path}`),
    ).bucket,
    "agent-evidence",
  );
});

test("project file policy rejects promoted paths without authoritative metadata", () => {
  assert.throws(
    () =>
      resolveProjectFileStorage({
        id: FILE,
        project_id: DESTINATION_PROJECT,
        uploaded_by: OWNER,
        storage_path: `${SOURCE_PROJECT}/source.txt`,
        kind: "agent-deliverable",
      }),
    /project_file_storage_reference_invalid/u,
  );
});

test("agent storage references reject unsupported buckets and traversal", () => {
  assert.throws(() => parseAgentStorageReference("public:file.txt"), /reference_invalid/u);
  assert.throws(
    () => parseAgentStorageReference(`project-files:${SOURCE_PROJECT}/../secret.txt`),
    /reference_invalid/u,
  );
});
