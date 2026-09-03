import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkSyncMutation,
  parseWorkSyncQuery,
  workSyncErrorStatus,
} from "../../src/lib/work-sync-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const mutationId = "22222222-2222-4222-8222-222222222222";

test("saved Work records require exact conflict and idempotency fields", () => {
  assert.deepEqual(
    parseWorkSyncMutation({
      action: "save",
      mutationId,
      id,
      kind: "template",
      title: "  Weekly   review  ",
      payload: { objective: "Review the week" },
      expectedRevision: 0,
    }),
    {
      action: "save",
      mutationId,
      id,
      kind: "template",
      title: "Weekly review",
      payload: { objective: "Review the week" },
      expectedRevision: 0,
    },
  );
  assert.throws(
    () =>
      parseWorkSyncMutation({
        action: "save",
        mutationId,
        id,
        kind: "template",
        title: "Title",
        payload: {},
        expectedRevision: 0,
        ownerId: id,
      }),
    /work_sync_save_invalid/u,
  );
  assert.throws(
    () =>
      parseWorkSyncMutation({
        action: "save",
        mutationId,
        id,
        kind: "template",
        title: "Oversized",
        payload: { content: "x".repeat(96 * 1024) },
        expectedRevision: 0,
      }),
    /work_sync_payload_too_large/u,
  );
});

test("pin changes require a known revision while passive recents do not", () => {
  assert.equal(
    parseWorkSyncMutation({
      action: "recent",
      mutationId,
      resourceType: "run",
      resourceId: id,
      pin: "keep",
    }).expectedRevision,
    null,
  );
  assert.throws(
    () =>
      parseWorkSyncMutation({
        action: "recent",
        mutationId,
        resourceType: "run",
        resourceId: id,
        pin: "pin",
      }),
    /work_sync_revision_invalid/u,
  );
});

test("sync cursors are monotonic bounded integers with no extra parameters", () => {
  assert.deepEqual(parseWorkSyncQuery("https://kovagpt.com/api/work/sync?cursor=12&limit=500"), {
    cursor: 12,
    limit: 500,
  });
  for (const value of [
    "?cursor=-1",
    "?cursor=1.5",
    "?limit=501",
    "?cursor=1&cursor=2",
    "?other=1",
  ]) {
    assert.throws(
      () => parseWorkSyncQuery(`https://kovagpt.com/api/work/sync${value}`),
      /work_sync_query_invalid/u,
    );
  }
});

test("database errors map without exposing SQL messages", () => {
  assert.equal(workSyncErrorStatus("40001"), 409);
  assert.equal(workSyncErrorStatus("P0002"), 404);
  assert.equal(workSyncErrorStatus("22023"), 400);
  assert.equal(workSyncErrorStatus("XX000"), 503);
});
