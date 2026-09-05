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
  originalPaths = [],
  originalRemoveError = false,
  projectRows = [],
  promotions = [],
  deliverables = [],
  projectRemoveError = false,
  lifecycleBusy = false,
  lifecycleFinalizeError = false,
  ownedObjects = [],
  ownershipLookupError = false,
  stickyProjectStorage = false,
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
        )
        .concat(ownedObjects.map((entry) => entry.name)),
      {
        removeError: projectRemoveError,
        sticky: stickyProjectStorage,
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
    "library-files": mockBucket(originalPaths, {
      removeError: originalRemoveError,
      onRemove: () => events.push("library-files"),
    }),
    "library-images": mockBucket([`${USER_ID}/saved.png`], {
      onRemove: () => events.push("library-images"),
    }),
  };

  return {
    buckets,
    simulateAuthDeletion(userId) {
      deliverables = deliverables.filter((row) => row.owner_id !== userId);
      promotions = promotions.filter((row) => row.owner_id !== userId);
    },
    storage: {
      from(bucket) {
        return buckets[bucket];
      },
    },
    rpc(name, args) {
      if (
        name === "prepare_library_image_account_deletion" ||
        name === "claim_library_image_cleanup"
      ) {
        const result = {
          data: name === "prepare_library_image_account_deletion" ? true : [],
          error: null,
        };
        const response = Promise.resolve(result);
        response.abortSignal = () => response;
        return response;
      }
      return (async () => {
        if (name === "claim_project_storage_source_cleanup") return { data: [], error: null };
        if (name === "claim_account_retained_source_transfer")
          return { data: { state: "busy" }, error: null };
        if (name === "claim_account_project_file_cleanup") {
          events.push("project-claim");
          if (lifecycleBusy) return { data: { state: "busy" }, error: null };
          const row = rows.find((entry) => entry.id === args.p_file_id);
          row.delete_attempt_id ??= args.p_attempt_id;
          return { data: { ...row, state: "claimed" }, error: null };
        }
        if (name === "finalize_account_project_file_cleanup") {
          events.push("project-finalize");
          if (lifecycleFinalizeError) return { data: null, error: { message: "finalize failed" } };
          rows = rows.filter((entry) => entry.id !== args.p_file_id);
          return { data: { deleted: true }, error: null };
        }
        if (name === "settle_account_project_storage_charges") return { data: true, error: null };
        const { p_owner_id: userId, p_limit: limit } = args;
        assert.equal(name, "list_account_project_storage_objects");
        events.push("project-ownership");
        if (ownershipLookupError) return { data: null, error: { message: "lookup failed" } };
        return {
          data: ownedObjects
            .filter(
              (entry) =>
                entry.owner_id === userId && buckets["project-files"].objects.has(entry.name),
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, limit),
          error: null,
        };
      })();
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
        id: FILE_ID,
        project_id: OTHER_PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "upload",
      },
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

test("later cleanup pages do not make pending promoted destinations look live", async () => {
  const sourcePath = `${PROJECT_ID}/source.txt`;
  const sourceId = "10000000-0000-4000-8000-000000000001";
  const destinationId = "f0000000-0000-4000-8000-000000000001";
  const fixture = promotionFixture({
    fileId: destinationId,
    projectId: OTHER_PROJECT_ID,
    ownerId: USER_ID,
    storageReference: `project-files:${sourcePath}`,
  });
  const fillerRows = Array.from({ length: 999 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    project_id: PROJECT_ID,
    storage_path: `${PROJECT_ID}/filler-${index}.txt`,
    uploaded_by: USER_ID,
    project_owner_id: USER_ID,
    kind: "upload",
  }));
  const client = accountClient({
    promotions: [fixture.promotion],
    deliverables: [fixture.deliverable],
    projectRows: [
      {
        id: sourceId,
        project_id: PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: USER_ID,
        project_owner_id: USER_ID,
        kind: "upload",
      },
      ...fillerRows,
      {
        id: destinationId,
        project_id: OTHER_PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });

  const progress = await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID);
  assert.equal(progress.complete, true);
  assert.equal(progress.removed, 1_003);
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), false);
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

test("account deletion discovers unregistered owned uploads without claiming a collaborator's bytes", async () => {
  const ownPath = `${OTHER_PROJECT_ID}/upload-without-metadata.txt`;
  const otherPath = `${PROJECT_ID}/other-owner.txt`;
  const events = [];
  const client = accountClient({
    events,
    ownedObjects: [
      { name: ownPath, owner_id: USER_ID },
      { name: otherPath, owner_id: OTHER_USER_ID },
    ],
  });
  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 3,
  });
  assert.deepEqual([...client.buckets["project-files"].objects], [otherPath]);
  assert.ok(events.indexOf("project-ownership") < events.indexOf("project-files"));
  assert.ok(events.indexOf("project-files") < events.indexOf("agent-evidence"));
});

