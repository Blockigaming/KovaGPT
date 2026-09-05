import test from "node:test";
import assert from "node:assert/strict";
import * as sync from "../../src/lib/work-sync-state.ts";
import { createWorkSession } from "../../src/lib/work-session.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "99999999-9999-4999-8999-999999999999";
const id = "22222222-2222-4222-8222-222222222222";
const mutation = "33333333-3333-4333-8333-333333333333";
const anotherMutation = "44444444-4444-4444-8444-444444444444";
const date = "2026-09-04T20:00:00.000Z";
const task = (objective = "My plan") => ({
  id,
  objective,
  context: "Context",
  steps: [],
  deliverables: [],
  status: "planning",
  createdAt: 1,
  updatedAt: 1,
});
const initial = (tasks = []) =>
  sync.createWorkSyncState(owner, { task: tasks, template: [], agent_draft: [] });
const record = (payload = task(), revision = 1, version = 1) => ({
  id,
  kind: "task",
  title: payload.objective,
  payload,
  revision,
  syncVersion: version,
  deletedAt: null,
  updatedAt: date,
});
const page = (records, recentItems = [], cursor = 1, current = cursor) => ({
  savedRecords: records,
  recentItems,
  nextCursor: cursor,
  currentVersion: current,
  hasMore: cursor < current,
});
const ack = (revision = 1, version = 1) => ({
  result: { id, kind: "task", revision, syncVersion: version, deletedAt: null, updatedAt: date },
});
function harness(start, request, pull = false) {
  let state = structuredClone(start),
    alive = true;
  return {
    options: {
      load: () => structuredClone(state),
      save: (next) => {
        state = structuredClone(next);
      },
      request,
      pull,
      alive: () => alive,
      mutationId: () => mutation,
    },
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    stop() {
      alive = false;
    },
  };
}

test("migration stays account scoped and retains local data until acknowledged", () => {
  const state = initial([task()]);
  assert.deepEqual(sync.visibleWorkRecords(state, "task"), [task()]);
  assert.equal(state.pending[id].expectedRevision, 0);
  assert.notEqual(sync.workSyncStorageKey(owner), sync.workSyncStorageKey(otherOwner));
  assert.throws(
    () => sync.createWorkSyncState("guest", { task: [], template: [], agent_draft: [] }),
    /principal_invalid/,
  );
  assert.throws(
    () => sync.readWorkSyncState({ getItem: () => JSON.stringify(state) }, otherOwner),
    /local_state_invalid/,
  );
});

test("offline retry reuses its persisted exact mutation after reload", async () => {
  const requests = [];
  const h = harness(initial([task()]), async (_, body) => {
    requests.push(body);
    throw new Error("offline");
  });
  await assert.rejects(sync.synchronizeWorkTurn(h.options), /offline/);
  assert.equal(h.state.pending[id].request.mutationId, mutation);
  const reloaded = harness(JSON.parse(JSON.stringify(h.state)), async (_, body) => {
    requests.push(body);
    return ack();
  });
  reloaded.options.mutationId = () => anotherMutation;
  await sync.synchronizeWorkTurn(reloaded.options);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(Object.keys(reloaded.state.pending).length, 0);
  assert.deepEqual(sync.visibleWorkRecords(reloaded.state, "task"), [task()]);
});

