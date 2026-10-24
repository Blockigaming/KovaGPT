import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
const read = (path) => readFileSync(path, "utf8");
const cssFiles = [
  "src/styles.css",
  ...readdirSync("src/styles")
    .filter((name) => name.endsWith(".css"))
    .map((name) => `src/styles/${name}`),
  ...[
    "account-surfaces",
    "account-deletion-grace",
    "composer-voice",
    "conversation-header",
    "response-action-refinement",
    "response-output-blocks",
    "result-editor",
    "work-browser-preview",
    "public/public-foundation",
    "public/spec400-public",
  ].map((name) => `src/components/${name}.css`),
];
const sheets = cssFiles.map((path) => [path, postcss.parse(read(path))]);
const expected = {
  button: "9999px",
  control: "14px",
  input: "14px",
  compact: "10px",
  sidebar: "14px",
  card: "20px",
  menu: "18px",
  panel: "24px",
  composer: "28px",
  message: "20px",
  output: "16px",
};
const rules = (path, fragment) => {
  const result = [];
  postcss.parse(read(path)).walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, " ").includes(fragment)) result.push(rule);
  });
  return result;
};
const declarations = (rule, prop) =>
  rule.nodes.filter((node) => node.type === "decl" && node.prop === prop);
const hasRadius = (path, fragment, token, exact = false) => {
  const found = rules(path, fragment)
    .filter((rule) => !exact || rule.selector.replace(/\s+/g, " ") === fragment)
    .flatMap((rule) => declarations(rule, "border-radius"));
  assert.ok(found.length, `Missing radius consumer: ${fragment}`);
  assert.ok(
    found.every((decl) => decl.value === `var(--kova-radius-${token})`),
    `${fragment}: ${found.map((decl) => decl.value)}`,
  );
};

test("semantic radius values have exactly one authoritative source", () => {
  for (const [name, value] of Object.entries(expected)) {
    const definitions = [];
    for (const [path, sheet] of sheets)
      sheet.walkDecls(`--kova-radius-${name}`, (decl) =>
        definitions.push({ path, value: decl.value }),
      );
    assert.deepEqual(definitions, [{ path: "src/styles/visual-tokens.css", value }]);
  }
  for (const [path, sheet] of sheets) {
    assert.doesNotMatch(
      read(path),
      /:root:root|--kova-control-radius|--chat-(?:readable|content-width|effective-radius|composer-radius|multiline-radius|user-radius|nav-radius)|--sidebar-control-radius/,
    );
    sheet.walkDecls(/^border(?:-[a-z]+)*-radius$/, (decl) =>
      assert.ok(!decl.important, `${path}: ${decl}`),
    );
  }
  assert.match(read("src/styles.css"), /@import "\.\/styles\/visual-tokens\.css"/);
  assert.match(read("src/styles.css"), /@import "\.\/styles\/control-geometry\.css"/);
});

test("action defaults explicitly exclude non-action widgets and full surfaces", () => {
  const policy = rules("src/styles/control-geometry.css", "body")[0];
  for (const exception of [
    '[role]:not([role="button"])',
    '[data-kova-button-shape="preserve"]',
    "[data-day]",
    "[data-range-middle]",
    '[role="menu"] *',
    '[role="listbox"] *',
    '[role="tablist"] *',
    ".kova-sidebar-scrim",
    ".kova-browser-card",
    ".work-browser-preview",
    ".kova-card",
    ".kova-nav-row:not(.kova-new-chat)",
    ".kova-chat-row-main",
    ".kova-account-main",
    ".kova-file-open",
    ".kova-output-row",
    ".kova-composer-action",
    ".rdp-root *",
    '[data-state="on"]',
    '[data-state="off"]',
  ])
    assert.ok(policy.selector.includes(exception), exception);
  for (const action of [
    'a[role="button"]',
    ".kova-button",
    "a.public-action",
    "a[data-public-primary]",
    "a.kova-billing-plan-action",
    ".spec400-review-toolbar a",
    ".spec400-review-actions > a",
  ])
    assert.ok(policy.selector.includes(action), action);
  assert.equal(declarations(policy, "border-radius")[0].value, "var(--kova-radius-button)");
  assert.equal(declarations(policy, "border-radius")[0].important, undefined);
});

