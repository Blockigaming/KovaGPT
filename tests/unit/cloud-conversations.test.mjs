import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function reconcile(payload) {
  const output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import { reconcileCloudHistory } from './src/lib/cloud-conversations.ts';
       const input = JSON.parse(process.argv[1]);
       console.log(JSON.stringify(reconcileCloudHistory(input.active, input.archived, input.cloud)));`,
      JSON.stringify(payload),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return JSON.parse(output);
}

const conversation = (id, updatedAt, title = id) => ({
  id,
  title,
  messages: [],
  mode: "instant",
  createdAt: 1,
  updatedAt,
});

test("cloud reconciliation keeps newer device work and queues it for upload", () => {
  const local = conversation("chat-1", 20, "Device edit");
  const cloud = conversation("chat-1", 10, "Older cloud copy");
  const result = reconcile({
    active: [local],
    archived: [],
    cloud: [
      {
        conversation_id: "chat-1",
        payload: cloud,
        archived: false,
        deleted: false,
        client_updated_at: 10,
        server_updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  });
  assert.equal(result.active[0].title, "Device edit");
  assert.equal(result.pending[0].conversation.title, "Device edit");
});

test("cloud reconciliation applies newer remote changes, archives, and tombstones", () => {
  const result = reconcile({
    active: [conversation("deleted", 5), conversation("remote", 5, "Old")],
    archived: [],
    cloud: [
      {
        conversation_id: "deleted",
        payload: null,
        archived: false,
        deleted: true,
        client_updated_at: 8,
        server_updated_at: "2026-01-01T00:00:00Z",
      },
      {
        conversation_id: "remote",
        payload: conversation("remote", 9, "Cloud rename"),
        archived: true,
        deleted: false,
        client_updated_at: 9,
        server_updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  });
  assert.deepEqual(result.active, []);
  assert.equal(result.archived[0].title, "Cloud rename");
  assert.deepEqual(result.pending, []);
});
