import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
const read = (path) => readFileSync(path, "utf8");
const cssFiles = [
  "src/styles.css",
  ...readdirSync("src/styles")
    .filter(
      (name) =>
        name.endsWith(".css") &&
        ![
          "assistant.css",
          "assistant-modern.css",
          "chatgpt-parity.css",
          "chatgpt-final-parity.css",
        ].includes(name),
    )
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
  control: "12px",
  input: "14px",
  compact: "10px",
  sidebar: "12px",
  card: "16px",
  menu: "16px",
  panel: "24px",
  composer: "26px",
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

test("primitive owners replace blanket action defaults without reshaping unrelated widgets", () => {
  const sheet = postcss.parse(read("src/styles/control-geometry.css"));
  sheet.walkRules((rule) => {
    if (!declarations(rule, "border-radius").length) return;
    assert.doesNotMatch(
      rule.selector,
      /button|role="(?:button|menuitem|option|tab|switch)"|kova-card|kova-sidebar-scrim/,
      "A global action policy must not force pills on rows, cards or widgets",
    );
  });
  assert.match(read("src/components/ui/button.tsx"), /data-ui-reference="chatgpt.button.pill"/);
  assert.match(read("src/components/ui/dropdown-menu.tsx"), /data-ui-reference="chatgpt.menu"/);
  assert.match(read("src/components/ui/switch.tsx"), /data-ui-reference="chatgpt.switch"/);
  assert.match(read("src/components/ui/card.tsx"), /rounded-\[var\(--kova-radius-card\)\]/);
});

test("late consumers keep ordinary actions and compact transcript icons distinct", () => {
  for (const [path, selector] of [
    ["src/styles/billing-surfaces.css", ".kova-billing-plan-action"],
    ["src/components/account-deletion-grace.css", ".kova-account-deletion-dialog button"],
    ["src/components/response-output-blocks.css", ".kova-response-copy-button"],
    ["src/components/response-output-blocks.css", ".kova-image-actions button"],
    ["src/styles/spec400-chat.css", ".spec400-toolbar-button"],
  ])
    hasRadius(path, selector, "button");
  hasRadius(
    "src/components/response-action-refinement.css",
    "button.kova-message-icon-action",
    "compact",
  );
});

test("shared buttons retain the pinned reference hierarchy and larger coarse-pointer targets", () => {
  const source = read("src/components/ui/button.tsx");
  assert.match(source, /kova-button.*rounded-full/);
  assert.match(source, /default: "h-9 /);
  assert.match(source, /sm: "h-8 /);
  assert.match(source, /lg: "h-10 /);
  assert.match(source, /icon: "h-9 w-9 /);
  assert.match(source, /prominent: "h-11 w-full /);
  assert.match(source, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.match(source, /gap-1\.5/);
  assert.match(source, /destructive: "bg-destructive text-destructive-foreground/);
});

test("listbox and menu rows use the source 32px density with 44px coarse-pointer targets", () => {
  for (const name of ["select", "dropdown-menu", "context-menu", "command"]) {
    const source = read(`src/components/ui/${name}.tsx`);
    assert.match(source, /min-h-8/);
    assert.match(source, /\[@media\(pointer:coarse\)\]:min-h-11/);
    assert.match(source, /rounded-\[6px\]/);
  }
  const options = rules("src/styles/spec400-system.css", 'body [role="option"]');
  assert.equal(options.length, 0, "No global role selector may override component row density");
});

test("menu keyboard highlight stays in menu primitives while ordinary actions retain focus rings", () => {
  for (const primitive of ["select", "dropdown-menu", "context-menu", "command"])
    assert.match(
      read(`src/components/ui/${primitive}.tsx`),
      /(?:focus|data-\[selected=true\]):bg-accent/,
    );
  assert.doesNotMatch(read("src/components/ui/button.tsx"), /focus(?:-visible)?:bg-accent/);
  const focus = rules("src/styles/control-geometry.css", ":focus-visible").filter((rule) =>
    rule.selector.startsWith(":where(button"),
  );
  assert.ok(focus.length);
  for (const rule of focus) {
    assert.equal(declarations(rule, "outline")[0].value, "2px solid var(--ring)");
    assert.equal(declarations(rule, "background").length, 0);
  }
});

test("sidebar geometry has one owner and keeps compact desktop rows separate from touch targets", () => {
  const css = read("src/styles/sidebar-core.css");
  const tokens = read("src/styles/visual-tokens.css");
  assert.match(css, /width: var\(--sidebar-expanded, var\(--kova-sidebar-width, 260px\)\)/);
  assert.match(css, /width: var\(--kova-sidebar-rail-width/);
  assert.match(css, /width: var\(--kova-sidebar-drawer-width/);
  assert.match(css, /max-width: calc\(100vw - 24px\)/);
  assert.match(tokens, /--kova-sidebar-width: 260px/);
  assert.match(tokens, /--kova-sidebar-rail-width: 56px/);
  assert.match(tokens, /--kova-sidebar-drawer-width: min\(320px, calc\(100vw - 32px\)\)/);
  const row = rules("src/styles/sidebar-core.css", ".kova-sidebar .kova-nav-row").find(
    (rule) => rule.selector === ".kova-sidebar .kova-nav-row",
  );
  assert.equal(declarations(row, "border-radius")[0].value, "8px");
  assert.match(css, /--sidebar-row-height: 36px/);
  assert.match(
    css,
    /@media \(pointer: coarse\), \(max-width: 1023px\)[\s\S]*--sidebar-row-height: 44px/,
  );
  assert.match(css, /\.kova-sidebar-primary[\s\S]*?padding: 8px/);
});

test("reading preferences retain bounds while all reading consumers use one token", () => {
  assert.match(read("src/lib/appearance-preferences.mjs"), /\[680, 760, 900\]/);
  assert.doesNotMatch(read("src/lib/appearance-preferences.mjs"), /--chat-content-width/);
  for (const path of [
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
  hasRadius(
    path,
    '.spec400-review :is(input:not([data-slot="input"]), select, textarea:not([data-slot="textarea"]))',
    "input",
  );
  hasRadius(path, ".spec400-review-card", "card");
  hasRadius(path, ".spec400-review pre", "output");
  hasRadius(path, "[data-public-shell] .public-example-composer", "composer", true);
  hasRadius(path, ".public-example-prompt", "message");
});

test("editable fields use quiet focus borders while forced colors retain an outline", () => {
  const geometry = rules("src/styles/control-geometry.css", ":focus-visible");
  const fields = geometry.find(
    (rule) => rule.selector.startsWith(":is(input") && rule.parent.type !== "atrule",
  );
  assert.ok(fields);
  assert.equal(declarations(fields, "outline")[0].value, "none");
  assert.equal(declarations(fields, "box-shadow")[0].value, "none");
  assert.match(declarations(fields, "border-color")[0].value, /50%/);
  const forced = geometry.find(
    (rule) => rule.parent.type === "atrule" && rule.parent.params === "(forced-colors: active)",
  );
  assert.ok(forced);
  assert.equal(declarations(forced, "outline")[0].value, "2px solid Highlight");
  for (const primitive of ["input", "textarea"])
    assert.match(read(`src/components/ui/${primitive}.tsx`), /focus-visible:border-foreground\/50/);
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

test("composer sample uses production inner-input and keyboard outer-focus roles", () => {
  const source = read("review-kit/components/ControlSheet.tsx");
  assert.match(source, /className="spec400-composer"/);
  assert.match(source, /data-focus-origin=\{composerFocusOrigin\}/);
  assert.match(source, /onPointerDownCapture=\{\(\) => setComposerFocusOrigin\("pointer"\)\}/);
  assert.match(source, /event.key === "Tab"/);
  assert.match(source, /id="sample-composer"[\s\S]*?className="spec400-composer-input"/);
  const composer = rules(
    "src/styles/spec400-chat.css",
    '.spec400-composer[data-focus-origin="keyboard"]:focus-within',
  )[0];
  assert.equal(declarations(composer, "outline")[0].value, "2px solid var(--ring)");
  assert.equal(declarations(composer, "outline-offset")[0].value, "2px");
  const inner = rules("src/styles/spec400-chat.css", ".spec400-composer-input").find(
    (rule) => rule.selector === ".spec400-composer-input",
  );
  assert.equal(declarations(inner, "outline")[0].value, "none");
  assert.match(source, /A multiline draft/);
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