test("edits during an outstanding write survive its acknowledgment", async () => {
  let reply;
  const h = harness(
    initial([task("first")]),
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const sending = sync.synchronizeWorkTurn(h.options);
  await Promise.resolve();
  h.state = sync.replaceLocalWork(h.state, "task", [task("second")]);
  reply(ack());
  await sending;
  assert.equal(h.state.pending[id].desired.objective, "second");
  assert.equal(h.state.pending[id].expectedRevision, 1);
  assert.equal(h.state.pending[id].request, undefined);
  assert.equal(sync.visibleWorkRecords(h.state, "task")[0].objective, "second");
});

test("late responses cannot write after account switch or logout", async () => {
  let reply;
  const h = harness(
    initial(),
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    true,
  );
  const sending = sync.synchronizeWorkTurn(h.options);
  await Promise.resolve();
  h.stop();
  reply(page([record()]));
  await assert.rejects(sending, /identity_changed/);
  assert.equal(h.state.cursor, 0);
  assert.deepEqual(h.state.records, {});
});

test("remote changes never overwrite divergent local work without a conflict choice", () => {
  const local = initial([task("device")]);
  const conflict = sync.applyWorkSyncPage(local, page([record(task("account"))]));
  assert.equal(conflict.pending[id].conflict, true);
  assert.equal(sync.visibleWorkRecords(conflict, "task")[0].objective, "device");
  assert.throws(() => sync.prepareWorkMutation(conflict, id, mutation), /conflict/);
  const account = sync.resolveWorkConflict(conflict, id, "account");
  assert.equal(sync.visibleWorkRecords(account, "task")[0].objective, "account");
  const device = sync.resolveWorkConflict(conflict, id, "device");
  assert.equal(device.pending[id].expectedRevision, 1);
  assert.equal(device.pending[id].request, undefined);
});

test("server conflict preserves the queued copy and stops automatic writes", async () => {
  const h = harness(initial([task()]), async () => {
    throw new Error("work_sync_conflict");
  });
  await assert.rejects(sync.synchronizeWorkTurn(h.options), /conflict/);
  assert.equal(h.state.pending[id].conflict, true);
  let sends = 0;
  h.options.request = async () => {
    sends++;
  };
  await sync.synchronizeWorkTurn(h.options);
  assert.equal(sends, 0);
  assert.equal(sync.visibleWorkRecords(h.state, "task").length, 1);
});

test("a remote tombstone removes only the corresponding unmodified local view", () => {
  const first = sync.applyWorkSyncPage(initial(), page([record()]));
  const tombstone = { ...record({}, 2, 2), payload: {}, deletedAt: date, title: "" };
  assert.equal(
    sync.visibleWorkRecords(sync.applyWorkSyncPage(first, page([tombstone], [], 2)), "task").length,
    0,
  );
  const edited = sync.replaceLocalWork(first, "task", [task("device edit")]);
  const conflicted = sync.applyWorkSyncPage(edited, page([tombstone], [], 2));
  assert.equal(conflicted.pending[id].conflict, true);
  assert.equal(sync.visibleWorkRecords(conflicted, "task")[0].objective, "device edit");
});

test("saved and Recent pages apply atomically and continue from their durable cursor", async () => {
  const recent = {
    resourceType: "task",
    resourceId: id,
    pinnedAt: null,
    lastOpenedAt: date,
    revision: 1,
    syncVersion: 2,
    deletedAt: null,
  };
  const calls = [];
  const h = harness(
    initial(),
    async (path) => {
      calls.push(path);
      return calls.length === 1 ? page([record()], [], 1, 2) : page([], [recent], 2);
    },
    true,
  );
  await sync.synchronizeWorkTurn(h.options);
  assert.match(calls[0], /cursor=0/);
  assert.match(calls[1], /cursor=1/);
  assert.equal(h.state.cursor, 2);
  assert.equal(Object.keys(h.state.records).length, 1);
  assert.equal(Object.keys(h.state.recents).length, 1);
});

test("failed durable persistence prevents network mutations", async () => {
  let sends = 0;
  const h = harness(initial([task()]), async () => {
    sends++;
    return ack();
  });
  h.options.save = () => {
    throw new Error("quota full");
  };
  await assert.rejects(sync.synchronizeWorkTurn(h.options), /quota full/);
  assert.equal(sends, 0);
});

test("invalid payload or cursor cannot advance the stored cursor", () => {
  const state = initial();
  assert.throws(
    () => sync.applyWorkSyncPage(state, page([record({ id, objective: "missing fields" })])),
    /record_invalid/,
  );
  assert.throws(() => sync.applyWorkSyncPage(state, page([record()], [], 9)), /cursor_invalid/);
  assert.throws(() => sync.applyWorkSyncPage(state, page([], [], 4)), /cursor_invalid/);
  assert.equal(state.cursor, 0);
});

test("discarding an unsent local creation does not issue a remote delete", () => {
  const state = sync.replaceLocalWork(initial([task()]), "task", []);
  assert.equal(Object.keys(state.pending).length, 0);
  assert.deepEqual(sync.visibleWorkRecords(state, "task"), []);
});

test("Recent mutations consume the compact server receipt and retain newer intent", () => {
  const started = sync.applyWorkSyncPage(initial(), page([record()]));
  let state = sync.queueWorkRecent(started, "task", id, "keep");
  const key = `recent:task:${id}`;
  state = sync.prepareWorkMutation(state, key, mutation);
  state = sync.queueWorkRecent(state, "task", id, "pin");
  state = sync.settleWorkMutation(state, key, mutation, {
    result: {
      resourceType: "task",
      resourceId: id,
      revision: 1,
      syncVersion: 2,
      pinnedAt: null,
      deletedAt: null,
      updatedAt: date,
    },
  });
  assert.equal(state.recents[key].lastOpenedAt, date);
  assert.equal(state.pending[key].desired, "pin");
  assert.equal(state.pending[key].expectedRevision, 1);
});

test("stale tab cleanup cannot clear the new account's write lease", () => {
  sync.setWorkSyncWritableOwner(owner);
  sync.setWorkSyncWritableOwner(otherOwner);
  sync.setWorkSyncWritableOwner(null, owner);
  assert.doesNotThrow(() => sync.assertWorkSyncWritable(otherOwner));
  assert.throws(() => sync.assertWorkSyncWritable(owner), /another tab/);
  sync.setWorkSyncWritableOwner(null, otherOwner);
});

test("equivalent PostgreSQL JSON key ordering does not create a false conflict", () => {
  const payload = task();
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  const state = sync.applyWorkSyncPage(initial([payload]), page([record(reordered)]));
  assert.deepEqual(state.pending, {});
});

test("migration refuses colliding IDs across saved kinds without dropping either original", () => {
  const tasks = [task()];
  const templates = [
    { id, name: "Template", objective: "Different body", context: "", plan: [], updatedAt: 1 },
  ];
  assert.throws(
    () => sync.createWorkSyncState(owner, { task: tasks, template: templates, agent_draft: [] }),
    /kind_conflict/,
  );
  assert.equal(tasks[0].objective, "My plan");
  assert.equal(templates[0].objective, "Different body");
});

test("a stale receipt cannot revert a newer remote revision", () => {
  let state = sync.prepareWorkMutation(initial([task("original")]), id, mutation);
  state = sync.applyWorkSyncPage(state, page([record(task("newer remote"), 2, 2)], [], 2));
  state = sync.settleWorkMutation(state, id, mutation, ack(1, 1));
  assert.equal(sync.visibleWorkRecords(state, "task")[0].objective, "newer remote");
  assert.equal(state.records[id].revision, 2);
});

test("a fresh device pulls session recents and saved records across the durable cursor", async () => {
  const session = createWorkSession({
    objective: "Prepare launch",
    plan: ["Review release evidence"],
  });
  const savedSession = {
    id: session.id,
    kind: "session",
    title: session.objective,
    payload: session,
    revision: 1,
    syncVersion: 1,
    deletedAt: null,
  };
  const recentSession = {
    resourceType: "session",
    resourceId: session.id,
    pinnedAt: date,
    lastOpenedAt: date,
    revision: 1,
    syncVersion: 2,
    deletedAt: null,
  };
  const calls = [];
  const h = harness(
    initial(),
    async (path) => {
      calls.push(path);
      return calls.length === 1
        ? page([savedSession], [recentSession], 2, 3)
        : page([record(task(), 1, 3)], [], 3);
    },
    true,
  );
  await sync.synchronizeWorkTurn(h.options);
  assert.match(calls[0], /cursor=0/);
  assert.match(calls[1], /cursor=2/);
  assert.equal(h.state.cursor, 3);
  assert.deepEqual(sync.visibleWorkRecords(h.state, "session"), [session]);
  assert.deepEqual(sync.visibleWorkRecords(h.state, "task"), [task()]);
  assert.deepEqual(h.state.recents[`recent:session:${session.id}`], recentSession);
  assert.equal(h.state.pending[session.id], undefined);
  assert.throws(
    () =>
      sync.applyWorkSyncPage(
        initial(),
        page([], [{ ...recentSession, resourceType: "unknown" }], 2),
      ),
    /recent_invalid/,
  );
});
