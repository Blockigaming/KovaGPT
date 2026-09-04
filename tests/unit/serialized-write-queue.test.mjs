import assert from "node:assert/strict";
import test from "node:test";

import {
  createSerializedSnapshotQueue,
  createSerializedWriteQueue,
} from "../../src/lib/serialized-write-queue.ts";

test("serialized write queue never starts a newer write before the older write settles", async () => {
  const queue = createSerializedWriteQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return "first";
  });
  const second = queue.enqueue(async () => {
    events.push("second:start");
    events.push("second:end");
    return "second";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("a rejected write does not prevent the next snapshot from being saved", async () => {
  const queue = createSerializedWriteQueue();
  const failed = queue.enqueue(async () => {
    throw new Error("provider unavailable");
  });
  const recovered = queue.enqueue(async () => "latest");

  await assert.rejects(failed, /provider unavailable/u);
  assert.equal(await recovered, "latest");
});

test("snapshot queue preserves an A-B-A revert while B is in flight", async () => {
  const queue = createSerializedSnapshotQueue("A");
  const writes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    await firstGate;
    return snapshot;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["B"]);

  assert.equal(queue.needsEnqueue("A"), true);
  const reverted = queue.enqueue("A", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  assert.equal(queue.needsEnqueue("A"), false);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["B"]);
  releaseFirst();

  assert.deepEqual(await Promise.all([first, reverted]), ["B", "A"]);
  assert.deepEqual(writes, ["B", "A"]);
});

test("snapshot queue coalesces B when the effect owning in-flight B was cancelled", async () => {
  const queue = createSerializedSnapshotQueue("A");
  const writes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    await firstGate;
    return snapshot;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["B"]);

  assert.equal(queue.needsEnqueue("B"), true);
  const reconciled = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["B"]);

  assert.equal(reconciled, first);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, reconciled]), ["B", "B"]);
  assert.deepEqual(writes, ["B"]);
  assert.equal(queue.needsEnqueue("B"), false);
});

test("snapshot queue reuses a completed latest write when reconciliation was delayed", async () => {
  const queue = createSerializedSnapshotQueue("A");
  const writes = [];
  const first = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  assert.equal(await first, "B");

  const reconciled = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  assert.equal(reconciled, first);
  assert.equal(await reconciled, "B");
  assert.deepEqual(writes, ["B"]);
});

test("snapshot queue writes B again after an intervening C was already queued", async () => {
  const queue = createSerializedSnapshotQueue("A");
  const writes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    await firstGate;
    return snapshot;
  });
  const second = queue.enqueue("C", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  const final = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });

  releaseFirst();
  assert.deepEqual(await Promise.all([first, second, final]), ["B", "C", "B"]);
  assert.deepEqual(writes, ["B", "C", "B"]);
  assert.equal(queue.needsEnqueue("B"), false);
});

test("a completed but unacknowledged write remains eligible for UI reconciliation", async () => {
  const queue = createSerializedSnapshotQueue("A");
  const writes = [];
  const persisted = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });

  assert.equal(await persisted, "B");
  assert.equal(queue.needsEnqueue("B"), false);
  assert.equal(queue.needsSync("B"), true);

  const reconciled = queue.enqueue("B", async (snapshot) => {
    writes.push(snapshot);
    return snapshot;
  });
  assert.equal(reconciled, persisted);
  assert.equal(await reconciled, "B");
  queue.acknowledge("B");

  assert.equal(queue.needsSync("B"), false);
  assert.deepEqual(writes, ["B"]);
});

test("a completed write from a previous reset cannot corrupt the new snapshot tracker", async () => {
  const queue = createSerializedSnapshotQueue("old-A");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const stale = queue.enqueue("old-B", async (snapshot) => {
    await gate;
    return snapshot;
  });

  queue.reset("new-A");
  release();
  await stale;
  assert.equal(queue.needsEnqueue("new-A"), false);
});
