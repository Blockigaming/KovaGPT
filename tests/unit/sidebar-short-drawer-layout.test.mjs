import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const core = postcss.parse(read("src/styles/sidebar-core.css"));
const query = "(max-width: 1023px) and (min-height: 421px)";
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const property = (rule, name) => rule.nodes.findLast((node) => node.prop === name)?.value;
function rule(selector, media) {
  const matches = [];
  core.walkRules((candidate) => {
    if (
      candidate.selectors.map(normalize).includes(selector) &&
      (media ? candidate.parent.params === media : candidate.parent.type === "root")
    )
      matches.push(candidate);
  });
  assert.equal(matches.length, 1, selector);
  return matches[0];
}
const primary = rule(".kova-sidebar-primary", query);
const history = rule(".kova-sidebar-history", query);

// Source flex-size arithmetic only. Native scrolling/focus remains browser coverage.
test("mobile navigation can shrink and scroll while history retains a usable viewport", () => {
  assert.equal(property(rule(".kova-sidebar-primary"), "flex"), "0 0 auto");
  assert.equal(property(primary, "flex-shrink"), "1");
  assert.equal(property(primary, "min-height"), "0");
  assert.equal(property(primary, "overflow-y"), "auto");
  assert.equal(property(primary, "overscroll-behavior"), "contain");
  assert.equal(property(history, "flex"), "1 1 160px");
  assert.equal(property(history, "min-height"), "min(160px, 50%)");
  assert.equal(property(rule(".kova-sidebar-history"), "overflow-y"), "auto");
  const body = rule(".kova-sidebar-scroll");
  assert.equal(property(body, "display"), "flex");
  assert.equal(property(body, "overflow"), "hidden");
  assert.equal(property(body, "min-height"), "0");
  assert.equal(property(rule(".kova-sidebar-footer"), "flex"), "0 0 auto");
});

test("700px drawer can retain its heading and two touch rows when More fills navigation", () => {
  const rowHeight = 44;
  const gap = parseFloat(property(rule(".kova-sidebar-primary"), "gap"));
  const padding = 2 * parseFloat(property(rule(".kova-sidebar-primary"), "padding"));
  const model = (height, rows, searchHeight = 0) => {
    const body = height - 56 - 48 - 72 - searchHeight;
    const naturalNav = rows * rowHeight + (rows - 1) * gap + padding;
    const historyMinimum = Math.min(160, body * 0.5);
    const historyHeight = Math.max(historyMinimum, body - naturalNav);
    return { body, naturalNav, historyHeight, navHeight: body - historyHeight };
  };
  for (const rows of [9, 12])
    for (const searchHeight of [0, 52]) {
      const layout = model(700, rows, searchHeight);
      assert.equal(layout.historyHeight, 160);
      assert.ok(layout.navHeight < layout.naturalNav, "Navigation must scroll");
      assert.ok(
        layout.navHeight >= rowHeight + padding,
        "One whole navigation row remains visible",
      );
      assert.equal(layout.navHeight + layout.historyHeight, layout.body);
      assert.ok(layout.historyHeight >= 16 + 20 + 8 + rowHeight * 2 + 16 + 4);
    }
  assert.equal(model(844, 9).navHeight, model(844, 9).naturalNav);
  assert.ok(model(421, 12, 52).historyHeight < 160);
});

test("mobile scroll edges reserve focus space without obscuring history", () => {
  for (const viewport of [primary, history])
    assert.equal(property(viewport, "scroll-padding-block"), "8px");
  assert.equal(property(history, "mask-image"), "none");
  const targets = rule(
    ".kova-sidebar :is(.kova-nav-row, .kova-chat-row > button, .kova-sidebar-history h2)",
    query,
  );
  assert.equal(property(targets, "scroll-margin-block"), "4px");
});

test("short-height fallback scrolls the complete drawer instead of shrinking navigation to zero", () => {
  assert.equal(primary.parent.params, query);
  assert.equal(history.parent.params, query);
  const inner = rule(".kova-sidebar-inner", "(max-height: 420px)");
  assert.equal(property(inner, "overflow-y"), "auto");
  assert.equal(property(inner, "overscroll-behavior"), "contain");
  const body = rule(".kova-sidebar-scroll", "(max-height: 420px)");
  assert.equal(property(body, "flex"), "none");
  assert.equal(property(body, "overflow"), "visible");
  assert.equal(property(rule(".kova-sidebar-scroll"), "flex"), "1");
});

test("history, primary navigation, Help and account retain their source order and separate containers", () => {
  const source = read("src/components/Sidebar.tsx");
  const file = ts.createSourceFile(
    "Sidebar.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const className = (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.attributes.properties.find(
      (attribute) => attribute.name?.getText(file) === "className",
    )?.initializer?.text;
  const body = nodes.find((node) => className(node) === "kova-sidebar-scroll");
  assert.deepEqual(body.children.filter(ts.isJsxElement).map(className), [
    "kova-sidebar-primary",
    "kova-sidebar-history",
  ]);
  const siblings = body.parent.children.flatMap((node) => {
    if (ts.isJsxElement(node)) return [className(node)];
    if (
      !ts.isJsxExpression(node) ||
      !node.expression ||
      !ts.isConditionalExpression(node.expression)
    )
      return [];
    const expression = node.expression;
    const child = ts.isParenthesizedExpression(expression.whenTrue)
      ? expression.whenTrue.expression
      : expression.whenTrue;
    if (className(child) !== "kova-sidebar-help") return [];
    assert.equal(expression.condition.getText(file), "signedIn");
    assert.equal(expression.whenFalse.kind, ts.SyntaxKind.NullKeyword);
    return [className(child)];
  });
  assert.deepEqual(siblings.slice(siblings.indexOf("kova-sidebar-scroll")), [
    "kova-sidebar-scroll",
    "kova-sidebar-help",
    "kova-sidebar-footer",
  ]);
  assert.match(source, /pinned\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.match(source, /recents\.slice\(0, 8\)\.map\(chatRow\)/);
});
