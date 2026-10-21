import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { installInputModality } from "../../src/lib/input-modality.mjs";
function fixture() {
  const attrs = new Map();
  const listeners = new Map();
  const document = {
    documentElement: {
      getAttribute: (k) => attrs.get(k) ?? null,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    },
    addEventListener: (k, v, c) => {
      assert.equal(c, true);
      listeners.set(k, v);
    },
    removeEventListener: (k, v, c) => {
      assert.equal(c, true);
      assert.equal(listeners.get(k), v);
      listeners.delete(k);
    },
  };
  return {
    document,
    attrs,
    listeners,
    mode: () => attrs.get("data-kova-input-modality"),
    fire: (key, event = {}) => listeners.get(key)?.(event),
  };
}
test("pointer activation and focus restoration stay quiet until keyboard navigation", () => {
  const f = fixture();
  const dispose = installInputModality(f.document);
  assert.equal(f.mode(), "keyboard");
  f.fire("pointerdown");
  assert.equal(f.mode(), "pointer");
  f.fire("keydown", { key: "a" });
  assert.equal(f.mode(), "pointer");
  f.fire("keydown", { key: "Tab" });
  assert.equal(f.mode(), "keyboard");
  f.fire("pointerdown");
  f.fire("keydown", { key: "ArrowDown" });
  assert.equal(f.mode(), "keyboard");
  dispose();
  assert.equal(f.mode(), undefined);
  assert.equal(f.listeners.size, 0);
});
test("typing, IME and command shortcuts do not turn a clicked editor into a ring", () => {
  const f = fixture();
  installInputModality(f.document);
  f.fire("pointerdown");
  for (const event of [
    { key: "Enter", target: { matches: () => true } },
    { key: "ArrowLeft", target: { matches: () => true } },
    { key: "Tab", isComposing: true },
    { key: "k", ctrlKey: true },
  ]) {
    f.fire("keydown", event);
    assert.equal(f.mode(), "pointer");
  }
  f.fire("keydown", { key: "Tab", target: { matches: () => true } });
  assert.equal(f.mode(), "keyboard");
});
test("portal menu keyboard activation and cleanup preserve explicit modality", () => {
  const f = fixture();
  f.attrs.set("data-kova-input-modality", "pointer");
  const dispose = installInputModality(f.document);
  for (const key of ["Enter", " ", "Escape", "Home", "End"]) {
    f.fire("pointerdown");
    f.fire("keydown", { key });
    assert.equal(f.mode(), "keyboard");
  }
  dispose();
  assert.equal(f.mode(), "pointer");
});
test("pointer overrides are root-scoped, layered and do not remove keyboard rules", () => {
  const css = readFileSync("src/styles.css", "utf8").split("/* Pointer interaction uses")[1];
  assert.match(css, /@layer base/);
  assert.match(css, /\[role="menu"\]/);
  assert.match(css, /html\[data-kova-input-modality="pointer"\]/);
  assert.match(css, /\.kova-composer-button:not\(\.kova-send-button\)/);
  assert.match(css, /\.kova-sidebar-shortcut-choice/);
  assert.match(css, /--tw-ring-offset-shadow/);
  assert.match(css, /background-color: var\(--accent\)/);
  assert.doesNotMatch(css, /modality="keyboard"/);
  assert.match(
    readFileSync("src/components/conversation-header.css", "utf8"),
    /button:focus-visible/,
  );
  assert.match(readFileSync("src/routes/__root.tsx", "utf8"), /installInputModality\(document\)/);
});

test("pointer chat focus uses one full-row surface rather than a shorter title capsule", () => {
  const css = readFileSync("src/styles.css", "utf8");
  assert.match(css, /\.kova-chat-row:has\(\.kova-chat-row-main:is\(:focus,\s*:active\)\)/);
  assert.match(
    css,
    /\.kova-chat-row\s*>\s*\.kova-chat-row-main:is\(:focus,\s*:active,\s*:hover\)\s*\{\s*background: transparent !important;/,
  );
});
