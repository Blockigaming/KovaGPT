import assert from "node:assert/strict";
import test from "node:test";

import { clearStoragePrefix } from "../../src/lib/account-storage-cleanup.server.ts";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";

function mockBucket(initialPaths, { removeError = false, sticky = false } = {}) {
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

  assert.equal(await clearStoragePrefix(bucket, USER_ID), 3);
  assert.deepEqual([...bucket.objects], ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/other.png"]);
  assert.deepEqual(bucket.removedBatches.flat().sort(), [
    `${USER_ID}/nested/deeper/three.jpg`,
    `${USER_ID}/nested/two.webp`,
    `${USER_ID}/one.png`,
  ]);
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
