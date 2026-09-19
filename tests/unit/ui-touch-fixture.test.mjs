import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("tests/ui-foundations/controls.spec.ts", "utf8");
const compiled = ts.transpileModule(`${source}\nexport { dispatchSheetTouch };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

class NativeTouch {
  constructor(point) {
    Object.assign(this, point);
  }
}
class NativeTouchEvent extends Event {
  constructor(type, options) {
    super(type, options);
    this.touches = options.touches;
  }
}
class IllegalConstructor {
  constructor() {
    throw new TypeError("Illegal constructor");
  }
}

function fixture(globals = {}, dispatchError) {
  const events = [];
  const element = {
    dispatchEvent(event) {
      if (dispatchError) throw dispatchError;
      events.push(event);
      return true;
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Event,
    TypeError,
    Touch: NativeTouch,
    TouchEvent: NativeTouchEvent,
    ...globals,
    require(name) {
      assert.equal(name, "@playwright/test");
      // Register the browser cases without executing them in the unit process.
      return { test() {} };
    },
  });
  return {
    events,
    element,
    dispatch: (type, positions) =>
      exports.dispatchSheetTouch({ evaluate: (run, args) => run(element, args) }, type, positions),
  };
}

async function assertGestureFields(f) {
  for (const [type, positions] of [
    ["touchstart", [100]],
    ["touchmove", [160, 210]],
    ["touchcancel", []],
    ["touchend", []],
  ]) {
    await f.dispatch(type, positions);
    const event = f.events.at(-1);
    assert.equal(event.type, type);
    assert.equal(event.bubbles, true);
    assert.equal(event.cancelable, true);
    assert.deepEqual(
      Array.from(event.touches, (point) => point.clientY),
      positions,
    );
    assert.deepEqual(
      Array.from(event.touches, (point) => point.identifier),
      positions.map((_, i) => i),
    );
    assert.ok(event.touches.every((point) => point.target === f.element));
  }
  assert.equal(f.events.length, 4, "Each requested event must dispatch exactly once");
}

test("sheet fixture uses native touch objects when construction works", async () => {
  const f = fixture();
  await assertGestureFields(f);
  assert.ok(f.events.every((event) => event instanceof NativeTouchEvent));
});

for (const [name, globals] of [
  ["missing Touch", { Touch: undefined }],
  ["missing TouchEvent", { TouchEvent: undefined }],
  ["nonconstructible Touch", { Touch: IllegalConstructor }],
  ["nonconstructible TouchEvent", { TouchEvent: IllegalConstructor }],
]) {
  test(`sheet fixture preserves event fields with ${name}`, async () => {
    const f = fixture(globals);
    await assertGestureFields(f);
    // Empty end/cancel events may still use TouchEvent without constructing Touch.
    assert.ok(f.events.slice(0, 2).every((event) => event.constructor === Event));
  });
}

test("sheet fixture does not hide unexpected constructor errors", async () => {
  const failure = new Error("Unexpected construction failure");
  const f = fixture({
    Touch: class {
      constructor() {
        throw failure;
      }
    },
  });
  await assert.rejects(f.dispatch("touchstart", [100]), (error) => error === failure);
  assert.equal(f.events.length, 0);
});

test("sheet fixture does not catch or repeat a failed dispatch", async () => {
  const failure = new TypeError("Dispatch failed");
  const f = fixture({}, failure);
  await assert.rejects(f.dispatch("touchstart", [100]), (error) => error === failure);
  assert.equal(f.events.length, 0);
});
