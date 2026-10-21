import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";
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
test("pointer row overrides are root-scoped and preserve shared keyboard focus", () => {
  const sheet = postcss.parse(readFileSync("src/styles.css", "utf8"));
  const pointerRules = [];
  sheet.walkRules((rule) => {
    if (rule.selector.includes('data-kova-input-modality="pointer"')) pointerRules.push(rule);
  });
  assert.equal(pointerRules.length, 2);
  for (const rule of pointerRules) {
    assert.match(rule.selector, /^html\[data-kova-input-modality="pointer"\]\s+\.kova-chat-row/);
    assert.doesNotMatch(rule.selector, /modality="keyboard"/);
    for (const node of rule.nodes)
      if (node.type === "decl")
        assert.ok(
          !/^(?:outline(?:-.+)?|box-shadow|--tw-ring-.+)$/.test(node.prop),
          `Pointer row handling must not suppress keyboard focus: ${node}`,
        );
  }
  assert.ok(
    pointerRules[0].nodes.some(
      (node) => node.prop === "background-color" && node.value === "var(--accent)",
    ),
  );
  assert.ok(
    pointerRules[1].nodes.some(
      (node) => node.prop === "background" && node.value === "transparent" && node.important,
    ),
  );
  const geometry = postcss.parse(readFileSync("src/styles/control-geometry.css", "utf8"));
  const fieldFocus = geometry.nodes.find(
    (node) => node.type === "rule" && node.selector.endsWith(":focus-visible"),
  );
  assert.ok(fieldFocus);
  assert.ok(
    fieldFocus.nodes.some(
      (node) => node.prop === "outline" && node.value === "2px solid var(--ring)",
    ),
    "Shared keyboard field outlines remain visible",
  );
  const parity = postcss.parse(readFileSync("src/styles/chatgpt-parity.css", "utf8"));
  const actionFocus = parity.nodes.find(
    (node) =>
      node.type === "rule" &&
      node.selector.startsWith(":where(button, a, input, textarea, select,") &&
      node.selector.endsWith(":focus-visible"),
  );
  assert.ok(actionFocus);
  assert.ok(
    actionFocus.nodes.some(
      (node) => node.prop === "outline" && node.value === "2px solid var(--parity-focus)",
    ),
    "Shared keyboard action outlines remain visible",
  );
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
