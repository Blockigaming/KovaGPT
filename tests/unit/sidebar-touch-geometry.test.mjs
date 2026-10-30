import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sidebarCss = postcss.parse(read("src/styles/sidebar-core.css"));
const responseCss = postcss.parse(read("src/components/response-action-refinement.css"));
const touchQuery = "(pointer: coarse), (max-width: 1023px)";
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const rulesFor = (sheet, selector) => {
  const matches = [];
  sheet.walkRules((rule) => {
    if (rule.selectors.map(normalize).includes(selector)) matches.push(rule);
  });
  return matches;
};
const declaration = (rule, property) =>
  rule.nodes.filter((node) => node.type === "decl" && node.prop === property).at(-1);
const ruleFor = (sheet, selector, media) => {
  const rule = rulesFor(sheet, selector).find((candidate) =>
    media ? candidate.parent.params === media : candidate.parent.type === "root",
  );
  assert.ok(rule, `Missing ${media ?? "desktop"} rule for ${selector}`);
  return rule;
};

// Source geometry and cascade checks only; actual layout remains browser coverage.
test("sidebar rows share the desktop density token and its later 44px touch override", () => {
  const selector = ".kova-sidebar[data-kova-core-sidebar]";
  const desktop = ruleFor(sidebarCss, selector);
  const touch = ruleFor(sidebarCss, selector, touchQuery);
  assert.equal(declaration(desktop, "--sidebar-row-height").value, "36px");
  assert.equal(declaration(desktop, "--sidebar-button-size").value, "32px");
  assert.equal(declaration(touch, "--sidebar-row-height").value, "44px");
  assert.equal(declaration(touch, "--sidebar-button-size").value, "44px");
  assert.ok(touch.source.start.line > desktop.source.start.line);
  for (const selector of [".kova-sidebar .kova-chat-row", ".kova-sidebar .kova-chat-row-main"]) {
    const row = ruleFor(sidebarCss, selector);
    assert.equal(declaration(row, "height").value, "var(--sidebar-row-height)");
    assert.equal(declaration(row, "min-height").value, "var(--sidebar-row-height)");
  }
  const title = ruleFor(sidebarCss, ".kova-sidebar .kova-chat-row-main");
  assert.equal(declaration(title, "min-width").value, "0");
  assert.equal(declaration(title, "overflow").value, "hidden");
});

test("sidebar touch options remain square and discoverable while header controls use the touch token", () => {
  const selector = ".kova-sidebar .kova-chat-options";
  const touch = ruleFor(sidebarCss, selector, touchQuery);
  for (const property of ["width", "min-width", "height", "min-height", "flex-basis"])
    assert.equal(declaration(touch, property).value, "44px");
  assert.equal(declaration(touch, "opacity").value, "1");
  assert.equal(declaration(touch, "margin-right").value, "0");
  const laterResets = rulesFor(sidebarCss, selector).filter(
    (candidate) =>
      candidate.source.start.line > touch.source.start.line &&
      ["width", "min-width", "height", "min-height", "flex-basis"].some((key) =>
        declaration(candidate, key),
      ),
  );
  assert.equal(laterResets.length, 0, "A later exact selector must not reset touch geometry");
  const header = ruleFor(sidebarCss, ".kova-sidebar-header .kova-header-button");
  for (const property of ["width", "min-width", "height", "min-height"])
    assert.equal(declaration(header, property).value, "var(--sidebar-button-size)");
  assert.equal(declaration(header, "flex").value, "0 0 var(--sidebar-button-size)");
  assert.match(
    read("src/components/Sidebar.tsx"),
    /aria-label=\{`Options for \$\{conversation.title\}`\}/,
  );
});

test("sidebar glyphs and account avatars retain square viewports", () => {
  const icons = ruleFor(
    sidebarCss,
    ".kova-sidebar :is(.kova-sidebar-icon, .kova-header-button, .kova-chat-options) svg",
  );
  assert.equal(declaration(icons, "width").value, "20px");
  assert.equal(declaration(icons, "height").value, "20px");
  const avatar = ruleFor(sidebarCss, ".kova-account-avatar");
  assert.equal(declaration(avatar, "width").value, "32px");
  assert.equal(declaration(avatar, "height").value, "32px");
});

test("response actions retain 32px desktop density and 44px touch targets inside an overflow toolbar", () => {
  const selector =
    ":is(.kova-assistant, .kova-project-chat) .kova-message-actions.kova-response-action-bar button.kova-message-icon-action";
  const desktop = ruleFor(responseCss, selector);
  const touch = ruleFor(responseCss, selector, "(any-pointer: coarse), (max-width: 1023px)");
  for (const property of ["width", "height", "min-width", "min-height", "flex-basis"]) {
    assert.equal(declaration(desktop, property).value, "32px");
    assert.equal(declaration(touch, property).value, "44px");
    assert.ok(!declaration(touch, property).important);
  }
  assert.ok(touch.source.start.line > desktop.source.start.line);
  const toolbar = ruleFor(responseCss, ".kova-message-actions");
  assert.equal(declaration(toolbar, "flex-wrap").value, "nowrap");
  assert.equal(declaration(toolbar, "min-width").value, "0");
  assert.equal(declaration(toolbar, "max-width").value, "100%");
  const source = read("src/components/ChatMessage.tsx");
  assert.match(source, /import "\.\/response-action-refinement\.css"/);
  assert.match(
    source,
    /kova-message-actions kova-response-action-bar mt-1 max-w-full overflow-x-auto/,
  );
  assert.match(source, /role="toolbar"\s+aria-label="Response actions"/);
});

test("help clear control, count and support action preserve space under text pressure", () => {
  const help = read("src/routes/help.tsx");
  assert.match(help, /<Button\s+variant="ghost"\s+size="icon"[\s\S]*?aria-label="Clear search"/);
  assert.match(help, /absolute right-1\.5 top-1\/2 -translate-y-1\/2/);
  assert.match(read("src/components/ui/button.tsx"), /\[@media\(pointer:coarse\)\]:min-w-11/);
  assert.match(help, /h-12 rounded-xl border-border bg-muted pl-12 pr-14/);
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