test("unregistered upload cleanup makes bounded progress beyond the first page", async () => {
  const client = accountClient({
    ownedObjects: Array.from({ length: 2_001 }, (_, index) => ({
      name: `${PROJECT_ID}/orphan-${String(index).padStart(5, "0")}.txt`,
      owner_id: USER_ID,
    })),
  });
  assert.deepEqual(
    await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID, { maxRemoveBatches: 1 }),
    {
      complete: false,
      removed: 1_000,
    },
  );
  assert.equal(client.buckets["library-images"].objects.size, 1);
  assert.equal(client.buckets["project-files"].objects.size, 1_001);
  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: true,
    removed: 1_003,
  });
  assert.equal(client.buckets["project-files"].objects.size, 0);
});

test("ownership discovery errors fail before evidence and Library are removed", async () => {
  const client = accountClient({ ownershipLookupError: true });
  await assert.rejects(
    () => cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID),
    /ownership_lookup_failed/u,
  );
  assert.equal(client.buckets["library-images"].objects.size, 1);
  assert.equal(client.buckets["agent-evidence"].objects.size, 1);
});

test("unregistered upload cleanup verifies removals and rejects a no-op", async () => {
  const client = accountClient({
    stickyProjectStorage: true,
    ownedObjects: [{ name: `${PROJECT_ID}/orphan.txt`, owner_id: USER_ID }],
  });
  await assert.rejects(
    () => cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID),
    /cleanup_unverified/u,
  );
  assert.equal(client.buckets["library-images"].objects.size, 1);
});

test("an active retained-source transfer leaves source bytes and Library untouched", async () => {
  const path = `${OTHER_PROJECT_ID}/shared-source.txt`;
  const client = accountClient({
    ownedObjects: [{ name: path, owner_id: USER_ID }],
    projectRows: [
      {
        id: FILE_ID,
        project_id: OTHER_PROJECT_ID,
        storage_path: path,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "upload",
      },
    ],
  });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, false);
  assert.equal(client.buckets["project-files"].objects.has(path), true);
  assert.equal(client.buckets["library-images"].objects.size, 1);
});

test("deleting the last promoted Project reference collects its preserved source bytes", async () => {
  const sourcePath = `${PROJECT_ID}/source.txt`;
  const fixture = promotionFixture({
    fileId: OTHER_FILE_ID,
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
        id: OTHER_FILE_ID,
        project_id: OTHER_PROJECT_ID,
        storage_path: sourcePath,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), true);
  client.simulateAuthDeletion(USER_ID);
  assert.equal(
    (await cleanupOwnedStorageBeforeAccountDeletion(client, OTHER_USER_ID)).complete,
    true,
  );
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), false);
});

test("deleting one promoted destination preserves a source needed by another promoted destination", async () => {
  const sourcePath = `${OTHER_PROJECT_ID}/retained.txt`;
  const deleting = promotionFixture({
    fileId: FILE_ID,
    projectId: PROJECT_ID,
    ownerId: USER_ID,
    storageReference: `project-files:${sourcePath}`,
  });
  const surviving = promotionFixture({
    fileId: OTHER_FILE_ID,
    projectId: OTHER_PROJECT_ID,
    ownerId: OTHER_USER_ID,
    storageReference: `project-files:${sourcePath}`,
    promotionId: "923e4567-e89b-42d3-a456-426614174000",
    deliverableId: "a23e4567-e89b-42d3-a456-426614174000",
  });
  const client = accountClient({
    promotions: [deleting.promotion, surviving.promotion],
    deliverables: [deleting.deliverable, surviving.deliverable],
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        uploaded_by: USER_ID,
        project_owner_id: USER_ID,
        storage_path: sourcePath,
        kind: "agent-deliverable",
      },
      {
        id: OTHER_FILE_ID,
        project_id: OTHER_PROJECT_ID,
        uploaded_by: OTHER_USER_ID,
        project_owner_id: OTHER_USER_ID,
        storage_path: sourcePath,
        kind: "agent-deliverable",
      },
    ],
  });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), true);
  client.simulateAuthDeletion(USER_ID);
  assert.equal(
    (await cleanupOwnedStorageBeforeAccountDeletion(client, OTHER_USER_ID)).complete,
    true,
  );
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), false);
});

test("deleting the final Project reference preserves a collaborator's surviving Work deliverable", async () => {
  const sourcePath = `${OTHER_PROJECT_ID}/retained-work.txt`;
  const fixture = promotionFixture({
    fileId: FILE_ID,
    projectId: PROJECT_ID,
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
        uploaded_by: OTHER_USER_ID,
        project_owner_id: USER_ID,
        kind: "agent-deliverable",
      },
    ],
  });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.equal(client.buckets["project-files"].objects.has(sourcePath), true);
});

