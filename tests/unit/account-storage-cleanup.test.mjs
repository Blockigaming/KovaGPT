import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupOwnedStorageBeforeAccountDeletion,
  clearStoragePrefix,
} from "../../src/lib/account-storage-cleanup.server.ts";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = "223e4567-e89b-42d3-a456-426614174000";
const FILE_ID = "323e4567-e89b-42d3-a456-426614174000";
const OTHER_USER_ID = "423e4567-e89b-42d3-a456-426614174000";
const OTHER_PROJECT_ID = "523e4567-e89b-42d3-a456-426614174000";
const OTHER_FILE_ID = "623e4567-e89b-42d3-a456-426614174000";
const PROMOTION_ID = "723e4567-e89b-42d3-a456-426614174000";
const DELIVERABLE_ID = "823e4567-e89b-42d3-a456-426614174000";

function mockBucket(initialPaths, { removeError = false, sticky = false, onRemove } = {}) {
  const objects = new Set(initialPaths);
  const removedBatches = [];
  return {
    objects,
    removedBatches,
    async list(prefix, { limit, offset }) {
      const immediate = new Map();
      for (const path of objects) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        immediate.set(name, slash === -1 ? { id: path, name } : { id: null, name });
      }
      const data = [...immediate.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(offset, offset + limit);
      return { data, error: null };
    },
    async remove(paths) {
      removedBatches.push(paths);
      onRemove?.(paths);
      if (removeError) return { error: { message: "storage unavailable" } };
      if (!sticky) paths.forEach((path) => objects.delete(path));
      return { error: null };
    },
  };
}

