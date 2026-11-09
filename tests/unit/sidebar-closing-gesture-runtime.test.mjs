import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installInteractiveSidebarSwipe } from "../../src/lib/sidebar-swipe.mjs";

assert.match(readFileSync("src/components/Sidebar.tsx", "utf8"), /installInteractiveSidebarSwipe\(/);

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

test("closing tracks drag distance and only commits after release", () => {
  const f = fixture(true);
  f.dispatch("touchstart", 200);
  f.dispatch("touchmove", 120, 100, 100);
  assert.equal(f.drawer.style.getPropertyValue("--kova-swipe-distance"), "-80px");
  assert.equal(f.scrim.style.getPropertyValue("--kova-swipe-progress"), "0.75");
  assert.equal(f.toggles(), 0);
  f.dispatch("touchmove", 70, 100, 150);
  f.dispatch("touchend", 70, 100, 170);
  assert.equal(f.toggles(), 1);
  assert.equal(f.drawer.dataset.swipeDragging, "settling-closing");
  f.cleanup();
  assert.equal(f.events.listeners.size, 0);
});

test("reversing a partial close moves the scrim back without closing", () => {
  const f = fixture(true);
  f.dispatch("touchstart", 200);
  f.dispatch("touchmove", 120, 100, 100);
  f.dispatch("touchmove", 197, 100, 200);
  assert.equal(f.drawer.style.getPropertyValue("--kova-swipe-distance"), "-3px");
  assert.equal(f.scrim.style.getPropertyValue("--kova-swipe-progress"), String(1 - 3 / 320));
  f.dispatch("touchend", 197, 100, 240);
  assert.equal(f.toggles(), 0);
  f.cleanup();
});

test("closing respects vertical scroll, text selection and cancellation", () => {
  for (const interrupt of ["vertical", "selection", "blocked", "cancel", "multitouch"]) {
    const f = fixture(true);
    f.dispatch("touchstart", 200);
    if (interrupt === "selection") f.select();
    if (interrupt === "blocked") f.block();
    if (interrupt === "vertical") f.dispatch("touchmove", 190, 170, 40);
    if (interrupt === "cancel") f.dispatch("touchcancel", 200);
    if (interrupt === "multitouch") f.dispatch("touchmove", 160, 100, 40, 2);
    f.dispatch("touchmove", 70, 100, 100);
    f.dispatch("touchend", 70, 100, 110);
    assert.equal(f.toggles(), 0, interrupt);
    f.cleanup();
  }
});

test("desktop interactions do not trigger mobile gestures", () => {
  const f = fixture(true);
  f.desktop();
  f.dispatch("touchstart", 200);
  f.dispatch("touchmove", 70, 100, 100);
  f.dispatch("touchend", 70, 100, 110);
  assert.equal(f.toggles(), 0);
  f.cleanup();
});
