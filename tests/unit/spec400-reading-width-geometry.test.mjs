import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { applyReadingPreferences } from "../../src/lib/appearance-preferences.mjs";

const read = (path) => readFileSync(path, "utf8");
const workspace = postcss.parse(read("src/styles/spec400-chat.css"));
const response = postcss.parse(read("src/components/response-action-refinement.css"));
const rule = (sheet, selector) => {
  const matches = [];
  sheet.walkRules(selector, (node) => matches.push(node));
  assert.equal(matches.length, 1, `Expected one owner for ${selector}`);
  return matches[0];
};
const declaration = (node, property) => {
  const declarations = node.nodes.filter((entry) => entry.prop === property);
  assert.equal(declarations.length, 1, `Expected one ${property} declaration`);
  return declarations[0].value;
};
const message = rule(response, ".kova-message[data-message-role]");
const column = rule(response, ".kova-message-reading-column");

// Evaluate only the length arithmetic used by these source declarations. This
// guards their numeric bounds without pretending to replace browser layout QA.
function split(expression, separator) {
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === "(") depth++;
    if (expression[index] === ")") depth--;
    if (depth === 0 && expression[index] === separator) {
      parts.push(expression.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, expression.slice(start).trim()];
}
function length(expression, variables, available) {
  expression = expression.trim();
  for (const operator of ["+", "-", "*"]) {
    const parts = split(expression, operator);
    if (parts.length > 1) {
      const values = parts.map((part) => length(part, variables, available));
      return values.reduce((left, right) =>
        operator === "+" ? left + right : operator === "-" ? left - right : left * right,
      );
    }
  }
  const fn = expression.match(/^(var|calc|min|max)\(([\s\S]*)\)$/);
  if (fn) {
    const args = split(fn[2], ",");
    if (fn[1] === "var") {
      const value = variables[args[0]] ?? args[1];
      assert.ok(value !== undefined, `Missing ${args[0]}`);
      return length(String(value), variables, available);
    }
    const values = args.map((arg) => length(arg, variables, available));
    if (fn[1] === "calc") return values[0];
    return Math[fn[1]](...values);
  }
  const literal = expression.match(/^(\d+(?:\.\d+)?)(px|rem|%)?$/);
  assert.ok(literal, `Unsupported length: ${expression}`);
  return (
    Number(literal[1]) * (literal[2] === "%" ? available / 100 : literal[2] === "rem" ? 16 : 1)
  );
}

test("the active transcript and conversation composer use the selected reading-width token", () => {
  const outerWidth = declaration(message, "max-width");
  assert.match(outerWidth, /var\(--kova-reading-width\)/);
  assert.doesNotMatch(outerWidth, /--chat-readable|--kova-content-max/);
  assert.equal(declaration(column, "width"), "100%");
  assert.equal(declaration(column, "min-width"), "0");
  assert.equal(column.parent.type, "root", "The current unlayered column owns readable width");
  assert.equal(
    declaration(rule(workspace, ".spec400-composer-dock > .spec400-chat-input > *"), "width"),
    "min(100%, var(--kova-reading-width))",
  );
  assert.equal(declaration(message, "margin-inline"), "auto");
  assert.match(read("src/components/ActiveChatTranscript.tsx"), /data-chat-transcript="true"/);
});