test("account cleanup removes and verifies every Library image below the user prefix", async () => {
  const bucket = mockBucket([
    `${USER_ID}/one.png`,
    `${USER_ID}/nested/two.webp`,
    `${USER_ID}/nested/deeper/three.jpg`,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/other.png",
  ]);

  assert.deepEqual(await clearStoragePrefix(bucket, USER_ID), {
    complete: true,
    removed: 3,
  });
  assert.deepEqual([...bucket.objects], ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/other.png"]);
  assert.deepEqual(bucket.removedBatches.flat().sort(), [
    `${USER_ID}/nested/deeper/three.jpg`,
    `${USER_ID}/nested/two.webp`,
    `${USER_ID}/one.png`,
  ]);
});

test("account cleanup advances beyond 10,000 objects across bounded retries", async () => {
  const paths = Array.from(
    { length: 10_001 },
    (_, index) => `${USER_ID}/image-${String(index).padStart(5, "0")}.png`,
  );
  const bucket = mockBucket(paths);

  assert.deepEqual(await clearStoragePrefix(bucket, USER_ID), {
    complete: false,
    removed: 10_000,
  });
  assert.equal(bucket.objects.size, 1);
  assert.deepEqual(await clearStoragePrefix(bucket, USER_ID), {
    complete: true,
    removed: 1,
  });
  assert.equal(bucket.objects.size, 0);
  assert.ok(bucket.removedBatches.every((batch) => batch.length <= 1_000));
});

test("account cleanup fails before metadata/auth deletion when Storage removal fails", async () => {
  const path = `${USER_ID}/one.png`;
  const bucket = mockBucket([path], { removeError: true });
  await assert.rejects(() => clearStoragePrefix(bucket, USER_ID), /account_storage_remove_failed/u);
  assert.deepEqual([...bucket.objects], [path]);
});

test("account cleanup rejects an unverified no-op removal", async () => {
  const bucket = mockBucket([`${USER_ID}/one.png`], { sticky: true });
  await assert.rejects(
    () => clearStoragePrefix(bucket, USER_ID),
    /account_storage_cleanup_unverified/u,
  );
});

test("account cleanup rejects prefixes outside the authenticated user namespace", async () => {
  const bucket = mockBucket([]);
  await assert.rejects(() => clearStoragePrefix(bucket, "../another-user"), /prefix_invalid/u);
});

function promotionFixture({
  fileId,
  projectId,
  ownerId,
  storageReference,
  promotionId = PROMOTION_ID,
  deliverableId = DELIVERABLE_ID,
}) {
  return {
    promotion: {
      id: promotionId,
      destination_id: fileId,
      destination_type: "project_file",
      status: "completed",
      project_id: projectId,
      owner_id: ownerId,
      deliverable_id: deliverableId,
    },
    deliverable: {
      id: deliverableId,
      owner_id: ownerId,
      storage_reference: storageReference,
    },
  };
}

function accountClient({
  projectRows = [],
  promotions = [],
  deliverables = [],
  projectRemoveError = false,
  events = [],
} = {}) {
  let rows = [...projectRows];
  const referencedObjects = deliverables.flatMap((row) => {
    const separator = row.storage_reference.indexOf(":");
    return separator > 0
      ? [
          {
            bucket: row.storage_reference.slice(0, separator),
            path: row.storage_reference.slice(separator + 1),
          },
        ]
      : [];
  });
  const buckets = {
    "project-files": mockBucket(
      rows
        .filter((row) => row.storage_path.startsWith(`${row.project_id}/`))
        .map((row) => row.storage_path)
        .concat(
          referencedObjects
            .filter((entry) => entry.bucket === "project-files")
            .map((entry) => entry.path),
        ),
      {
        removeError: projectRemoveError,
        onRemove: () => events.push("project-files"),
      },
    ),
    "agent-evidence": mockBucket(
      rows
        .filter((row) => row.storage_path.startsWith(`${row.uploaded_by}/`))
        .map((row) => row.storage_path)
        .concat(
          referencedObjects
            .filter((entry) => entry.bucket === "agent-evidence")
            .map((entry) => entry.path),
        )
        .concat([`${USER_ID}/unpromoted.json`]),
      { onRemove: () => events.push("agent-evidence") },
    ),
    "library-images": mockBucket([`${USER_ID}/saved.png`], {
      onRemove: () => events.push("library-images"),
    }),
  };

  return {
    buckets,
    storage: {
      from(bucket) {
        return buckets[bucket];
      },
    },
    from(table) {
      const source =
        table === "project_files"
          ? () => rows
          : table === "agent_resource_promotions"
            ? () => promotions
            : table === "agent_deliverables"
              ? () => deliverables
              : null;
      assert.ok(source, `unexpected table ${table}`);
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          query.column = column;
          query.userId = value;
          return query;
        },
        in(column, values) {
          query.inColumn = column;
          query.inValues = values;
          return query;
        },
        order() {
          return query;
        },
        filtered() {
          return source().filter((row) => {
            const equalityMatches =
              query.column === undefined ||
              (query.column === "projects.owner_id"
                ? row.project_owner_id === query.userId
                : row[query.column] === query.userId);
            const inMatches =
              query.inColumn === undefined || query.inValues.includes(row[query.inColumn]);
            return equalityMatches && inMatches;
          });
        },
        async limit(count) {
          return {
            data: query.filtered().slice(0, count),
            error: null,
          };
        },
        async range(from, to) {
          return { data: query.filtered().slice(from, to + 1), error: null };
        },
        delete() {
          return {
            async in(_column, ids) {
              rows = rows.filter((row) => !ids.includes(row.id));
              events.push("project-metadata");
              return { error: null };
            },
          };
        },
      };
      return query;
    },
  };
}

test("account deletion exhausts Project and agent Storage before touching Library", async () => {
  const events = [];
  const client = accountClient({
    events,
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        storage_path: `${PROJECT_ID}/notes.txt`,
        uploaded_by: USER_ID,
        project_owner_id: USER_ID,
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 3,
  });
  assert.ok(events.indexOf("project-files") < events.indexOf("library-images"));
  assert.ok(events.indexOf("agent-evidence") < events.indexOf("library-images"));
  assert.ok(events.indexOf("project-files") < events.indexOf("project-metadata"));
});

