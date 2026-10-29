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
test("active focus rules use native focus-visible and retain visible keyboard outlines", () => {
  const sheet = postcss.parse(readFileSync("src/styles.css", "utf8"));
  const pointerRules = [];
  sheet.walkRules((rule) => {
    if (rule.selector.includes('data-kova-input-modality="pointer"')) pointerRules.push(rule);
  });
  assert.equal(
    pointerRules.length,
    0,
    "Removed compatibility selectors must not override native focus-visible",
  );
  const geometry = postcss.parse(readFileSync("src/styles/control-geometry.css", "utf8"));
  const focusRules = [];
  geometry.walkRules((rule) => {
    if (rule.selector.includes(":focus-visible")) focusRules.push(rule);
  });
  assert.ok(focusRules.some((rule) => rule.selector.includes("input")));
  assert.ok(focusRules.some((rule) => rule.selector.includes("button")));
  for (const rule of focusRules) {
    assert.ok(
      rule.nodes.some((node) => node.prop === "outline" && node.value === "2px solid var(--ring)"),
    );
    assert.ok(rule.nodes.some((node) => node.prop === "outline-offset" && node.value === "2px"));
    assert.ok(
      !rule.nodes.some((node) => /^(?:background|background-color)$/.test(node.prop)),
      "Keyboard focus must not recolor ordinary dialog actions",
    );
  }
  assert.match(
    readFileSync("src/components/conversation-header.css", "utf8"),
    /button:focus-visible/,
  );
  assert.match(readFileSync("src/routes/__root.tsx", "utf8"), /installInputModality\(document\)/);
});

test("chat focus highlights the full row while its title control stays transparent", () => {
  const css = readFileSync("src/styles/sidebar-core.css", "utf8");
  assert.match(css, /\.kova-sidebar \.kova-chat-row:is\([^)]*:focus-within[^)]*\)/);
  const sheet = postcss.parse(css);
  const title = sheet.nodes.find(
    (node) => node.type === "rule" && node.selector === ".kova-sidebar .kova-chat-row-main",
  );
  assert.ok(title);
  assert.ok(title.nodes.some((node) => node.prop === "background" && node.value === "transparent"));
});