test("known late consumer rules use the same action token", () => {
  for (const [path, selector] of [
    ["src/styles/assistant.css", "button.kova-message-icon-action"],
    ["src/components/response-action-refinement.css", "button.kova-message-icon-action"],
    ["src/styles/billing-surfaces.css", ".kova-billing-plan-action"],
    ["src/components/account-deletion-grace.css", ".kova-account-deletion-dialog button"],
    ["src/components/response-output-blocks.css", ".kova-response-copy-button"],
    ["src/components/response-output-blocks.css", ".kova-image-actions button"],
    ["src/styles/composer-core.css", ".kova-composer-utility-button"],
  ])
    hasRadius(path, selector, "button");
});

test("shared button variants separate standard and prominent dimensions", () => {
  const source = read("src/components/ui/button.tsx");
  assert.match(source, /kova-button.*rounded-\[var\(--kova-radius-button\)\]/);
  assert.match(source, /default: "h-11 px-4 py-2"/);
  assert.match(source, /sm: "min-h-11 px-4 text-sm"/);
  assert.match(source, /lg: "h-11 px-4"/);
  assert.match(source, /icon: "h-11 w-11"/);
  assert.match(source, /prominent: "h-12 w-full px-5"/);
  assert.match(source, /gap-2/);
  assert.match(source, /destructive: "bg-destructive text-destructive-foreground/);
});

test("shared listbox options have the same 44px minimum as menu rows", () => {
  const target = rules("src/styles/spec400-system.css", 'body [role="option"]')[0];
  assert.ok(target, "Listbox options participate in the authoritative shared target rule");
  assert.ok(target.selector.includes('body [role="menuitem"]'));
  assert.equal(declarations(target, "min-height")[0].value, "44px");
  assert.equal(declarations(target, "border-radius")[0].value, "var(--kova-radius-compact)");
  const legacy = rules("src/styles/chatgpt-parity.css", '[role="option"]');
  for (const rule of legacy)
    assert.equal(
      declarations(rule, "min-height").length,
      0,
      "Parity must not compete with shared option targets",
    );
});

test("menu keyboard highlight does not recolor ordinary dialog or presentation-surface actions", () => {
  for (const path of ["src/styles/chatgpt-parity.css", "src/styles/chatgpt-final-parity.css"]) {
    const highlighted = rules(path, ":focus-visible").filter((rule) =>
      declarations(rule, "background").some(
        (decl) => decl.value === "var(--accent)" && decl.important,
      ),
    );
    assert.equal(highlighted.length, 1, path);
    const highlight = highlighted[0];
    const outer = highlight.selector.match(/^:where\(([^)]+)\)/);
    assert.ok(outer, "Menu focus uses an explicit semantic ancestor scope");
    const scopes = outer[1].split(",").map((selector) => selector.trim());
    assert.deepEqual(
      new Set(scopes),
      new Set(['[role="menu"]', '[role="listbox"]', ".kova-model-menu"]),
      path,
    );
    assert.equal(declarations(highlight, "outline")[0].value, "none");
    assert.equal(declarations(highlight, "box-shadow")[0].value, "none");
    assert.ok(highlight.selector.includes('[role="menuitem"]'));
    assert.ok(highlight.selector.includes('[role="option"]'));
  }

  const ordinary = rules("src/styles/spec400-system.css", ":focus-visible").find((rule) =>
    declarations(rule, "outline").some((decl) => decl.value === "2px solid var(--ring)"),
  );
  assert.ok(ordinary, "Ordinary dialog buttons retain the shared visible keyboard outline");
  assert.ok(ordinary.selector.includes("button"));
});

test("sidebar widths have one owner and semantic navigation remains separate", () => {
  const css = read("src/styles/sidebar-core.css");
  assert.match(css, /width: var\(--kova-sidebar-width\)/);
  assert.match(css, /width: var\(--kova-sidebar-rail-width\)/);
  assert.match(css, /width: var\(--kova-sidebar-drawer-width\)/);
  assert.match(css, /max-width: calc\(100vw - 24px\)/);
  const tokens = read("src/styles/visual-tokens.css");
  assert.match(tokens, /--kova-sidebar-width: 256px/);
  assert.match(tokens, /--kova-sidebar-rail-width: 72px/);
  assert.match(tokens, /--kova-sidebar-drawer-width: min\(320px, calc\(100vw - 24px\)\)/);
  hasRadius("src/styles/sidebar-core.css", ".kova-nav-row.kova-new-chat", "button");
  hasRadius(
    "src/styles/sidebar-core.css",
    ".kova-sidebar-rail[data-kova-core-rail] .kova-rail-button",
    "control",
  );
  assert.match(css, /--sidebar-gutter: 16px/);
  assert.match(css, /--sidebar-row-height: 44px/);
});

