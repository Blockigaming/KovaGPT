import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const css = postcss.parse(read("src/styles.css"));
const touchQuery = "(pointer: coarse), (max-width: 1023px)";
const rulesFor = (selector) => {
  const matches = [];
  css.walkRules((rule) => {
    if (rule.selectors.includes(selector)) matches.push(rule);
  });
  return matches;
};
const declaration = (rule, property) =>
  rule.nodes.filter((node) => node.type === "decl" && node.prop === property).at(-1);
const touchRule = (selector) => {
  const rules = rulesFor(selector);
  const rule = rules.findLast(
    (candidate) => candidate.parent.type === "atrule" && candidate.parent.params === touchQuery,
  );
  assert.ok(rule, `Missing explicit touch rule for ${selector}`);
  return rule;
};

// These inspect source declarations and ordering only; they do not render a page.
test("sidebar touch rows override compact desktop height and button minimum in source order", () => {
  assert.equal(declaration(rulesFor(":root")[0], "--kova-touch").value, "44px");
  const desktopRow = rulesFor(".kova-chat-row").findLast((rule) => declaration(rule, "height"));
  const desktopButton = rulesFor(".kova-sidebar .kova-chat-row > button").find(
    (rule) => rule.parent.type === "root",
  );
  assert.equal(declaration(desktopRow, "height").value, "2.25rem");
  assert.equal(declaration(desktopButton, "min-height").value, "2.25rem");
  for (const [selector, property, desktop] of [
    [".kova-sidebar .kova-chat-row", "height", desktopRow],
    [".kova-sidebar .kova-chat-row > button", "min-height", desktopButton],
  ]) {
    const rule = touchRule(selector);
    assert.equal(declaration(rule, property).value, "var(--kova-touch)");
    assert.ok(rule.source.start.line > desktop.source.start.line);
    // The touch selector is at least as specific as its desktop predecessor.
    assert.ok(selector.split(".").length >= desktop.selector.split(".").length);
  }
});

test("sidebar touch icon controls use stable classes, square targets and discoverable options", () => {
  for (const selector of [
    ".kova-sidebar .kova-chat-options",
    ".kova-sidebar-header .kova-header-button",
  ]) {
    const rule = touchRule(selector);
    for (const property of ["width", "min-width", "height", "flex-basis"])
      assert.equal(declaration(rule, property).value, "var(--kova-touch)");
    const laterGeometry = rulesFor(selector).filter(
      (candidate) =>
        candidate.source.start.line > rule.source.start.line &&
        ["width", "min-width", "height", "flex-basis"].some((key) => declaration(candidate, key)),
    );
    assert.equal(laterGeometry.length, 0, "No later exact-selector target-size reset");
  }
  assert.equal(declaration(touchRule(".kova-sidebar .kova-chat-options"), "opacity").value, "1");
  assert.match(
    read("src/components/Sidebar.tsx"),
    /aria-label=\{`Options for \$\{conversation.title\}`\}/,
  );
});

test("sidebar ellipsis and account icons retain square SVG viewports", () => {
  for (const selector of [".kova-chat-options svg", ".kova-account-action svg"]) {
    const rule = rulesFor(selector).at(-1);
    assert.equal(declaration(rule, "width").value, declaration(rule, "height").value);
  }
});

test("response actions retain desktop density and use 44px touch targets inside an overflow toolbar", () => {
  const selector = ".kova-message-actions button.kova-message-icon-action";
  const desktop = rulesFor(selector).find((rule) => rule.parent.type === "root");
  assert.equal(declaration(desktop, "width").value, "30px");
  assert.equal(declaration(desktop, "height").value, "32px");
  const touch = touchRule(selector);
  for (const property of ["width", "height", "min-width", "min-height", "flex-basis"]) {
    assert.equal(declaration(touch, property).value, "var(--kova-touch)");
    assert.equal(declaration(touch, property).important, true);
  }
  assert.match(
    read("src/components/ChatMessage.tsx"),
    /kova-message-actions kova-response-action-bar mt-1 max-w-full overflow-x-auto/,
  );
});

test("help clear control, result count and support action preserve their geometry under text pressure", () => {
  const help = read("src/routes/help.tsx");
  assert.match(help, /absolute right-1\.5 top-1\/2 flex size-11 -translate-y-1\/2/);
  assert.match(help, /h-14 rounded-2xl border-border bg-card pl-12 pr-14/);
  assert.match(help, /id="answers-heading" className="min-w-0 text-xl font-semibold"/);
  assert.match(
    help,
    /shrink-0 whitespace-nowrap text-sm text-muted-foreground">\s*\{results.length\}/,
  );
  assert.match(read("src/components/HelpSupportForm.tsx"), /h-12 w-full shrink-0 px-6 sm:w-auto/);
  assert.match(help, /\[overflow-wrap:anywhere\]">\s*No answers found/);
  assert.match(
    read("src/components/HelpSupportForm.tsx"),
    /max-w-lg text-left text-sm leading-6 text-muted-foreground \[overflow-wrap:anywhere\]/,
  );
});