test("composer and transcript edges agree for classic and overlay scrollbars without clipping focus or Jump", () => {
  const chat = postcss.parse(read("src/styles/spec400-chat.css"));
  const dock = rule(chat, ".spec400-composer-dock");
  const input = rule(chat, ".spec400-composer-dock > .spec400-chat-input");
  const content = rule(chat, ".spec400-composer-dock > .spec400-chat-input > *");
  assert.equal(
    declaration(
      rule(response, ".kova-conversation-scroll[data-chat-transcript]"),
      "scrollbar-gutter",
    ),
    "stable",
  );
  assert.equal(declaration(input, "scrollbar-gutter"), "stable");
  assert.equal(declaration(input, "overflow-y"), "auto");
  assert.equal(declaration(input, "max-width"), "none");
  assert.equal(
    dock.nodes.some((node) => /^overflow/.test(node.prop ?? "")),
    false,
  );
  assert.equal(declaration(content, "margin-inline"), "auto");
  const dockPadding = split(declaration(dock, "padding-inline"), " ").filter(Boolean);
  assert.equal(dockPadding.length, 2);
  for (const readingWidth of [680, 760, 900])
    for (const scrollbar of [0, 10, 17])
      for (const [pane, gutter, safeLeft, safeRight] of [
        [320, 16, 0, 0],
        [390, 16, 0, 0],
        [680, 20, 0, 0],
        [768, 20, 0, 0],
        [952, 20, 0, 0],
        [1328, 20, 0, 0],
        [1024, 20, 44, 28],
      ]) {
        const variables = {
          "--kova-reading-width": `${readingWidth}px`,
          "--chat-gutter": `${gutter}px`,
          "--safe-left": `${safeLeft}px`,
          "--safe-right": `${safeRight}px`,
        };
        const available = pane - scrollbar;
        const left = Math.max(gutter, safeLeft);
        const right = Math.max(gutter, safeRight);
        const outer = Math.min(
          available,
          length(declaration(message, "max-width"), variables, available),
        );
        const transcriptWidth = outer - left - right;
        const transcriptLeft = (available - outer) / 2 + left;
        const dockLeft = length(dockPadding[0], variables, pane);
        const dockRight = length(dockPadding[1], variables, pane);
        const focusPadding = length(declaration(input, "padding-inline"), variables, pane);
        const inputClient = available - dockLeft - dockRight;
        const inputContent = inputClient - 2 * focusPadding;
        const composerWidth = length(declaration(content, "width"), variables, inputContent);
        const composerLeft = dockLeft + focusPadding + (inputContent - composerWidth) / 2;
        assert.ok(
          Math.abs(composerLeft - transcriptLeft) < 1e-8,
          `${pane}px left edge; scrollbar ${scrollbar}`,
        );
        assert.ok(
          Math.abs(composerLeft + composerWidth - transcriptLeft - transcriptWidth) < 1e-8,
          `${pane}px right edge; scrollbar ${scrollbar}`,
        );
        assert.ok(focusPadding >= 4, "2px outline plus 2px offset must fit the inner padding");
        assert.ok(length(declaration(input, "padding-top"), variables, pane) >= 4);
      }
});

for (const readingWidth of [680, 760, 900]) {
  test(`${readingWidth}px reading preference reaches its selected width and shrinks within narrow panes`, () => {
    for (const [available, gutter, safeLeft, safeRight] of [
      [952, 20, 0, 0], // 1024px viewport with a collapsed 72px rail.
      [1328, 20, 0, 0],
      [680, 20, 0, 0],
      [420, 20, 0, 0], // Minimum Result split conversation pane.
      [390, 16, 0, 0],
      [320, 16, 0, 0],
      [1024, 20, 44, 28], // Safe-area padding is outside the preferred content width.
    ]) {
      const variables = {
        "--chat-readable": "768px",
        "--chat-gutter": `${gutter}px`,
        "--safe-left": `${safeLeft}px`,
        "--safe-right": `${safeRight}px`,
      };
      applyReadingPreferences(
        { style: { setProperty: (key, value) => (variables[key] = value) }, dataset: {} },
        { readingWidth },
      );
      const padding = Math.max(gutter, safeLeft) + Math.max(gutter, safeRight);
      const outer = Math.min(
        available,
        length(declaration(message, "max-width"), variables, available),
      );
      const content = outer - padding;
      const inner = Math.min(
        length(declaration(column, "width"), variables, content),
        length(declaration(column, "max-width"), variables, content),
      );
      assert.equal(inner, Math.min(readingWidth, available - padding), `${available}px pane`);
      assert.ok(outer <= available, "Message must stay within its pane");
    }
  });
}

test("all message roles and action rows share the bound while split minima stay unchanged", () => {
  const component = read("src/components/ChatMessage.tsx");
  assert.equal((component.match(/className="[^"]*kova-message-reading-column/g) ?? []).length, 3);
  assert.match(component, /className="kova-message group w-full/);
  assert.match(
    read("src/routes/index.tsx"),
    /gridTemplateColumns: `minmax\(420px, \$\{paneRatio\}fr\) 12px minmax\(420px, \$\{1 - paneRatio\}fr\)`/,
  );
  assert.match(
    declaration(message, "padding-inline"),
    /max\(var\(--chat-gutter\), var\(--safe-left\)\)/,
  );
  assert.match(
    declaration(message, "padding-inline"),
    /max\(var\(--chat-gutter\), var\(--safe-right\)\)/,
  );
});