test("reading preferences retain bounds while all reading consumers use one token", () => {
  assert.match(read("src/lib/appearance-preferences.mjs"), /\[680, 760, 900\]/);
  assert.doesNotMatch(read("src/lib/appearance-preferences.mjs"), /--chat-content-width/);
  for (const path of [
    "src/styles/assistant.css",
    "src/styles/spec400-chat.css",
    "src/components/response-action-refinement.css",
  ])
    assert.match(read(path), /var\(--kova-reading-width\)/);
});

test("mobile output actions are inset pills and table cue remains ordinary flow", () => {
  const sheet = postcss.parse(read("src/components/response-output-blocks.css"));
  const mobile = sheet.nodes.find(
    (node) => node.type === "atrule" && node.params === "(max-width: 767px)",
  );
  const footer = mobile.nodes.find(
    (node) => node.type === "rule" && node.selector === ".kova-response-copy-panel",
  );
  for (const prop of ["padding", "gap"]) assert.equal(declarations(footer, prop)[0].value, "8px");
  const button = mobile.nodes.find(
    (node) => node.type === "rule" && node.selector === ".kova-response-copy-panel button",
  );
  assert.equal(declarations(button, "border-radius")[0].value, "var(--kova-radius-button)");
  assert.equal(declarations(button, "min-height")[0].value, "44px");
  const cue = rules("src/components/response-output-blocks.css", ".kova-table-overflow-cue")[0];
  assert.equal(declarations(cue, "font-size")[0].value, "13px");
  assert.equal(declarations(cue, "padding")[0].value, "8px");
  assert.equal(declarations(cue, "position").length, 0);
  const stack = rules("src/components/response-output-blocks.css", ".kova-copy-label-stack")[0];
  assert.equal(declarations(stack, "display")[0].value, "inline-grid");
  const cells = rules(
    "src/components/response-output-blocks.css",
    ".kova-copy-label-stack > span",
  )[0];
  assert.equal(declarations(cells, "grid-area")[0].value, "1 / 1");
  const reserve = rules("src/components/response-output-blocks.css", ".kova-copy-label-reserve")[0];
  assert.equal(declarations(reserve, "visibility")[0].value, "hidden");
  assert.equal(declarations(reserve, "pointer-events")[0].value, "none");
  const component = read("src/components/ResponseMarkdown.tsx");
  assert.match(component, /className="kova-copy-label-stack"/);
  assert.equal(
    (component.match(/className="kova-copy-label-reserve" aria-hidden="true"/g) ?? []).length,
    3,
  );
});

test("public consumers split action, input, card, output and composer semantics", () => {
  const path = "src/components/public/spec400-public.css";
  assert.doesNotMatch(read(path), /\.rounded-full\)\s*\{/);
  hasRadius(path, ".spec400-review :is(input, select, textarea)", "input");
  hasRadius(path, ".spec400-review-card", "card");
  hasRadius(path, ".spec400-review pre", "output");
  hasRadius(path, "[data-public-shell] .public-example-composer", "composer", true);
  hasRadius(path, ".public-example-prompt", "message");
});