test("account deletion never removes another user's Project objects", async () => {
  const otherPath = `${OTHER_PROJECT_ID}/private.txt`;
  const client = accountClient({
    projectRows: [
      {
        id: OTHER_FILE_ID,
        project_id: OTHER_PROJECT_ID,
        storage_path: otherPath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 2,
  });
  assert.deepEqual([...client.buckets["project-files"].objects], [otherPath]);
});

test("account deletion removes Project-owned files but preserves collaborator evidence references", async () => {
  const canonicalPath = `${PROJECT_ID}/collaborator.txt`;
  const promotedPath = `${OTHER_USER_ID}/promoted.json`;
  const fixture = promotionFixture({
    fileId: "923e4567-e89b-42d3-a456-426614174000",
    projectId: PROJECT_ID,
    ownerId: OTHER_USER_ID,
    storageReference: `agent-evidence:${promotedPath}`,
  });
  const client = accountClient({
    promotions: [fixture.promotion],
    deliverables: [fixture.deliverable],
    projectRows: [
      {
        id: OTHER_FILE_ID,
        project_id: PROJECT_ID,
        storage_path: canonicalPath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: USER_ID,
      },
      {
        id: "923e4567-e89b-42d3-a456-426614174000",
        project_id: PROJECT_ID,
        storage_path: promotedPath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 4,
  });
  assert.equal(client.buckets["project-files"].objects.has(canonicalPath), false);
  assert.equal(client.buckets["agent-evidence"].objects.has(promotedPath), true);
});

test("deleting the evidence owner removes promoted source objects and their Project metadata", async () => {
  const promotedPath = `${USER_ID}/promoted.json`;
  const fixture = promotionFixture({
    fileId: FILE_ID,
    projectId: OTHER_PROJECT_ID,
    ownerId: USER_ID,
    storageReference: `agent-evidence:${promotedPath}`,
  });
  const client = accountClient({
    promotions: [fixture.promotion],
    deliverables: [fixture.deliverable],
    projectRows: [
      {
        id: FILE_ID,
        project_id: OTHER_PROJECT_ID,
        storage_path: promotedPath,
        uploaded_by: USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 4,
  });
  assert.equal(client.buckets["agent-evidence"].objects.has(promotedPath), false);
});

test("deleting a destination Project resolves and preserves a cross-project promoted source", async () => {
  const sourcePath = `${OTHER_PROJECT_ID}/source.txt`;
  const fixture = promotionFixture({
    fileId: OTHER_FILE_ID,
    projectId: PROJECT_ID,
    ownerId: OTHER_USER_ID,
    storageReference: `project-files:${sourcePath}`,
  });
  const client = accountClient({
    promotions: [fixture.promotion],
    deliverables: [fixture.deliverable],
    projectRows: [
      {
        id: OTHER_FILE_ID,
        project_id: PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 3,
  });
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), true);
});

test("deleting a source Project preserves bytes referenced by another live Project", async () => {
  const sourcePath = `${PROJECT_ID}/source.txt`;
  const destinationFileId = OTHER_FILE_ID;
  const fixture = promotionFixture({
    fileId: destinationFileId,
    projectId: OTHER_PROJECT_ID,
    ownerId: OTHER_USER_ID,
    storageReference: `project-files:${sourcePath}`,
  });
  const client = accountClient({
    promotions: [fixture.promotion],
    deliverables: [fixture.deliverable],
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: USER_ID,
        project_owner_id: USER_ID,
        kind: "upload",
      },
      {
        id: destinationFileId,
        project_id: OTHER_PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });

  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 3,
  });
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), true);
});

test("a Project Storage failure leaves Library objects untouched", async () => {
  const events = [];
  const client = accountClient({
    events,
    projectRemoveError: true,
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        storage_path: `${PROJECT_ID}/notes.txt`,
        uploaded_by: USER_ID,
        project_owner_id: USER_ID,
      },
    ],
  });

  await assert.rejects(
    () => cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID),
    /account_project_storage_remove_failed/u,
  );
  assert.deepEqual([...client.buckets["library-images"].objects], [`${USER_ID}/saved.png`]);
  assert.equal(events.includes("project-metadata"), false);
  assert.equal(events.includes("library-images"), false);
});
