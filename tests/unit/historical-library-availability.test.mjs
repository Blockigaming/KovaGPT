import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const output = ts.transpileModule(source(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}
const { createHistoricalLibraryAvailabilityReader, HISTORICAL_LIBRARY_LIMITS: LIMITS } = load(
  "lib/historical-library-availability.ts",
);
const settle = () => new Promise(setImmediate);
function readerFixture(read = null) {
  let time = 1_000,
    timerId = 0;
  const timers = new Map(),
    requests = [];
  const reader = createHistoricalLibraryAvailabilityReader(
    read ??
      ((owner, id, signal) =>
        new Promise((resolve, reject) => requests.push({ owner, id, signal, resolve, reject }))),
    () => time,
    {
      setTimeout(callback, delay) {
        const id = ++timerId;
        timers.set(id, { callback, at: time + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    reader,
    requests,
    timers,
    advance(ms, runTimers = true) {
      time += ms;
      if (!runTimers) return;
      for (const [id, timer] of timers)
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
    },
  };
}

test("a long history is bounded to two physical reads, twelve queued, and no automatic overflow reads", async () => {
  const f = readerFixture();
  f.reader.retainOwner("owner-a");
  const states = new Map();
  for (let i = 0; i < 1_000; i++)
    f.reader.subscribe("owner-a", `id-${i}`, (state) => states.set(i, state));
  await settle();
  assert.equal(f.requests.length, LIMITS.concurrent);
  assert.equal(
    [...states.values()].filter((state) => state === "loading").length,
    LIMITS.concurrent + LIMITS.queued,
  );
  for (let offset = 0; offset < LIMITS.concurrent + LIMITS.queued; offset += 2) {
    f.requests.slice(offset, offset + 2).forEach((request) => request.resolve("available"));
    await settle();
  }
  assert.equal(f.requests.length, LIMITS.concurrent + LIMITS.queued);
  assert.equal([...states.values()].filter((state) => state === "unknown").length, 986);
  assert.ok(f.requests.every((request) => request.owner === "owner-a"));
});

test("same item checks share pending work and fresh cache, and refresh updates duplicate chips", async () => {
  const f = readerFixture();
  f.reader.retainOwner("owner-a");
  let first, second, third;
  f.reader.subscribe("owner-a", "same-id", (state) => (first = state));
  f.reader.subscribe("owner-a", "same-id", (state) => (second = state));
  await settle();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve("unavailable");
  await settle();
  f.reader.subscribe("owner-a", "same-id", (state) => (third = state));
  assert.deepEqual([first, second, third], ["unavailable", "unavailable", "unavailable"]);
  assert.equal(f.requests.length, 1);
  f.reader.subscribe("owner-a", "same-id", (state) => (third = state), true);
  await settle();
  assert.deepEqual([first, second, third], ["loading", "loading", "loading"]);
  f.requests[1].resolve("available");
  await settle();
  assert.deepEqual([first, second, third], ["available", "available", "available"]);
});

test("expired missing state becomes unknown without polling; recreated identity can be rechecked", async () => {
  const f = readerFixture();
  f.reader.retainOwner("owner-a");
  let state;
  f.reader.subscribe("owner-a", "recreated-id", (value) => (state = value));
  await settle();
  f.requests[0].resolve("unavailable");
  await settle();
  assert.equal(state, "unavailable");
  f.advance(LIMITS.cacheMs);
  assert.equal(state, "unknown");
  assert.equal(f.requests.length, 1);
  f.reader.subscribe("owner-a", "recreated-id", (value) => (state = value));
  await settle();
  f.requests[1].resolve("available");
  await settle();
  assert.equal(state, "available");
});

test("cache age is enforced even if background timer delivery is delayed", async () => {
  const f = readerFixture();
  f.reader.retainOwner("owner-a");
  f.reader.subscribe("owner-a", "id", () => {});
  await settle();
  f.requests[0].resolve("available");
  await settle();
  f.advance(LIMITS.cacheMs + 1, false);
  let state;
  f.reader.subscribe("owner-a", "id", (value) => (state = value));
  assert.equal(state, "loading");
  await settle();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve("unavailable");
  await settle();
  assert.equal(state, "unavailable");
});

test("departure drops queued reads and cancelled physical requests retain their concurrency slots", async () => {
  const f = readerFixture();
  f.reader.retainOwner("owner-a");
  const cancel = ["first", "second", "queued"].map((id) =>
    f.reader.subscribe("owner-a", id, () => {}),
  );
  await settle();
  cancel.forEach((stop) => stop());
  assert.ok(f.requests.every((request) => request.signal.aborted));
  f.reader.subscribe("owner-a", "new", () => {});
  await settle();
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve("unavailable");
  f.requests[1].resolve("unavailable");
  await settle();
  assert.deepEqual(
    f.requests.map(({ id }) => id),
    ["first", "second", "new"],
  );
});

test("account switches discard pending/queued/cache results, including A to B to A and stale cleanup", async () => {
  const f = readerFixture();
  const releaseA = f.reader.retainOwner("a");
  let old, current;
  f.reader.subscribe("a", "id", (state) => (old = state));
  await settle();
  const releaseB = f.reader.retainOwner("b");
  assert.equal(old, "unknown");
  assert.ok(f.requests[0].signal.aborted);
  f.reader.subscribe("b", "id", (state) => (current = state));
  await settle();
  releaseA();
  f.requests[0].resolve("unavailable");
  f.requests[1].resolve("available");
  await settle();
  assert.equal(current, "available");
  f.reader.retainOwner("a");
  releaseB();
  f.reader.subscribe("a", "id", (state) => (current = state));
  await settle();
  assert.equal(current, "loading");
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve("unavailable");
  await settle();
  assert.equal(current, "unavailable");
  assert.equal(old, "unknown");
});

test("last unmount and signed-out scopes cannot retain or reuse an account's cache", async () => {
  const f = readerFixture(async () => "available");
  const release = f.reader.retainOwner("a");
  let state;
  f.reader.subscribe("a", "id", (value) => (state = value));
  await settle();
  assert.equal(state, "available");
  release();
  assert.equal(state, "unknown");
  assert.equal(f.timers.size, 0);
  f.reader.subscribe("a", "id", (value) => (state = value));
  assert.equal(state, "unknown");
  f.reader.retainOwner(null);
  f.reader.subscribe("a", "id", (value) => (state = value));
  assert.equal(state, "unknown");
});

test("transport failures and malformed outcomes remain unknown; repeated retries have a shared read budget", async () => {
  let reads = 0;
  const f = readerFixture(async () => {
    reads++;
    if (reads % 2) throw new Error("network failure");
    return undefined;
  });
  f.reader.retainOwner("a");
  let state;
  for (let i = 0; i < 100; i++) {
    const stop = f.reader.subscribe("a", `id-${i}`, (value) => (state = value), true);
    await settle();
    assert.equal(state, "unknown");
    stop();
  }
  assert.equal(reads, LIMITS.readsPerWindow);
  f.reader.retainOwner("b");
  f.reader.subscribe("b", "id", (value) => (state = value));
  await settle();
  assert.equal(reads, LIMITS.readsPerWindow);
  f.advance(LIMITS.windowMs);
  f.reader.subscribe("b", "id", (value) => (state = value), true);
  await settle();
  assert.equal(reads, LIMITS.readsPerWindow + 1);
});

test("settled cache remains bounded even with delayed timers and thousands of requested identities", async () => {
  const f = readerFixture(async () => "available");
  f.reader.retainOwner("a");
  for (let i = 0; i < 1_000; i++) {
    const stop = f.reader.subscribe("a", `id-${i}`, () => {});
    await settle();
    stop();
    assert.ok(f.timers.size <= LIMITS.cached);
  }
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
function clientFixture(result, headersImpl = null) {
  const calls = [];
  const query = {};
  for (const method of ["from", "select", "eq", "abortSignal", "maybeSingle"])
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  query.setHeader = (...args) => {
    calls.push(["setHeader", ...args]);
    return typeof result === "function" ? result() : Promise.resolve(result);
  };
  const { readHistoricalLibraryAvailability } = load(
    "lib/historical-library-availability-client.ts",
    {
      "@/integrations/supabase/client": { supabase: query },
      "./library-original-client": {
        originalLibraryHeaders: async (owner, signal) => {
          calls.push(["owner-check", owner]);
          signal.throwIfAborted();
          return headersImpl
            ? headersImpl(owner, signal)
            : { Authorization: "Bearer owner-session" };
        },
      },
    },
  );
  return { calls, read: readHistoricalLibraryAvailability };
}

test("only a successful exact owner-scoped null read confirms unavailable, with pinned session authorization", async () => {
  const f = clientFixture({ data: null, error: null, status: 200 });
  assert.equal(await f.read(OWNER, ID, new AbortController().signal), "unavailable");
  assert.deepEqual(
    f.calls.filter(([method]) => method !== "abortSignal"),
    [
      ["owner-check", OWNER],
      ["from", "user_library_items"],
      ["select", "id,user_id"],
      ["eq", "user_id", OWNER],
      ["eq", "id", ID],
      ["maybeSingle"],
      ["setHeader", "Authorization", "Bearer owner-session"],
      ["owner-check", OWNER],
    ],
  );
});

test("exact reader validates found identity and never turns auth, network, permission, or malformed failures into absence", async () => {
  for (const result of [
    { data: null, error: new Error("permission denied"), status: 200 },
    { data: null, error: null, status: 401 },
    { data: null, error: null, status: 403 },
    { data: null, error: null, status: 404 },
    { data: null, error: null, status: 500 },
    { data: null, error: null },
    { data: null, status: 200 },
    { data: null, error: null, status: NaN },
    { error: null, status: 200 },
    { data: [], error: null, status: 200 },
    { data: { id: ID, user_id: "someone-else" }, error: null, status: 200 },
    { data: { id: "different", user_id: OWNER }, error: null, status: 200 },
    () => Promise.reject(new Error("offline")),
  ]) {
    assert.equal(
      await clientFixture(result).read(OWNER, ID, new AbortController().signal),
      "unknown",
    );
  }
  const found = { data: { id: ID, user_id: OWNER }, error: null, status: 200 };
  assert.equal(
    await clientFixture(found).read(OWNER, ID, new AbortController().signal),
    "available",
  );
});

test("invalid identifiers, signed-out, changed accounts and aborts never report unavailable", async () => {
  const result = { data: null, error: null, status: 200 };
  const invalid = clientFixture(result);
  assert.equal(await invalid.read("guest", ID, new AbortController().signal), "unknown");
  assert.equal(await invalid.read(OWNER, "invalid", new AbortController().signal), "unknown");
  assert.equal(invalid.calls.length, 0);
  const signedOut = clientFixture(result, () => {
    throw new Error("account changed");
  });
  assert.equal(await signedOut.read(OWNER, ID, new AbortController().signal), "unknown");
  assert.equal(signedOut.calls.length, 1);
  let checks = 0;
  const changed = clientFixture(result, () => {
    if (++checks === 2) throw new Error("account changed");
    return { Authorization: "Bearer original-owner" };
  });
  assert.equal(await changed.read(OWNER, ID, new AbortController().signal), "unknown");
  const controller = new AbortController();
  const aborted = clientFixture(() => {
    controller.abort();
    return result;
  });
  assert.equal(await aborted.read(OWNER, ID, controller.signal), "unknown");
});

test("attachment rendering preserves the original name for all states and creates no generation-stable link", () => {
  const jsx = (type, props) => ({ type, props });
  let status = "unknown",
    retries = 0;
  const { HistoricalLibraryAttachment } = load("components/HistoricalLibraryAttachment.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { FileText: "file-icon", Loader2: "loading-icon" },
    "@/hooks/use-historical-library-availability": {
      useHistoricalLibraryAvailability: () => ({ elementRef: {}, status, retry: () => retries++ }),
    },
  });
  const attachment = Object.freeze({
    kind: "library_file",
    libraryItemId: ID,
    name: "Original historical name.pdf",
  });
  const flatten = (node) =>
    Array.isArray(node)
      ? node.flatMap(flatten)
      : node && typeof node === "object"
        ? [node, ...flatten(node.props.children)]
        : [node];
  for (const [state, label] of [
    ["loading", "Loading…"],
    ["unknown", "Availability unknown"],
    ["unavailable", "File unavailable"],
    ["available", "Library"],
  ]) {
    status = state;
    const tree = HistoricalLibraryAttachment({ attachment, ownerId: OWNER });
    const nodes = flatten(tree);
    const text = nodes.filter((node) => typeof node === "string").join(" ");
    assert.ok(text.includes(attachment.name));
    assert.ok(text.includes(label));
    assert.equal(tree.props["data-library-availability"], state);
    assert.ok(!nodes.some((node) => node?.props?.href || node?.type === "a"));
    assert.doesNotMatch(text, /deleted|removed|generation/i);
    if (state === "unknown") nodes.find((node) => node?.type === "button").props.onClick();
  }
  assert.equal(retries, 1);
  status = "unknown";
  assert.ok(
    !flatten(HistoricalLibraryAttachment({ attachment, ownerId: null })).some(
      (node) => node?.type === "button",
    ),
  );
});

test("chat integration changes rendering only and leaves historical identity, name, text, and image attachments intact", () => {
  const chat = source("components/ChatMessage.tsx");
  assert.match(chat, /attachment\.kind === "library_file" \? \(\s*<HistoricalLibraryAttachment/);
  assert.match(chat, /attachment=\{attachment\}/);
  assert.match(chat, /ownerId=\{principalResolved && isSignedIn \? userKey : null\}/);
  assert.match(chat, /src=\{attachment\.dataUrl\}/);
  assert.match(chat, /key=\{`\$\{attachment\.name\}:\$\{attachment\.size \?\? 0\}`\}/);
  const helper = source("lib/historical-library-availability-client.ts");
  assert.doesNotMatch(
    helper,
    /\.limit\(|\.insert\(|\.update\(|\.delete\(|content_generation|libraryItemDetailPath/,
  );
});

// Execute the real hook with deterministic React effect/ref doubles. No DOM,
// browser, remote credentials, or external data requests are involved.
function hookFixture() {
  const f = readerFixture();
  let index = 0,
    effects = [],
    value;
  const slots = [];
  const { useHistoricalLibraryAvailability } = load(
    "hooks/use-historical-library-availability.ts",
    {
      react: {
        useRef(initial) {
          const slot = index++;
          if (!(slot in slots)) slots[slot] = { current: initial };
          return slots[slot];
        },
        useState(initial) {
          const slot = index++;
          if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
          return [
            slots[slot],
            (next) => (slots[slot] = typeof next === "function" ? next(slots[slot]) : next),
          ];
        },
        useEffect(effect, deps) {
          const slot = index++,
            previous = slots[slot];
          if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
            effects.push(() => {
              previous?.cleanup?.();
              slots[slot] = { deps, cleanup: effect() };
            });
          }
        },
      },
      "@/lib/historical-library-availability": {
        createHistoricalLibraryAvailabilityReader: () => f.reader,
      },
      "@/lib/historical-library-availability-client": {
        readHistoricalLibraryAvailability() {
          throw new Error("No external requests");
        },
      },
    },
  );
  return {
    ...f,
    render(owner = "a", id = "id") {
      index = 0;
      effects = [];
      value = useHistoricalLibraryAvailability(owner, id);
      value.elementRef.current = {};
      return value;
    },
    commit() {
      effects.splice(0).forEach((effect) => effect());
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    retry() {
      value.retry();
    },
  };
}

test("actual hook performs no eager history reads, starts on intersection, and cancels on departure/unmount", async () => {
  const previousObserver = globalThis.IntersectionObserver;
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  try {
    const f = hookFixture();
    assert.equal(f.render().status, "unknown");
    f.commit();
    await settle();
    assert.equal(f.requests.length, 0);
    observers[0].callback([{ isIntersecting: true }]);
    f.render();
    f.commit();
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.render().status, "loading");
    observers[0].callback([{ isIntersecting: false }]);
    f.render();
    f.commit();
    assert.ok(f.requests[0].signal.aborted);
    f.requests[0].resolve("unavailable");
    await settle();
    observers[0].callback([{ isIntersecting: true }]);
    f.render();
    f.commit();
    await settle();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve("available");
    await settle();
    assert.equal(f.render().status, "available");
    f.unmount();
    assert.equal(observers[0].disconnected, true);
    assert.equal(f.timers.size, 0);
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});

test("actual hook masks old-owner state during render, rejects late responses, and handles signed-out and A to B to A", async () => {
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = undefined;
  try {
    const f = hookFixture();
    f.render("a");
    f.commit();
    f.retry();
    f.render("a");
    f.commit();
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.render("b").status, "unknown");
    f.requests[0].resolve("unavailable");
    await settle();
    // The owner changed at render, before effect cleanup or the old read settled.
    assert.equal(f.render("b").status, "unknown");
    f.commit();
    f.retry();
    f.render("b");
    f.commit();
    await settle();
    f.requests[1].resolve("available");
    await settle();
    assert.equal(f.render("b").status, "available");
    assert.equal(f.render(null).status, "unknown");
    f.commit();
    assert.equal(f.render("a").status, "unknown");
    f.commit();
    f.retry();
    f.render("a");
    f.commit();
    await settle();
    assert.equal(f.requests.length, 3);
    assert.equal(f.render("a").status, "loading");
    f.requests[2].resolve("available");
    await settle();
    assert.equal(f.render("a").status, "available");
    f.unmount();
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});

test("without an observer the hook stays lazy and unknown until an explicit check, including after item changes", async () => {
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = undefined;
  try {
    const f = hookFixture();
    f.render();
    f.commit();
    await settle();
    assert.equal(f.requests.length, 0);
    f.retry();
    f.render();
    f.commit();
    await settle();
    f.requests[0].resolve("unavailable");
    await settle();
    assert.equal(f.render().status, "unavailable");
    assert.equal(f.render("a", "new-id").status, "unknown");
    f.commit();
    await settle();
    assert.equal(f.requests.length, 1);
    f.retry();
    f.render("a", "new-id");
    f.commit();
    await settle();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].id, "new-id");
    f.requests[1].reject(new Error("auth failed"));
    await settle();
    assert.equal(f.render("a", "new-id").status, "unknown");
    f.unmount();
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});
