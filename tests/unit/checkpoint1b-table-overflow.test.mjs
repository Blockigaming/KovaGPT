import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("src/lib/table-overflow.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { measureTableOverflow, observeTableOverflow } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
test("fitting and zero-width tables do not produce false overflow", () => {
  assert.equal(
    measureTableOverflow({ scrollWidth: 200, clientWidth: 200, scrollLeft: 0 }).overflow,
    false,
  );
  assert.equal(
    measureTableOverflow({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 }).overflow,
    false,
  );
});
test("actual overflow and either scroll direction are measured without modifying it", () => {
  const element = { scrollWidth: 600, clientWidth: 320, scrollLeft: 0 };
  assert.deepEqual(measureTableOverflow(element), { overflow: true, atStart: true, atEnd: false });
  element.scrollLeft = -280;
  assert.deepEqual(measureTableOverflow(element), { overflow: true, atStart: false, atEnd: true });
  assert.equal(element.scrollLeft, -280);
});
test("resize, content and scroll observers update and clean up", () => {
  const savedR = globalThis.ResizeObserver,
    savedM = globalThis.MutationObserver;
  let resize,
    mutation,
    disconnected = 0;
  const events = new Map(),
    windowEvents = new Map();
  globalThis.ResizeObserver = class {
    constructor(fn) {
      resize = fn;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  globalThis.MutationObserver = class {
    constructor(fn) {
      mutation = fn;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  const view = {
    addEventListener: (name, fn) => windowEvents.set(name, fn),
    removeEventListener: (name) => windowEvents.delete(name),
  };
  const container = {
    scrollWidth: 300,
    clientWidth: 320,
    scrollLeft: 0,
    ownerDocument: { defaultView: view },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
  };
  const values = [];
  try {
    const cleanup = observeTableOverflow(container, {}, (value) => values.push(value));
    assert.equal(values.at(-1).overflow, false);
    container.scrollWidth = 600;
    mutation();
    assert.equal(values.at(-1).overflow, true);
    container.scrollLeft = 280;
    events.get("scroll")();
    assert.equal(values.at(-1).atEnd, true);
    container.clientWidth = 700;
    resize();
    assert.equal(values.at(-1).overflow, false);
    cleanup();
    const length = values.length;
    container.scrollWidth = 900;
    resize();
    mutation();
    assert.equal(values.length, length);
    assert.equal(disconnected, 2);
    assert.equal(events.size, 0);
    assert.equal(windowEvents.size, 0);
  } finally {
    globalThis.ResizeObserver = savedR;
    globalThis.MutationObserver = savedM;
  }
});
test("semantic table remains focusable with a conditional external cue", () => {
  const response = readFileSync("src/components/ResponseMarkdown.tsx", "utf8");
  assert.match(response, /<table ref=\{table\}>\{children\}<\/table>/);
  assert.match(response, /aria-describedby=\{overflow \? cueId : undefined\}/);
  assert.match(response, /overflow &&/);
  assert.match(response, /kova-table-overflow-cue/);
});
