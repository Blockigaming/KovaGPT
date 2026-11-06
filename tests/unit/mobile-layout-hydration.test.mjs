import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/hooks/use-mobile.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function hydrate(width) {
  const values = [];
  const layoutEffects = [];
  const passiveEffects = [];
  const frames = new Map();
  const events = new Map();
  const window = {
    innerWidth: width,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
  };
  const React = {
    useState(initial) {
      const index = values.length;
      values.push(initial);
      return [
        initial,
        (value) => {
          values[index] = value;
        },
      ];
    },
    useLayoutEffect: (effect) => layoutEffects.push(effect),
    useEffect: (effect) => passiveEffects.push(effect),
  };
  const exports = {};
  new Function(
    "require",
    "exports",
    "window",
    "navigator",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    source,
  )(
    () => React,
    exports,
    window,
    { userAgent: "", maxTouchPoints: 0 },
    (callback) => {
      frames.set(1, callback);
      return 1;
    },
    (id) => frames.delete(id),
  );
  exports.useLayout();
  const cleanup = layoutEffects.map((effect) => effect());
  return { values, window, events, frames, cleanup };
}

test("mobile and tablet controls resolve before the first hydrated paint", () => {
  for (const [width, expected] of [
    [320, "mobile"],
    [390, "mobile"],
    [768, "tablet"],
    [1024, "desktop"],
  ]) {
    const view = hydrate(width);
    assert.deepEqual(view.values, [expected, "touch"]);
    assert.equal(view.frames.size, 0, "initial layout must not wait another animation frame");
    view.cleanup.forEach((cleanup) => cleanup());
    assert.equal(view.events.size, 0);
  }
});

test("rotation still coalesces later resize work and cancels it on unmount", () => {
  const view = hydrate(390);
  view.window.innerWidth = 1024;
  view.events.get("resize")();
  view.events.get("orientationchange")();
  assert.equal(view.frames.size, 1);
  view.frames.get(1)();
  assert.deepEqual(view.values, ["desktop", "touch"]);
  view.cleanup.forEach((cleanup) => cleanup());
  assert.equal(view.frames.size, 0);
});