test("lifecycle account cleanup reserves before Storage and finalizes instead of direct metadata deletion", async () => {
  const events = [];
  const client = accountClient({
    events,
    projectRows: [
      {
        id: FILE_ID,
        project_id: OTHER_PROJECT_ID,
        project_owner_id: OTHER_USER_ID,
        uploaded_by: USER_ID,
        storage_path: `${OTHER_PROJECT_ID}/lifecycle.txt`,
        kind: "file",
        status: "ready",
      },
    ],
  });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.ok(events.indexOf("project-claim") < events.indexOf("project-files"));
  assert.ok(events.indexOf("project-files") < events.indexOf("project-finalize"));
  assert.ok(events.indexOf("project-finalize") < events.indexOf("library-images"));
  assert.equal(events.includes("project-metadata"), false);
});

test("busy lifecycle rows leave canonical bytes and Library untouched", async () => {
  const path = `${PROJECT_ID}/active.txt`;
  const client = accountClient({
    lifecycleBusy: true,
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        project_owner_id: USER_ID,
        uploaded_by: USER_ID,
        storage_path: path,
        kind: "file",
        status: "pending",
      },
    ],
  });
  assert.deepEqual(await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID), {
    complete: false,
    removed: 0,
  });
  assert.equal(client.buckets["project-files"].objects.has(path), true);
  assert.equal(client.buckets["library-images"].objects.size, 1);
});

test("failed lifecycle finalization preserves a retryable claim and leaves Library untouched", async () => {
  const events = [];
  const client = accountClient({
    events,
    lifecycleFinalizeError: true,
    projectRows: [
      {
        id: FILE_ID,
        project_id: PROJECT_ID,
        project_owner_id: USER_ID,
        uploaded_by: USER_ID,
        storage_path: `${PROJECT_ID}/retry.txt`,
        kind: "file",
        status: "ready",
      },
    ],
  });
  await assert.rejects(
    () => cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID),
    /metadata_cleanup_failed/u,
  );
  assert.equal(events.includes("project-metadata"), false);
  assert.equal(client.buckets["library-images"].objects.size, 1);
});

test("retained-source cleanup processes at most two verified transfers before a bounded retry", async () => {
  const projectRows = Array.from({ length: 3 }, (_, i) => ({
    id: crypto.randomUUID(),
    project_id: OTHER_PROJECT_ID,
    storage_path: `${OTHER_PROJECT_ID}/retained-${i}.txt`,
    uploaded_by: OTHER_USER_ID,
    project_owner_id: OTHER_USER_ID,
    kind: "upload",
  }));
  const oldPaths = projectRows.map((row) => row.storage_path);
  const client = accountClient({
    projectRows,
    ownedObjects: oldPaths.map((name) => ({ name, owner_id: USER_ID })),
  });
  const originalRpc = client.rpc.bind(client);
  const calls = [];
  client.rpc = async (name, args) => {
    if (name !== "claim_account_retained_source_transfer") return originalRpc(name, args);
    calls.push(args.p_source_path);
    // This response represents an earlier completed and verified DB transfer.
    const row = projectRows.find((entry) => entry.storage_path === args.p_source_path);
    row.storage_path = `${OTHER_PROJECT_ID}/${crypto.randomUUID()}.txt`;
    client.buckets["project-files"].objects.add(row.storage_path);
    return { data: { state: "published" }, error: null };
  };
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, false);
  assert.equal(calls.length, 2);
  assert.equal(
    oldPaths.filter((path) => client.buckets["project-files"].objects.has(path)).length,
    1,
  );
  assert.equal(client.buckets["library-images"].objects.size, 1);
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, false);
  assert.equal(calls.length, 3);
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.equal(client.buckets["project-files"].objects.size, 3);
});

test("original document account cleanup removes only the owner prefix and blocks later deletion after a failed removal", async () => {
  const events = [],
    own = `${USER_ID}/original.pdf`,
    other = `${OTHER_USER_ID}/other.pdf`;
  const client = accountClient({ originalPaths: [own, other], events });
  assert.equal((await cleanupOwnedStorageBeforeAccountDeletion(client, USER_ID)).complete, true);
  assert.deepEqual([...client.buckets["library-files"].objects], [other]);
  assert.ok(events.indexOf("library-files") < events.indexOf("library-images"));
  const blocked = accountClient({ originalPaths: [own], originalRemoveError: true });
  await assert.rejects(
    cleanupOwnedStorageBeforeAccountDeletion(blocked, USER_ID),
    /account_storage_remove_failed/,
  );
  assert.equal(blocked.buckets["library-images"].objects.size, 1);
});