test("fields retain pointer focused borders and keyboard outlines without legacy suppression", () => {
  const css = read("src/styles.css");
  assert.doesNotMatch(css, /html\[data-kova-input-modality="pointer"\]\s*:is\(\s*button/);
  const geometry = "src/styles/control-geometry.css";
  const pointer = rules(geometry, ":is(input, textarea, select):focus").find(
    (rule) => rule.selector === ":is(input, textarea, select):focus",
  );
  assert.equal(declarations(pointer, "border-color")[0].value, "var(--ring)");
  const keyboard = rules(geometry, ":focus-visible").find((rule) =>
    rule.selector.includes(":is(input, textarea, select)"),
  );
  assert.equal(declarations(keyboard, "outline")[0].value, "2px solid var(--ring)");
  assert.equal(declarations(keyboard, "outline-offset")[0].value, "2px");
  assert.match(keyboard.selector, /:not\(\.kova-composer-input\)/);
  for (const [path, sheet] of sheets) {
    sheet.walkRules((rule) => {
      // Guard the broad field selector, while preserving targeted composer and
      // non-field widget focus handling. Important declarations here previously
      // defeated the shared field rules in the actual compiled stylesheet.
      if (!/:is\(input,\s*textarea,\s*select\):focus/.test(rule.selector)) return;
      for (const prop of ["outline", "box-shadow", "border-color"])
        for (const decl of declarations(rule, prop))
          assert.ok(!decl.important, `${path}: competing field focus ${decl}`);
    });
  }
  for (const primitive of ["input", "textarea"])
    assert.match(read(`src/components/ui/${primitive}.tsx`), /focus-visible:border-ring/);
});

test("supplied Plex interface weights are bounded to400,500,600", () => {
  for (const [path, sheet] of sheets)
    sheet.walkDecls("font-weight", (decl) => {
      if (decl.parent.type === "atrule" && decl.parent.name === "font-face") return;
      if (/^\d+$/.test(decl.value))
        assert.ok(["400", "500", "600"].includes(decl.value), `${path}: ${decl.value}`);
    });
});

test("control sheet uses real shared primitives, local state and exact viewport presets", () => {
  const source = read("review-kit/components/ControlSheet.tsx");
  assert.match(source, /CONTROL_SHEET_WIDTHS = \[320, 390, 768, 1024, 1440\]/);
  for (const primitive of [
    "button",
    "input",
    "textarea",
    "checkbox",
    "switch",
    "radio-group",
    "tabs",
    "calendar",
    "select",
    "dropdown-menu",
    "dialog",
  ])
    assert.ok(source.includes(`../../src/components/ui/${primitive}`));
  assert.match(source, /ResponseContentBox, ResponseMarkdown/);
  assert.match(source, /\["light", "dark"\]/);
  assert.match(source, /controlSheetFrame=1/);
  assert.match(source, /<iframe/);
  assert.match(source, /size="prominent"/);
  assert.match(source, /data-kova-button-shape="preserve"/);
  assert.match(source, /writeClipboard=\{writer\}/);
  assert.doesNotMatch(
    source,
    /fetch\(|authFetch|localStorage|sessionStorage|supabase|navigator\.clipboard/,
  );
  assert.match(read("review-kit/core-preview.tsx"), /has\("controlSheetFrame"\)/);
});

test("control samples own viewport scrolling and expose the same top-level review document", () => {
  const source = read("review-kit/components/ControlSheet.tsx");
  const sampleMain = source.match(/<main\s+className="([^"]+)"\s+data-control-sheet-samples/);
  assert.ok(sampleMain, "The sample scroll container remains explicitly marked");
  const classes = sampleMain[1].split(/\s+/);
  assert.ok(classes.includes("h-dvh"), "The sample viewport has a bounded height");
  assert.ok(classes.includes("overflow-y-auto"), "Content scrolls independently of the body");
  assert.ok(
    !classes.includes("min-h-dvh"),
    "The sample must not grow the document under body lock",
  );
  assert.match(source, /const sampleUrl = `\$\{window\.location\.pathname\}\?controlSheetFrame=1`/);
  assert.match(source, /<iframe[\s\S]*?src=\{sampleUrl\}/);
  assert.match(
    source,
    /<a href=\{sampleUrl\} target="_blank" rel="noopener"[^>]*>\s*Open control sample in a new tab\s*<\/a>/,
  );
  assert.match(
    source,
    /new tab starts in dark theme at full browser width, with a separate local sample/,
  );
});

test("composer sample pairs its inner textarea with the shared outer-focus surface", () => {
  const source = read("review-kit/components/ControlSheet.tsx");
  assert.match(
    source,
    /<div className="kova-composer [^"]*">\s*<label htmlFor="sample-composer">[\s\S]*?<textarea\s+id="sample-composer"\s+className="kova-composer-input /,
  );
  const inner = rules("src/styles.css", ".kova-composer textarea:focus")[0];
  assert.equal(declarations(inner, "outline")[0].value, "none");
  assert.equal(declarations(inner, "outline")[0].important, true);
  const outer = rules("src/styles.css", ".kova-composer:focus-within").find((rule) =>
    declarations(rule, "outline").some((decl) => decl.value === "2px solid var(--kova-blue)"),
  );
  assert.ok(outer, "The shared outer composer retains its visible focus treatment");
  assert.match(source, /defaultValue=\{\"A multiline draft\\nwith one outer surface\"\}/);
});

test("output samples preserve production prose context and keyboard code access", () => {
  const source = read("review-kit/components/ControlSheet.tsx");
  assert.match(source, /<div className="prose-chat">\s*<ResponseMarkdown/);
  assert.match(source, /<pre tabIndex=\{0\} aria-label="JavaScript code block">/);
  assert.match(
    read("src/components/response-output-blocks.css"),
    /body \.prose-chat \.kova-table-scroll :is\(th, td\)/,
  );
});
