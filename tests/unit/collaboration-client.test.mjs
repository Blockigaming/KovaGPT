import assert from "node:assert/strict";
import test from "node:test";
import {
  CollaborationError,
  createCollaborationClient,
  createCollaborationLifecycle,
  mergeCanvasComments,
  mergeCanvasSnapshot,
  resolveCommentAnchor,
} from "../../src/lib/collaboration-client.mjs";
const config = { url: "https://project.supabase.co", publishableKey: "public-test-key" };
const session = (id = "alice") => ({
  data: { session: { user: { id }, access_token: `token-${id}` } },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function clock() {
  let id = 0;
  const tasks = new Map();
  return {
    tasks,
    schedule: (fn, delay) => {
      tasks.set(++id, { fn, delay });
      return id;
    },
    unschedule: (id) => tasks.delete(id),
    async fire(delay) {
      const found = [...tasks].find(([, job]) => job.delay === delay);
      assert.ok(found, `timer ${delay} exists`);
      tasks.delete(found[0]);
      found[1].fn();
      await flush();
    },
  };
}
function lifecycle(overrides = {}) {
  const c = clock(),
    events = {
      refresh: 0,
      heartbeats: [],
      leave: [],
      peers: [],
      status: [],
      denied: 0,
      unsubscribed: 0,
    };
  let invalidate, status;
  const stop = createCollaborationLifecycle({
    schedule: c.schedule,
    unschedule: c.unschedule,
    refresh: async () => {
      events.refresh++;
    },
    heartbeat: async (sequence) => {
      events.heartbeats.push(sequence);
      return { peers: 2 };
    },
    leave: async (sequence) => {
      events.leave.push(sequence);
    },
    subscribe: (i, s) => {
      invalidate = i;
      status = s;
      return () => events.unsubscribed++;
    },
    onStatus: (value) => events.status.push(value),
    onPeers: (value) => events.peers.push(value),
    onDenied: () => events.denied++,
    ...overrides,
  });
  return { c, events, stop, invalidate: () => invalidate(), status: (value) => status(value) };
}
test("requests pin the verified actor token and refuse switched or expired sessions", async () => {
  let calls = 0,
    headers;
  let current = session();
  const request = createCollaborationClient({
    config,
    getSession: async () => current,
    fetchImpl: async (url, init) => {
      calls++;
      headers = init.headers;
      assert.equal(url, `${config.url}/rest/v1/rpc/collaboration_rpc`);
      current = session("bob");
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(await request("alice", "get", { documentId: "id" }), { ok: true });
  assert.equal(headers.Authorization, "Bearer token-alice");
  assert.equal(headers.apikey, config.publishableKey);
  await assert.rejects(request("alice", "save", {}), { code: "42501" });
  current = { data: { session: null } };
  await assert.rejects(request("alice", "get", {}), { code: "42501" });
  assert.equal(calls, 1);
});
test("aborted requests do not dispatch and errors never expose database details", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const request = createCollaborationClient({
    config,
    getSession: async () => session(),
    fetchImpl: async () => {
      calls++;
      return Response.json({ code: "40001", message: "secret SQL details" }, { status: 409 });
    },
  });
  await assert.rejects(request("alice", "get", {}, controller.signal));
  assert.equal(calls, 0);
  await assert.rejects(
    request("alice", "save", {}),
    (error) => error.code === "40001" && !error.message.includes("secret SQL"),
  );
});
test("bounded response reader cancels oversized streams and rejects malformed JSON", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = createCollaborationClient({
    config,
    getSession: async () => session(),
    fetchImpl: async () => new Response(stream),
  });
  await assert.rejects(request("alice", "get", {}), { code: "too_large" });
  assert.equal(cancelled, true);
  const malformed = createCollaborationClient({
    config,
    getSession: async () => session(),
    fetchImpl: async () => new Response("broken"),
  });
  await assert.rejects(malformed("alice", "get", {}), { code: "unavailable" });
});
test("realtime bursts coalesce without writing presence in response to presence events", async () => {
  const l = lifecycle();
  await flush();
  assert.equal(l.events.refresh, 1);
  assert.deepEqual(l.events.heartbeats, [1]);
  for (let i = 0; i < 100; i++) l.invalidate();
  assert.equal([...l.c.tasks.values()].filter((job) => job.delay === 500).length, 1);
  await l.c.fire(500);
  assert.equal(l.events.refresh, 2);
  assert.deepEqual(l.events.heartbeats, [1]);
  l.status("CHANNEL_ERROR");
  l.status("SUBSCRIBED");
  await l.c.fire(500);
  assert.equal(l.events.refresh, 3);
  assert.deepEqual(l.events.status, ["reconnecting", "connected"]);
  await l.c.fire(15000);
  assert.deepEqual(l.events.heartbeats, [1, 2]);
  l.stop();
  assert.equal(l.events.unsubscribed, 1);
  assert.equal(l.c.tasks.size, 0);
  assert.deepEqual(l.events.leave, [3]);
});
test("revocation terminates subscription, polling and further reads", async () => {
  const l = lifecycle({
    refresh: async () => {
      throw new CollaborationError("42501");
    },
  });
  await flush();
  assert.equal(l.events.denied, 1);
  assert.equal(l.events.unsubscribed, 1);
  assert.equal(l.c.tasks.size, 0);
  const before = l.events.status.length;
  l.invalidate();
  l.status("SUBSCRIBED");
  await flush();
  assert.equal(l.events.status.length, before);
  assert.equal(l.c.tasks.size, 0);
  assert.deepEqual(l.events.peers, [2, 0, 0]);
});
test("late heartbeat from a closed actor cannot refresh or publish presence", async () => {
  let resolve;
  const l = lifecycle({ heartbeat: () => new Promise((r) => (resolve = r)) });
  l.stop();
  resolve({ peers: 9 });
  await flush();
  assert.equal(l.events.refresh, 0);
  assert.deepEqual(l.events.peers, [0]);
  assert.deepEqual(l.events.leave, [2]);
  l.stop();
  assert.equal(l.events.unsubscribed, 1);
});
test("overlapping invalidations cannot fan out reads", async () => {
  let resolve,
    calls = 0;
  const l = lifecycle({
    refresh: async () => {
      calls++;
      if (calls === 1) await new Promise((r) => (resolve = r));
    },
  });
  await flush();
  l.invalidate();
  await l.c.fire(500);
  assert.equal(calls, 1);
  resolve();
  await flush();
  await l.c.fire(500);
  assert.equal(calls, 2);
  l.stop();
});
test("anchors follow unique Unicode context and explicitly flag deleted or ambiguous text", () => {
  const anchor = { revision: 1, start: 4, end: 6, quote: "😀x", prefix: "one ", suffix: " done" };
  assert.deepEqual(resolveCommentAnchor("one 😀x done", anchor), {
    state: "attached",
    start: 4,
    end: 7,
  });
  assert.deepEqual(resolveCommentAnchor("Intro one 😀x done", anchor), {
    state: "moved",
    start: 10,
    end: 13,
  });
  assert.equal(resolveCommentAnchor("one 😀y done", anchor).state, "removed");
  assert.equal(resolveCommentAnchor("one 😀x done one 😀x done", anchor).state, "removed");
  assert.equal(resolveCommentAnchor("anything", null).state, "document");
});
test("comment refresh retains older pages, applies tombstones and keeps stable order", () => {
  const a = { id: "a", created_at: "2026-01-01" },
    b = { id: "b", created_at: "2026-01-01" },
    c = { id: "c", created_at: "2026-02-01" };
  assert.deepEqual(mergeCanvasComments([a, b], [c], []), [c, b, a]);
  assert.deepEqual(mergeCanvasComments([a, b], [c], ["b"]), [c, a]);
  assert.deepEqual(mergeCanvasComments([a], [{ ...a, body: "fresh" }], []), [
    { ...a, body: "fresh" },
  ]);
});

test("presence limits and transient heartbeat failures do not block canonical reads", async () => {
  const l = lifecycle({
    heartbeat: async () => {
      throw new CollaborationError("54000");
    },
  });
  await flush();
  assert.equal(l.events.refresh, 1);
  assert.deepEqual(l.events.peers, [0]);
  assert.equal(l.events.denied, 0);
  await l.c.fire(15000);
  assert.equal(l.events.refresh, 2);
  l.stop();
});

test("comment compaction discards old caches and delayed pages cannot resurrect deleted text", () => {
  const comment = { id: "old", created_at: "2026-01-01", body: "private deleted text" };
  const before = {
    document: { revision: 1, comment_epoch: 0 },
    comments: [comment],
    deletedCommentIds: [],
  };
  const compacted = {
    document: { revision: 1, comment_epoch: 1 },
    comments: [],
    deletedCommentIds: [],
  };
  assert.deepEqual(mergeCanvasSnapshot(before, compacted), compacted);
  assert.deepEqual(mergeCanvasSnapshot(compacted, before), compacted);
  const deleted = { ...before, comments: [], deletedCommentIds: ["old"] };
  assert.deepEqual(mergeCanvasSnapshot(deleted, before).comments, []);
  assert.deepEqual(mergeCanvasSnapshot(deleted, before).deletedCommentIds, ["old"]);
});
