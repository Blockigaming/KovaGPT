import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectDeletionError,
  assertProjectStoragePath,
  purgeProjectStorageFolder,
  purgeProjectUploadAttemptFolder,
} from "../../src/lib/project-deletion-policy.mjs";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";

class FakeProjectStorage {
  constructor(paths, { removeErrorOnce = null } = {}) {
    this.paths = new Set(paths);
    this.removeErrorOnce = removeErrorOnce;
    this.removed = [];
  }

  async list(folder, { limit, offset }) {
    const prefix = `${folder}/`;
    const children = new Map();
    for (const path of this.paths) {
      if (!path.startsWith(prefix)) continue;
      const remainder = path.slice(prefix.length);
      const slash = remainder.indexOf("/");
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      children.set(name, slash === -1 ? { id: path, name } : { id: null, name });
    }
    const data = [...children.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(offset, offset + limit);
    return { data, error: null };
  }

  async remove(paths) {
    this.removed.push([...paths]);
    if (this.removeErrorOnce) {
      const error = this.removeErrorOnce;
      this.removeErrorOnce = null;
      return { data: null, error };
    }
    for (const path of paths) this.paths.delete(path);
    return { data: paths, error: null };
  }
}

test("project paths require an exact UUID folder and reject traversal", () => {
  assert.equal(
    assertProjectStoragePath(PROJECT_ID, `${PROJECT_ID}/nested/report.md`),
    `${PROJECT_ID}/nested/report.md`,
  );
  for (const unsafe of [
    `${OTHER_ID}/report.md`,
    `${PROJECT_ID}/../${OTHER_ID}/report.md`,
    `${PROJECT_ID}/nested//report.md`,
    `${PROJECT_ID}2/report.md`,
  ]) {
    assert.throws(
      () => assertProjectStoragePath(PROJECT_ID, unsafe),
      (error) =>
        error instanceof ProjectDeletionError && error.code === "project_file_path_invalid",
    );
  }
});

test("bounded cleanup removes direct and nested objects without crossing prefixes", async () => {
  const ownPaths = [
    ...Array.from({ length: 117 }, (_, index) => `${PROJECT_ID}/file-${index}.txt`),
    `${PROJECT_ID}/nested/report.md`,
    `${PROJECT_ID}/nested/deeper/chart.csv`,
  ];
  const otherPath = `${OTHER_ID}/must-remain.txt`;
  const storage = new FakeProjectStorage([...ownPaths, otherPath]);
  const progress = [];

  const result = await purgeProjectStorageFolder({
    storage,
    projectId: PROJECT_ID,
    maxObjects: 200,
    onProgress: async (event) => progress.push(event.removedCount),
  });

  assert.deepEqual(result, { complete: true, removedCount: ownPaths.length });
  assert.deepEqual([...storage.paths], [otherPath]);
  assert.ok(progress.length >= 3);
});

test("cleanup fails closed on a remove error and a later attempt resumes", async () => {
  const paths = [`${PROJECT_ID}/one.txt`, `${PROJECT_ID}/two.txt`];
  const storage = new FakeProjectStorage(paths, {
    removeErrorOnce: { statusCode: 503, code: "service_unavailable" },
  });

  await assert.rejects(
    purgeProjectStorageFolder({ storage, projectId: PROJECT_ID }),
    (error) =>
      error instanceof ProjectDeletionError && error.code === "project_storage_remove_failed",
  );
  assert.equal(storage.paths.size, 2);

  const retry = await purgeProjectStorageFolder({ storage, projectId: PROJECT_ID });
  assert.equal(retry.removedCount, 2);
  assert.equal(storage.paths.size, 0);
});

test("per-attempt object cap is resumable instead of deleting metadata early", async () => {
  const storage = new FakeProjectStorage([
    `${PROJECT_ID}/one.txt`,
    `${PROJECT_ID}/two.txt`,
    `${PROJECT_ID}/three.txt`,
  ]);

  await assert.rejects(
    purgeProjectStorageFolder({ storage, projectId: PROJECT_ID, maxObjects: 2 }),
    (error) =>
      error instanceof ProjectDeletionError &&
      error.code === "project_storage_cleanup_incomplete" &&
      error.retryAfter === 2,
  );
  assert.equal(storage.paths.size, 1);

  const retry = await purgeProjectStorageFolder({
    storage,
    projectId: PROJECT_ID,
    maxObjects: 2,
  });
  assert.equal(retry.removedCount, 1);
  assert.equal(storage.paths.size, 0);
});

test("malicious Storage listings cannot widen deletion scope", async () => {
  let removeCalled = false;
  const storage = {
    async list() {
      return { data: [{ id: "object-id", name: "../foreign.txt" }], error: null };
    },
    async remove() {
      removeCalled = true;
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    purgeProjectStorageFolder({ storage, projectId: PROJECT_ID }),
    (error) =>
      error instanceof ProjectDeletionError && error.code === "project_storage_listing_invalid",
  );
  assert.equal(removeCalled, false);
});

test("a confirmed missing object is an idempotent removal success", async () => {
  const path = `${PROJECT_ID}/already-gone.txt`;
  const storage = new FakeProjectStorage([path]);
  storage.remove = async (paths) => {
    for (const item of paths) storage.paths.delete(item);
    return { data: null, error: { statusCode: 404, code: "not_found" } };
  };

  const result = await purgeProjectStorageFolder({ storage, projectId: PROJECT_ID });
  assert.equal(result.removedCount, 1);
  assert.equal(storage.paths.size, 0);
});

test("stale upload cleanup is bounded to one exact file attempt folder", async () => {
  const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const siblingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const own = [
    `${PROJECT_ID}/.uploads/${fileId}/attempt-one.txt`,
    `${PROJECT_ID}/.uploads/${fileId}/attempt-two.txt`,
  ];
  const sibling = `${PROJECT_ID}/.uploads/${siblingId}/must-remain.txt`;
  const canonical = `${PROJECT_ID}/${fileId}.txt`;
  const storage = new FakeProjectStorage([...own, sibling, canonical]);

  const result = await purgeProjectUploadAttemptFolder({
    storage,
    projectId: PROJECT_ID,
    fileId,
  });

  assert.deepEqual(result, { complete: true, removedCount: 2 });
  assert.deepEqual(new Set(storage.paths), new Set([sibling, canonical]));
});

test("stale upload cleanup fails closed on nested or malicious listings", async () => {
  const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let removeCalled = false;
  const storage = {
    async list() {
      return { data: [{ id: null, name: "unexpected-folder" }], error: null };
    },
    async remove() {
      removeCalled = true;
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    purgeProjectUploadAttemptFolder({ storage, projectId: PROJECT_ID, fileId }),
    (error) =>
      error instanceof ProjectDeletionError &&
      error.code === "project_upload_cleanup_listing_invalid",
  );
  assert.equal(removeCalled, false);
});

test("stale upload cleanup stops at its per-pass cap and resumes safely", async () => {
  const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const storage = new FakeProjectStorage([
    `${PROJECT_ID}/.uploads/${fileId}/one.txt`,
    `${PROJECT_ID}/.uploads/${fileId}/two.txt`,
    `${PROJECT_ID}/.uploads/${fileId}/three.txt`,
  ]);

  await assert.rejects(
    purgeProjectUploadAttemptFolder({
      storage,
      projectId: PROJECT_ID,
      fileId,
      maxObjects: 2,
    }),
    (error) =>
      error instanceof ProjectDeletionError && error.code === "project_upload_cleanup_incomplete",
  );
  assert.equal(storage.paths.size, 1);

  const retry = await purgeProjectUploadAttemptFolder({
    storage,
    projectId: PROJECT_ID,
    fileId,
    maxObjects: 2,
  });
  assert.equal(retry.removedCount, 1);
  assert.equal(storage.paths.size, 0);
});

test("valid deeply nested legacy objects remain deletable", async () => {
  const path = `${PROJECT_ID}/${Array(40).fill("nested").join("/")}/legacy.txt`;
  const storage = new FakeProjectStorage([path]);
  const result = await purgeProjectStorageFolder({ storage, projectId: PROJECT_ID });
  assert.deepEqual(result, { complete: true, removedCount: 1 });
  assert.equal(storage.paths.size, 0);
});

test("cleanup pages beyond preserved direct and nested source objects", async () => {
  const keep = new Set([`${PROJECT_ID}/a-retained.txt`, `${PROJECT_ID}/nested/a-retained.txt`]);
  const removable = [
    `${PROJECT_ID}/b-remove.txt`,
    `${PROJECT_ID}/nested/b-remove.txt`,
    `${PROJECT_ID}/z-remove.txt`,
  ];
  const storage = new FakeProjectStorage([...keep, ...removable]);
  const result = await purgeProjectStorageFolder({
    storage,
    projectId: PROJECT_ID,
    protectedPaths: async (paths) => new Set(paths.filter((path) => keep.has(path))),
  });
  assert.deepEqual(result, { complete: true, removedCount: 3 });
  assert.deepEqual(storage.paths, keep);
});
