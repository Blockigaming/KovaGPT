import assert from "node:assert/strict";
import test from "node:test";
import {
  configureMemoryWrites,
  deleteSavedMemoryAfterDraining,
  enqueueMemoryWrite,
  getMemoryWriteCoordinatorState,
  allowMemoryWrites,
  blockMemoryWrites,
  memoryWriteBlockStorageKey,
  resetMemoryWriteCoordinatorForTests,
} from "../../src/lib/memory-write-coordinator.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) {
    return this.#values.get(key) ?? null;
  }
  setItem(key, value) {
    this.#values.set(key, String(value));
  }
  removeItem(key) {
    this.#values.delete(key);
  }
}

class FakeLockManager {
  #tails = new Map();
  request(name, _options, run) {
    const previous = this.#tails.get(name) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => run());
    this.#tails.set(name, task);
    return task;
  }
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true,
  });
  resetMemoryWriteCoordinatorForTests();
});

test("disabled consent and stale principals suppress memory POST work", async () => {
  let calls = 0;
  configureMemoryWrites({ principal: "user-a", enabled: false });
  assert.equal(
    await enqueueMemoryWrite({
      principal: "user-a",
      run: async () => {
        calls += 1;
      },
    }),
    "skipped",
  );

  configureMemoryWrites({ principal: "user-a", enabled: true });
  configureMemoryWrites({ principal: "user-b", enabled: true });
  assert.equal(
    await enqueueMemoryWrite({
      principal: "user-a",
      run: async () => {
        calls += 1;
      },
    }),
    "skipped",
  );
  assert.equal(calls, 0);
});

test("account changes invalidate memory writes queued behind an active write", async () => {
  const order = [];
  let releaseWrite;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseWrite = resolve;
  });

  configureMemoryWrites({ principal: "user-a", enabled: true });
  const activeWrite = enqueueMemoryWrite({
    principal: "user-a",
    run: async () => {
      order.push("active-start");
      markStarted();
      await gate;
      order.push("active-end");
    },
  });
  await started;

  const queuedWrite = enqueueMemoryWrite({
    principal: "user-a",
    run: async () => {
      order.push("stale-write");
    },
  });

  configureMemoryWrites({ principal: "user-b", enabled: false });
  releaseWrite();

  assert.equal(await activeWrite, "written");
  assert.equal(await queuedWrite, "skipped");
  assert.deepEqual(order, ["active-start", "active-end"]);
  assert.deepEqual(getMemoryWriteCoordinatorState(), {
    principal: "user-b",
    enabled: false,
    deleting: null,
    generation: 2,
  });
});

test("a principal-scoped browser block is shared until the user explicitly re-enables memory", async () => {
  const key = memoryWriteBlockStorageKey("user-a");
  assert.equal(key, "kova-memory-write-block-v1:v2:user:user-a");

  configureMemoryWrites({ principal: "user-a", enabled: true });
  blockMemoryWrites("user-a");
  configureMemoryWrites({ principal: "user-a", enabled: true });
  assert.equal(getMemoryWriteCoordinatorState().enabled, false);
  assert.equal(localStorage.getItem(key), "1");

  let calls = 0;
  assert.equal(
    await enqueueMemoryWrite({
      principal: "user-a",
      run: async () => {
        calls += 1;
      },
    }),
    "skipped",
  );

  allowMemoryWrites("user-a");
  configureMemoryWrites({ principal: "user-a", enabled: true });
  assert.equal(
    await enqueueMemoryWrite({
      principal: "user-a",
      run: async () => {
        calls += 1;
      },
    }),
    "written",
  );
  assert.equal(calls, 1);
});

test("privacy deletion waits for an origin-wide lock held by another tab", async () => {
  const lockManager = new FakeLockManager();
  globalThis.navigator.locks = lockManager;
  const order = [];
  let markStarted;
  let releaseExternal;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseExternal = resolve;
  });

  const externalWrite = lockManager.request(
    "kova-memory-write:user-a",
    { mode: "exclusive" },
    async () => {
      order.push("other-tab-write-start");
      markStarted();
      await gate;
      order.push("other-tab-write-end");
    },
  );
  await started;

  configureMemoryWrites({ principal: "user-a", enabled: true });
  const deletion = deleteSavedMemoryAfterDraining({
    principal: "user-a",
    run: async () => {
      order.push("delete");
    },
  });
  await Promise.resolve();
  assert.deepEqual(order, ["other-tab-write-start"]);

  releaseExternal();
  await externalWrite;
  assert.equal(await deletion, "deleted");
  assert.deepEqual(order, ["other-tab-write-start", "other-tab-write-end", "delete"]);
});

test("privacy deletion drains an active write and invalidates queued writes", async () => {
  const order = [];
  let releaseWrite;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseWrite = resolve;
  });

  configureMemoryWrites({ principal: "user-a", enabled: true });
  const activeWrite = enqueueMemoryWrite({
    principal: "user-a",
    run: async () => {
      order.push("write-start");
      markStarted();
      await gate;
      order.push("write-end");
    },
  });
  await started;

  const deletion = deleteSavedMemoryAfterDraining({
    principal: "user-a",
    run: async () => {
      order.push("delete");
    },
  });
  const queuedWrite = enqueueMemoryWrite({
    principal: "user-a",
    run: async () => {
      order.push("stale-write");
    },
  });

  await Promise.resolve();
  assert.deepEqual(order, ["write-start"]);
  releaseWrite();

  assert.equal(await activeWrite, "written");
  assert.equal(await deletion, "deleted");
  assert.equal(await queuedWrite, "skipped");
  assert.deepEqual(order, ["write-start", "write-end", "delete"]);
  assert.equal(getMemoryWriteCoordinatorState().enabled, false);
});

test("a failed DELETE stays visible to the caller and leaves writes blocked", async () => {
  configureMemoryWrites({ principal: "user-a", enabled: true });
  await assert.rejects(
    deleteSavedMemoryAfterDraining({
      principal: "user-a",
      run: async () => {
        throw new Error("delete unavailable");
      },
    }),
    /delete unavailable/,
  );

  let called = false;
  assert.equal(
    await enqueueMemoryWrite({
      principal: "user-a",
      run: async () => {
        called = true;
      },
    }),
    "skipped",
  );
  assert.equal(called, false);
  assert.equal(getMemoryWriteCoordinatorState().enabled, false);
});
