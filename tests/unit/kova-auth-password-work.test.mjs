import assert from "node:assert/strict";
import test from "node:test";
import {
  createKovaPasswordWorkLimiter,
  KovaPasswordCapacityError,
} from "../../src/lib/kova-auth-password-work.server.mjs";

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("password work limits active operations and queue length with FIFO handoff", async () => {
  const run = createKovaPasswordWorkLimiter({ maxActive: 1, maxQueued: 2 });
  const firstGate = gate();
  const entered = [];
  const first = run(async () => {
    entered.push("first");
    await firstGate.promise;
  });
  const second = run(async () => entered.push("second"));
  const third = run(async () => entered.push("third"));
  await assert.rejects(() => run(async () => entered.push("overflow")), KovaPasswordCapacityError);
  assert.deepEqual(entered, ["first"]);
  firstGate.release();
  await Promise.all([first, second, third]);
  assert.deepEqual(entered, ["first", "second", "third"]);
  assert.equal(await run(async () => "recovered"), "recovered");
});

test("password work releases slots after rejection without admitting extra work", async () => {
  const run = createKovaPasswordWorkLimiter({ maxActive: 2, maxQueued: 0 });
  const firstGate = gate();
  const secondGate = gate();
  let active = 0;
  let peak = 0;
  const operation = (wait, fail = false) =>
    run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await wait.promise;
        if (fail) throw new Error("fixture_failure");
      } finally {
        active -= 1;
      }
    });
  const first = operation(firstGate, true);
  const rejected = assert.rejects(first, /fixture_failure/u);
  const second = operation(secondGate);
  await assert.rejects(() => run(async () => "overflow"), KovaPasswordCapacityError);
  firstGate.release();
  await rejected;
  assert.equal(await run(async () => "replacement"), "replacement");
  secondGate.release();
  await second;
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test("password work rejects invalid limiter configuration and operations", async () => {
  for (const limits of [
    { maxActive: 0, maxQueued: 1 },
    { maxActive: 1.5, maxQueued: 1 },
    { maxActive: 1, maxQueued: -1 },
    { maxActive: 1, maxQueued: 1, maxQueueWaitMs: 0 },
  ]) {
    assert.throws(() => createKovaPasswordWorkLimiter(limits), RangeError);
  }
  const run = createKovaPasswordWorkLimiter({ maxActive: 1, maxQueued: 0 });
  await assert.rejects(() => run(null), TypeError);
});

test("expired queue waits do not release a slot occupied by unfinished native work", async () => {
  const run = createKovaPasswordWorkLimiter({
    maxActive: 1,
    maxQueued: 1,
    maxQueueWaitMs: 10,
  });
  const activeGate = gate();
  let expiredOperationRan = false;
  const active = run(async () => activeGate.promise);
  await assert.rejects(
    () =>
      run(async () => {
        expiredOperationRan = true;
      }),
    KovaPasswordCapacityError,
  );
  assert.equal(expiredOperationRan, false);
  const replacement = run(async () => "replacement");
  await assert.rejects(() => run(async () => "overflow"), KovaPasswordCapacityError);
  activeGate.release();
  await active;
  assert.equal(await replacement, "replacement");
});
