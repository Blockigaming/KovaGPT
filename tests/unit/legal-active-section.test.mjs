import test from "node:test";
import assert from "node:assert/strict";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
function fixture({ observer = true } = {}) {
  const events = new Map(),
    frames = new Map(),
    updates = [];
  let sequence = 0,
    reflow,
    disconnected = false;
  const targets = ["security", "retention", "contact"].map((id, i) => ({
    id,
    top: i * 400,
    margin: 92,
    getBoundingClientRect() {
      return { top: this.top };
    },
  }));
  const scrollingElement = { scrollTop: 300, clientHeight: 800, scrollHeight: 3000 };
  const window = {
    innerHeight: 800,
    requestAnimationFrame(fn) {
      frames.set(++sequence, fn);
      return sequence;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    addEventListener(type, fn) {
      events.set(type, fn);
    },
    removeEventListener(type, fn) {
      assert.equal(events.get(type), fn);
      events.delete(type);
    },
  };
  const { trackLegalSection } = loadUiModule(
    "src/lib/legal-active-section.ts",
    {},
    {
      window,
      document: { scrollingElement },
      getComputedStyle: (target) => ({ scrollMarginBlockStart: `${target.margin}px` }),
      ResizeObserver: observer
        ? class {
            constructor(fn) {
              reflow = fn;
            }
            observe() {}
            disconnect() {
              disconnected = true;
            }
          }
        : undefined,
    },
  );
  const cleanup = trackLegalSection({ querySelectorAll: () => targets }, (id) => updates.push(id));
  const flush = () => {
    for (const [id, fn] of frames) {
      frames.delete(id);
      fn();
    }
  };
  return {
    targets,
    scrollingElement,
    window,
    events,
    frames,
    updates,
    cleanup,
    flush,
    reflow: () => reflow?.(),
    disconnected: () => disconnected,
  };
}
test("Reported previous section tail cannot displace retention at its92px anchor offset", () => {
  const f = fixture();
  f.targets[0].top = -241.58;
  f.targets[1].top = 91.61;
  f.targets[2].top = 900;
  f.flush();
  assert.equal(f.updates.at(-1), "retention");
  f.cleanup();
});
test("Normal forward/back reading switches at computed offset, not any visible tail", () => {
  const f = fixture();
  f.targets[0].top = -241;
  f.targets[1].top = 120;
  f.flush();
  assert.equal(f.updates.at(-1), "security");
  f.targets[1].top = 92.5;
  f.events.get("scroll")();
  f.flush();
  assert.equal(f.updates.at(-1), "retention");
  f.targets[1].top = 150;
  f.events.get("scroll")();
  f.flush();
  assert.equal(f.updates.at(-1), "security");
  f.cleanup();
});
test("End of scroll selects visible final section; short unscrolled documents start at first", () => {
  const f = fixture();
  f.targets[0].top = -900;
  f.targets[1].top = -200;
  f.targets[2].top = 650;
  f.scrollingElement.scrollTop = 2200;
  f.flush();
  assert.equal(f.updates.at(-1), "contact");
  f.scrollingElement.scrollTop = 0;
  f.scrollingElement.scrollHeight = 800;
  f.targets.forEach((t, i) => (t.top = 100 + i * 200));
  f.events.get("scroll")();
  f.flush();
  assert.equal(f.updates.at(-1), "security");
  f.cleanup();
});
test("Hash/history, resize and reflow use settled geometry without scrolling or changing history", () => {
  const f = fixture();
  f.flush();
  for (const event of ["hashchange", "popstate", "resize"]) {
    f.targets[1].top = 140;
    f.targets[1].margin = 144;
    f.events.get(event)();
    f.flush();
    assert.equal(f.updates.at(-1), "retention");
    f.targets[1].top = 300;
    f.reflow();
    f.flush();
    assert.equal(f.updates.at(-1), "security");
  }
  f.cleanup();
  assert.equal(f.events.size, 0);
  assert.equal(f.frames.size, 0);
  assert.ok(f.disconnected());
});
test("Immediate/reduced-motion and animated scroll events share geometry selection, coalesce frames and cancel pending work", () => {
  const f = fixture({ observer: false });
  f.targets[1].top = 92;
  f.events.get("hashchange")();
  for (let i = 0; i < 10; i++) f.events.get("scroll")();
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.deepEqual(f.updates, ["retention"]);
  f.events.get("scroll")();
  f.flush();
  assert.deepEqual(f.updates, ["retention"]);
  f.events.get("popstate")();
  f.cleanup();
  assert.equal(f.frames.size, 0);
});
