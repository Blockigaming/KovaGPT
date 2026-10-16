import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import ts from "typescript";
import vm from "node:vm";
const css = postcss.parse(readFileSync("src/styles/assistant.css", "utf8"));
function rule(selector, predicate = () => true) {
  const found = [];
  css.walkRules(selector, (n) => {
    if (predicate(n)) found.push(n);
  });
  assert.equal(found.length, 1, selector);
  return Object.fromEntries(
    found[0].nodes.filter((n) => n.type === "decl").map((n) => [n.prop, n.value]),
  );
}
test("readable width responds to available main canvas, with shared composer and transcript tokens", () => {
  assert.equal(
    rule(".kova-assistant", (n) => n.parent.type === "root")["--chat-readable"],
    "640px",
  );
  assert.equal(rule(".kova-assistant .kova-chat-main").container, "chat-canvas / inline-size");
  const queries = [];
  css.walkAtRules("container", (n) => queries.push(n));
  const wide = queries.find((n) => n.params === "chat-canvas (min-width: 856px)");
  assert.ok(wide);
  assert.match(wide.toString(), /\.kova-chat-column/);
  assert.match(wide.toString(), /\.kova-message/);
  assert.match(wide.toString(), /--chat-readable: 768px/);
  assert.equal(rule(".kova-assistant .kova-chat-column")["max-width"], "var(--chat-readable)");
  assert.equal(
    rule(".kova-assistant .kova-message")["max-width"],
    "calc(var(--chat-readable) + 2 * var(--chat-gutter))",
  );
});
test("desktop single-row, narrow stacked composer and touch controls have independent constraints", () => {
  assert.equal(
    rule(".kova-assistant .kova-composer-row", (n) => n.parent.type === "root")[
      "grid-template-columns"
    ],
    "auto minmax(0, 1fr) auto",
  );
  const mobile = rule(
    ".kova-assistant .kova-composer-row",
    (n) => n.parent.params === "(max-width: 639px)",
  );
  assert.equal(mobile["grid-template-rows"], "auto auto");
  const touch = rule(
    ".kova-assistant",
    (n) => n.parent.params === "(pointer: coarse), (max-width: 1023px)",
  );
  assert.equal(touch["--chat-control"], "44px");
  assert.equal(touch["--chat-message-action"], "44px");
  assert.equal(
    rule(".kova-assistant", (n) => n.parent.type === "root")["--chat-composer-layout"],
    "grid",
  );
  const queries = [];
  css.walkAtRules("container", (n) => queries.push(n.params));
  assert.ok(queries.includes("chat-composer (max-width: 440px)"));
  const input = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(input, /paddingBottom: `\$\{kbOffset \+ 8\}px`/);
  assert.match(input, /kova-chat-column mx-auto max-w-\[48rem\]/);
});
test("actual textarea resize marks wrapped lines and retains the scroll-height cap", () => {
  const source = ts.createSourceFile(
    "ChatInput.tsx",
    readFileSync("src/components/ChatInput.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let resize;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === "resize") resize = n.initializer;
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(resize);
  const el = { style: {}, dataset: {}, scrollHeight: 36 };
  const metrics = {
    lineHeight: "26px",
    paddingTop: "5px",
    paddingBottom: "5px",
    minHeight: "36px",
  };
  const window = { getComputedStyle: () => metrics };
  const compiled = ts.transpileModule(`const resize=${resize.getText(source)};resize;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = vm.runInNewContext(compiled, { el, window });
  run();
  assert.equal(el.dataset.multiline, "false");
  assert.equal(el.style.height, "36px");
  // Empty and single-line coarse/tablet input occupies the 44px minimum.
  metrics.minHeight = "44px";
  for (const value of ["", "One line"]) {
    el.value = value;
    el.scrollHeight = 44;
    run();
    assert.equal(el.dataset.multiline, "false");
    assert.equal(el.style.height, "44px");
  }
  el.scrollHeight = 62;
  run();
  assert.equal(el.dataset.multiline, "true");
  assert.equal(el.style.height, "62px");
  // Signed-in phone text row keeps26px line height with3px top/bottom padding.
  metrics.minHeight = "32px";
  metrics.paddingTop = "3px";
  metrics.paddingBottom = "3px";
  el.scrollHeight = 32;
  run();
  assert.equal(el.dataset.multiline, "false");
  assert.equal(el.style.height, "32px");
  el.scrollHeight = 58;
  run();
  assert.equal(el.dataset.multiline, "true");
  assert.equal(el.style.height, "58px");
  metrics.paddingTop = "5px";
  metrics.paddingBottom = "5px";
  // Returning to the fine-pointer baseline must restore single-line marking.
  metrics.minHeight = "36px";
  el.scrollHeight = 36;
  run();
  assert.equal(el.dataset.multiline, "false");
  el.scrollHeight = 62;
  run();
  assert.equal(el.dataset.multiline, "true");
  el.scrollHeight = 400;
  run();
  assert.equal(el.style.height, "200px");
  assert.equal(el.style.overflowY, "auto");
});

test("assistant body uses native fonts while the licensed Kova heading face remains", () => {
  const tokens = rule(".kova-assistant", (n) => n.parent.type === "root");
  assert.match(tokens["--chat-body-font"], /ui-sans-serif, system-ui/);
  const heading = rule(
    ".kova-assistant .kova-empty-chat .kova-greeting h1",
    (n) => n.parent.type === "root",
  );
  assert.equal(heading["font-family"], "var(--font-display)");
  assert.ok(!css.toString().includes("OpenAI Sans"));
});

test("auth resolution remeasures the textarea without changing the draft", () => {
  const source = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(
    source,
    /return \(\) => observer.disconnect\(\);\n  \}, \[value, isLoaded, user\?\.id\]\)/,
  );
  assert.match(source, /data-signed-in=\{isLoaded && user \? "true" : undefined\}/);
});
