import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  observeLibraryImageApproach,
  queueLibraryImageSigning,
} from "../../src/lib/library-image-loading.ts";

function mockGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

test("private image proximity activates once and disconnects on unmount", (t) => {
  const observers = [];
  mockGlobal(
    t,
    "IntersectionObserver",
    class {
      disconnected = false;
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {
        this.disconnected = true;
      }
    },
  );
  let requests = 0;
  const target = {};
  const stop = observeLibraryImageApproach(target, () => requests++);
  assert.equal(requests, 0, "mounting an offscreen thumbnail must not sign it");
  assert.equal(observers[0].target, target);
  assert.equal(observers[0].options.rootMargin, "300px");
  observers[0].callback([{ isIntersecting: false }]);
  assert.equal(requests, 0);
  observers[0].callback([{ isIntersecting: true }]);
  observers[0].callback([{ isIntersecting: true }]);
  assert.equal(requests, 1);
  assert.equal(observers[0].disconnected, true);
  stop();
  const stopSecond = observeLibraryImageApproach({}, () => requests++);
  stopSecond();
  observers[1].callback([{ isIntersecting: true }]);
  assert.equal(requests, 1, "a queued observer callback after unmount must not activate");
});

test("without IntersectionObserver, offscreen images wait for nested scrolling", (t) => {
  mockGlobal(t, "IntersectionObserver", undefined);
  const listeners = new Map();
  const frames = new Map();
  let nextFrame = 0;
  mockGlobal(t, "window", {
    innerWidth: 1_200,
    innerHeight: 800,
    addEventListener(type, listener, options) {
      if (type === "scroll") assert.equal(options.capture, true);
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  let top = 4_000;
  let requests = 0;
  const stop = observeLibraryImageApproach(
    {
      getBoundingClientRect: () => ({
        top,
        bottom: top + 200,
        left: 0,
        right: 200,
        width: 200,
        height: 200,
      }),
    },
    () => requests++,
  );
  assert.equal(requests, 0, "fallback cannot eagerly sign every mounted thumbnail");
  top = 1_000;
  listeners.get("scroll")();
  listeners.get("scroll")();
  assert.equal(frames.size, 1, "coalesce geometry checks within a frame");
  const callback = frames.values().next().value;
  frames.clear();
  callback();
  assert.equal(requests, 1);
  assert.equal(listeners.size, 0);
  stop();
});

test("signing limits concurrency and skips canceled queued images", async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const releases = [];
  const canceled = new Set();
  const jobs = Array.from({ length: 20 }, (_, id) =>
    queueLibraryImageSigning(
      async () => {
        active++;
        peak = Math.max(peak, active);
        started.push(id);
        await new Promise((resolve) => releases.push(resolve));
        active--;
        return id;
      },
      () => canceled.has(id),
    ),
  );
  assert.equal(active, 4);
  canceled.add(8);
  while (started.length < 19 || active > 0) {
    releases.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
  }
  const results = await Promise.all(jobs);
  assert.equal(peak, 4);
  assert.equal(results[8], null);
  assert.equal(started.includes(8), false);
  assert.equal(results[19], 19);
});

test("a rejected signing call releases its slot for subsequent images", async () => {
  const failure = queueLibraryImageSigning(
    async () => {
      throw new Error("expired session");
    },
    () => false,
  );
  const success = queueLibraryImageSigning(
    async () => "signed",
    () => false,
  );
  await assert.rejects(failure, /expired session/u);
  assert.equal(await success, "signed");
});

test("Library thumbnails gate private signing while an opened preview opts into eager loading", async () => {
  const source = await readFile("src/routes/library.tsx", "utf8");
  assert.match(source, /useLibraryImageSource\(item, enabled\)/u);
  assert.match(source, /if \(!enabled \|\| !itemId/u);
  assert.match(source, /queueLibraryImageSigning/u);
  assert.match(source, /observeLibraryImageApproach\(containerRef\.current/u);
  assert.match(source, /item=\{visiblePreviewItem\}\s+eager/u);
});
