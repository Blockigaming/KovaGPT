import assert from "node:assert/strict";
import test from "node:test";
import { loadServerFunctions } from "../helpers/server-function-harness.mjs";
const { listNotifications, markNotificationsRead, deleteNotifications, readNotificationDetails } =
  loadServerFunctions(
    process.env.KOVA_NOTIFICATION_SOURCE ?? "src/lib/notification-center.functions.ts",
  );
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture({ failAgent = false, failMutation = false } = {}) {
  const calls = [];
  const client = {
    from(table) {
      let after = null,
        limit = 0,
        owner = null,
        ids = [],
        mutation = null,
        expiry = false;
      const q = {
        select: (_columns, options) => {
          assert.equal(options?.count, undefined);
          return q;
        },
        eq: (key, value) => {
          if (key === "owner_id") owner = value;
          return q;
        },
        in: (_key, value) => {
          ids = value;
          return q;
        },
        order: () => q,
        limit: (value) => {
          limit = value;
          return q;
        },
        gt: (key, value) => {
          if (key === "id") after = value;
          else expiry = true;
          return q;
        },
        or: () => {
          expiry = true;
          return q;
        },
        update: () => {
          mutation = "read";
          return q;
        },
        delete: () => {
          mutation = "delete";
          return q;
        },
        abortSignal: (signal) => {
          assert.equal(signal.aborted, false);
          return q;
        },
        then(resolve, reject) {
          calls.push({ table, after, limit, owner, ids, mutation, expiry });
          if ((table === "agent_notifications" && failAgent) || (mutation && failMutation))
            return Promise.resolve({
              data: null,
              error: { message: "agent_notifications unavailable" },
            }).then(resolve, reject);
          const rows = mutation
            ? ids.map((id) => ({ id }))
            : Array.from({ length: 50003 }, (_, n) => ({
                id: id(n + 1),
                title: "N",
                type: "scheduled",
                safe_preview: "safe",
                body: "SYNTHETIC_PRIVATE_DETAILS",
                action_url: null,
                read_at: null,
                created_at: "2026-10-12T00:00:00Z",
              }))
                .filter((row) => !after || row.id > after)
                .slice(0, Math.min(limit, 7));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { calls, context: { supabase: client, userId: "actor" } };
}
test("notification sources page independently beyond caps and expose source failure without inventing emptiness", async () => {
  const f = fixture({ failAgent: true });
  let cursor = null;
  for (let page = 0; page < 4; page++) {
    const result = await listNotifications({
      data: { source: "application", cursor },
      context: f.context,
    });
    assert.equal(result.items.length, 7);
    cursor = result.cursor;
  }
  await assert.rejects(
    listNotifications({ data: { source: "agent", cursor: null }, context: f.context }),
    /Agent notifications page could not be loaded/,
  );
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) {
    assert.equal(call.owner, "actor");
    assert.equal(call.limit, 25);
    assert.equal(call.expiry, true);
  }
});
test("read/delete require bounded explicit ids in one source and never suppress a source error", async () => {
  const f = fixture();
  for (const data of [
    { source: "all", ids: [id(1)] },
    { source: "application" },
    { source: "agent", ids: [] },
  ])
    await assert.rejects(markNotificationsRead({ data, context: f.context }));
  assert.equal(f.calls.length, 0);
  const result = await markNotificationsRead({
    data: { source: "agent", ids: [id(1), id(1)] },
    context: f.context,
  });
  assert.deepEqual(Array.from(result.ids), [id(1)]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].table, "agent_notifications");
  assert.equal(f.calls[0].owner, "actor");
  const failed = fixture({ failMutation: true });
  await assert.rejects(
    deleteNotifications({ data: { source: "agent", ids: [id(1)] }, context: failed.context }),
    /could not be confirmed/,
  );
  assert.equal(failed.calls.length, 1);
});

test("agent body is hidden from list previews and only read explicitly through an owned detail request", async () => {
  const f = fixture();
  const page = await listNotifications({
    data: { source: "agent", cursor: null },
    context: f.context,
  });
  assert.ok(
    (Array.isArray(page) ? page : page.items).every(
      (item) => !item.preview.includes("SYNTHETIC_PRIVATE_DETAILS"),
    ),
  );
  const detail = await readNotificationDetails({ data: { id: id(1) }, context: f.context });
  assert.equal(detail.body, "SYNTHETIC_PRIVATE_DETAILS");
  assert.equal(f.calls.at(-1).owner, "actor");
  assert.equal(f.calls.at(-1).limit, 1);
  assert.equal(f.calls.at(-1).expiry, true);
});
