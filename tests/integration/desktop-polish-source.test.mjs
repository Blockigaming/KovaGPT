import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";

const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const input = await readFile("src/components/ChatInput.tsx", "utf8");
const message = await readFile("src/components/ChatMessage.tsx", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const tokens = await readFile("src/styles/visual-tokens.css", "utf8");
const sidebarStyles = await readFile("src/styles/sidebar-core.css", "utf8");
const composerStyles = await readFile("src/styles/spec400-chat.css", "utf8");
const messageStyles = await readFile("src/components/response-action-refinement.css", "utf8");
const sidebarSheet = postcss.parse(sidebarStyles);
const sidebarRule = (selector) => {
  const matches = sidebarSheet.nodes.filter(
    (node) => node.type === "rule" && node.selector === selector,
  );
  assert.equal(matches.length, 1, `One top-level rule must own ${selector}`);
  return matches[0];
};
const declarationValues = (rule, property) =>
  rule.nodes
    .filter((node) => node.type === "decl" && node.prop === property)
    .map((node) => node.value);

test("desktop sidebar fully collapses and has one contained close trigger", () => {
  assert.match(tokens, /--kova-sidebar-width: 260px;/);
  assert.match(tokens, /--kova-sidebar-rail-width: 60px;/);
  assert.match(sidebar, /"--sidebar-expanded": `\$\{layout.width\}px`/);
  const expanded = sidebarRule(".kova-sidebar[data-kova-core-sidebar]");
  const rail = sidebarRule(".kova-sidebar-rail[data-kova-core-rail]");
  assert.deepEqual(declarationValues(expanded, "width"), [
    "var(--sidebar-expanded, var(--kova-sidebar-width, 260px))",
  ]);
  assert.deepEqual(declarationValues(rail, "width"), ["var(--kova-sidebar-rail-width, 60px)"]);
  for (const selector of [
    ".kova-sidebar[data-kova-core-sidebar]",
    ".kova-sidebar-rail[data-kova-core-rail]",
  ]) {
    const closed = sidebarRule(`${selector}[data-state="closed"]`);
    for (const [property, value] of [
      ["width", "0"],
      ["min-width", "0"],
      ["visibility", "hidden"],
      ["pointer-events", "none"],
    ])
      assert.deepEqual(declarationValues(closed, property), [value]);
  }
  const primaryNavigation = sidebar.match(/<aside\b[^>]*>/)?.[0];
  assert.ok(primaryNavigation, "Sidebar collapse state belongs to the primary landmark");
  assert.match(primaryNavigation, /data-state=\{open \? "open" : "closed"\}/);
  assert.match(sidebar, /aria-label="Collapse sidebar"/);
  assert.match(sidebar, /Expand sidebar/);
  assert.match(primaryNavigation, /inert=\{collapsed \? true : undefined\}/);
});

test("chat and composer use one stable readable measure", () => {
  assert.match(input, /className="spec400-composer"/);
  assert.doesNotMatch(input, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.doesNotMatch(message, /data-sidebar=closed.*max-w-\[52rem\]/);
  assert.match(tokens, /--kova-reading-width: 768px;/);
  assert.match(tokens, /--kova-composer-width: 768px;/);
  assert.match(message, /kova-message-reading-column/);
  assert.match(message, /import "\.\/response-action-refinement\.css"/);
  assert.match(
    messageStyles,
    /\.kova-message-reading-column\s*\{[^}]*max-width: var\(--kova-reading-width\);/,
  );
  assert.match(
    composerStyles,
    /\.spec400-chat-input\s*\{[^}]*max-width: var\(--kova-composer-width, 768px\);/,
  );
  assert.match(
    composerStyles,
    /\.spec400-composer-dock > \.spec400-chat-input > \*\s*\{[^}]*width: min\(100%, var\(--kova-reading-width\)\);/,
  );
});

test("desktop refinement stays breakpoint-scoped and preserves reduced motion", () => {
  assert.match(styles, /Desktop refinement layer/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
