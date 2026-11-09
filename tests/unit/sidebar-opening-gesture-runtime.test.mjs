import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installInteractiveSidebarSwipe } from "../../src/lib/sidebar-swipe.mjs";

assert.match(
  readFileSync("src/components/Sidebar.tsx", "utf8"),
  /installInteractiveSidebarSwipe\(/,
);

function surface() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener, options) {
      assert.equal(options.passive, name !== "touchmove");
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
}

function target() {
  const properties = new Map();
  return {
    dataset: {},
    offsetWidth: 320,
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      },
      getPropertyValue(name) {
        return properties.get(name) || "";
      },
      removeProperty(name) {
        properties.delete(name);
      },
    },
    getBoundingClientRect: () => ({ width: 320 }),
  };
}

function fixture(open) {
  const events = surface();
  const drawer = target();
  const scrim = target();
  let toggles = 0;
  let allowed = true;
  let selected = false;
  let mobile = true;
  const cleanup = installInteractiveSidebarSwipe({
    open,
    target: events,
    drawer,
    scrim,
    isMobile: () => mobile,
    canStart: () => allowed && !selected,
    canContinue: () => allowed && !selected,
    toggle: () => toggles++,
  });
  function dispatch(name, x, y = 100, time = 0, count = 1) {
    const finger = (identifier) => ({ identifier, clientX: x, clientY: y });
    const fingers = Array.from({ length: count }, (_, id) => finger(id));
    events.listeners.get(name)?.({
      timeStamp: time,
      cancelable: true,
      preventDefault() {},
      touches: name === "touchend" || name === "touchcancel" ? [] : fingers,
      changedTouches: [finger(0)],
    });
  }
  return {
    drawer,
    scrim,
    dispatch,
    cleanup,
    events,
    toggles: () => toggles,
    block: () => {
      allowed = false;
    },
    select: () => {
      selected = true;
    },
    desktop: () => {
      mobile = false;
    },
  };
}

test("opening follows the finger and settles only on release", () => {
  const f = fixture(false);
  f.dispatch("touchstart", 12);
  f.dispatch("touchmove", 92, 100, 100);
  assert.equal(f.drawer.style.getPropertyValue("--kova-swipe-distance"), "80px");
  assert.equal(f.scrim.style.getPropertyValue("--kova-swipe-progress"), "0.25");
  assert.equal(f.toggles(), 0);
  f.dispatch("touchmove", 122, 100, 150);
  f.dispatch("touchend", 122, 100, 170);
  assert.equal(f.toggles(), 1);
  assert.equal(f.drawer.dataset.swipeDragging, "settling-opening");
  f.cleanup();
  assert.equal(f.events.listeners.size, 0);
});

test("reversing a partial opening moves the backdrop back and does not toggle", () => {
  const f = fixture(false);
  f.dispatch("touchstart", 12);
  f.dispatch("touchmove", 82, 100, 100);
  f.dispatch("touchmove", 20, 100, 220);
  assert.equal(f.drawer.style.getPropertyValue("--kova-swipe-distance"), "8px");
  assert.equal(f.scrim.style.getPropertyValue("--kova-swipe-progress"), "0.025");
  f.dispatch("touchend", 20, 100, 240);
  assert.equal(f.toggles(), 0);
  f.cleanup();
});

test("short fast flick opens; slow short drag does not", () => {
  const fast = fixture(false);
  fast.dispatch("touchstart", 12);
  fast.dispatch("touchmove", 42, 100, 40);
  fast.dispatch("touchend", 42, 100, 45);
  assert.equal(fast.toggles(), 1);
  fast.cleanup();
  const slow = fixture(false);
  slow.dispatch("touchstart", 12);
  slow.dispatch("touchmove", 42, 100, 300);
  slow.dispatch("touchend", 42, 100, 500);
  assert.equal(slow.toggles(), 0);
  slow.cleanup();
});

test("edge, vertical motion, selection, modal and multitouch guards are retained", () => {
  const offEdge = fixture(false);
  offEdge.dispatch("touchstart", 70);
  offEdge.dispatch("touchmove", 220, 100, 100);
  offEdge.dispatch("touchend", 220, 100, 110);
  assert.equal(offEdge.toggles(), 0);
  offEdge.cleanup();

  for (const interrupt of ["vertical", "selection", "blocked", "multitouch", "cancel"]) {
    const f = fixture(false);
    f.dispatch("touchstart", 12);
    if (interrupt === "selection") f.select();
    if (interrupt === "blocked") f.block();
    if (interrupt === "vertical") f.dispatch("touchmove", 17, 165, 40);
    if (interrupt === "multitouch") f.dispatch("touchmove", 70, 100, 40, 2);
    if (interrupt === "cancel") f.dispatch("touchcancel", 12);
    f.dispatch("touchmove", 122, 100, 100);
    f.dispatch("touchend", 122, 100, 110);
    assert.equal(f.toggles(), 0, interrupt);
    f.cleanup();
  }
});
