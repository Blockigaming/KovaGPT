import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const system = postcss.parse(read("src/styles/spec400-system.css"));
const core = postcss.parse(read("src/styles/sidebar-core.css"));
const styles = postcss.parse(read("src/styles.css"));
const scope = "body .kova-sidebar[data-kova-core-sidebar][data-kova-core-sidebar]";
const query = "(max-width: 1023px) and (min-height: 421px)";
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const property = (rule, name) => rule.nodes.findLast((node) => node.prop === name)?.value;
function rule(sheet, selector, media) {
  const matches = [];
  sheet.walkRules((candidate) => {
    if (
      normalize(candidate.selector) === selector &&
      (media ? candidate.parent.params === media : candidate.parent.type === "root")
    )
      matches.push(candidate);
  });
  assert.equal(matches.length, 1, selector);
  return matches[0];
}
const primary = rule(system, `${scope} .kova-sidebar-primary`, query);
const history = rule(system, `${scope} .kova-sidebar-history`, query);

// Source cascade and flex-size arithmetic only. Native scroll visibility,
// ring painting and keyboard navigation remain separate browser checks.
test("mobile primary navigation can shrink and scroll while history retains a usable viewport", () => {
  const desktopPrimary = rule(system, `${scope} .kova-sidebar-primary`);
  assert.equal(property(desktopPrimary, "flex-shrink"), "0");
  assert.equal(property(primary, "flex-shrink"), "1");
  assert.equal(property(primary, "min-height"), "0");
  assert.equal(property(primary, "overflow-y"), "auto");
  assert.equal(property(primary, "overscroll-behavior"), "contain");
  assert.ok(primary.source.start.line > desktopPrimary.source.start.line);
  assert.equal(property(history, "flex"), "1 1 160px");
  assert.equal(property(history, "min-height"), "min(160px, 50%)");
  const desktopHistory = rule(system, "body .kova-sidebar .kova-sidebar-history");
  assert.equal(property(desktopHistory, "min-height"), "0");
  assert.equal(property(desktopHistory, "overflow-y"), "auto");
  const body = rule(system, "body .kova-sidebar .kova-sidebar-scroll");
  assert.equal(property(body, "display"), "flex");
  assert.equal(property(body, "overflow"), "hidden");
  assert.equal(property(body, "min-height"), "0");
  assert.equal(
    property(rule(system, "body .kova-sidebar .kova-sidebar-footer"), "flex-shrink"),
    "0",
  );
});

test("700px drawer reserves heading and two full touch rows without consuming the footer", () => {
  const desktopPrimary = rule(system, `${scope} .kova-sidebar-primary`);
  const row = rule(system, `${scope} .kova-nav-row`);
  const rowHeight = parseFloat(property(row, "height"));
  const gap = parseFloat(property(desktopPrimary, "gap"));
  const padding = 2 * parseFloat(property(desktopPrimary, "padding"));
  const header = parseFloat(property(rule(system, `${scope} .kova-sidebar-header`), "height"));
  const historyBasis = Number(property(history, "flex").match(/(\d+)px$/)[1]);
  const minimum = property(history, "min-height").match(/^min\((\d+)px, (\d+)%\)$/);
  const model = (height, rows, searchHeight = 0) => {
    // Existing Help/account surfaces: 44+8px and 56+24px respectively.
    const body = height - header - 52 - 80 - searchHeight;
    const naturalNav = rows * rowHeight + (rows - 1) * gap + padding;
    const historyMin = Math.min(Number(minimum[1]), (body * Number(minimum[2])) / 100);
    const deficit = Math.max(0, naturalNav + historyBasis - body);
    const historyHeight = deficit
      ? Math.max(historyMin, historyBasis - (deficit * historyBasis) / (naturalNav + historyBasis))
      : body - naturalNav;
    return { body, naturalNav, historyHeight, navHeight: body - historyHeight };
  };
  for (const [rows, searchHeight] of [
    [9, 0],
    [12, 0],
    [9, 52],
    [12, 52],
  ]) {
    const layout = model(700, rows, searchHeight);
    assert.equal(layout.historyHeight, 160);
    assert.ok(layout.navHeight < layout.naturalNav, "Navigation becomes scrollable");
    assert.ok(layout.navHeight >= rowHeight + padding);
    assert.equal(layout.navHeight + layout.historyHeight, layout.body);
    // 20px top padding, a 24px heading allowance + 8px gap, two 44px rows,
    // and 16px bottom padding leave room for the outward 4px focus ring.
    assert.ok(layout.historyHeight >= 20 + 24 + 8 + rowHeight * 2 + 16 + 4);
  }
  const taller = model(844, 9);
  assert.equal(taller.navHeight, taller.naturalNav, "No navigation shrink when everything fits");
  const nearFallback = model(421, 12, 52);
  assert.ok(nearFallback.historyHeight < 160, "The minimum adapts when search leaves less space");
  assert.ok(nearFallback.navHeight >= rowHeight + padding);
  assert.equal(nearFallback.navHeight + nearFallback.historyHeight, nearFallback.body);
});

test("mobile scroll edges reserve the outward focus ring and remove history masking", () => {
  for (const viewport of [primary, history])
    assert.equal(property(viewport, "scroll-padding-block"), "8px");
  assert.equal(property(history, "mask-image"), "none");
  const targets = rule(
    system,
    `${scope} :is(.kova-nav-row, .kova-chat-row > button, .kova-sidebar-history h2)`,
    query,
  );
  assert.equal(property(targets, "scroll-margin-block"), "4px");
  const focus = rule(
    styles,
    ':where(a, button, input, textarea, select, [role="button"], [tabindex]):focus-visible',
  );
  assert.equal(property(focus, "outline"), "2px solid var(--ring)");
  assert.equal(property(focus, "outline-offset"), "2px");
});

test("new mobile sizing excludes desktop and the existing whole-drawer short-height fallback", () => {
  assert.equal(primary.parent.params, query);
  assert.equal(history.parent.params, query);
  const prefix = ":is(.kova-assistant, .kova-app-shell) .kova-sidebar[data-kova-core-sidebar]";
  const inner = rule(core, `${prefix} .kova-sidebar-inner`, "(max-height: 420px)");
  assert.equal(property(inner, "overflow-y"), "auto");
  assert.equal(property(inner, "overscroll-behavior"), "contain");
  const body = rule(core, `${prefix} .kova-sidebar-scroll`, "(max-height: 420px)");
  assert.equal(property(body, "flex"), "none");
  assert.equal(property(body, "overflow"), "visible");
  assert.equal(property(rule(styles, ".kova-sidebar-scroll"), "flex"), "1");
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
  const siblings = body.parent.children.filter(ts.isJsxElement).map(className);
  assert.deepEqual(siblings.slice(siblings.indexOf("kova-sidebar-scroll")), [
    "kova-sidebar-scroll",
    "kova-sidebar-help",
    "kova-sidebar-footer",
  ]);
  assert.match(source, /pinned\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.match(source, /recents\.slice\(0, 8\)\.map\(chatRow\)/);
});
