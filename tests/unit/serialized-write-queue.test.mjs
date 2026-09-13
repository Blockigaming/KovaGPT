import assert from "node:assert/strict";
import test from "node:test";

import { createSerializedWriteQueue } from "../../src/lib/serialized-write-queue.ts";

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
