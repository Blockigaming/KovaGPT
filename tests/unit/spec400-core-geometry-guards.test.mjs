import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
const read = (path) => readFileSync(path, "utf8");
test("library inspector keeps its viewport drawer and Connections uses a bounded centered dialog", () => {
  const management = read("src/styles/spec400-management.css");
  const plugins = read("src/styles/spec400-plugins.css");
  const tokens = [];
  postcss
    .parse(read("src/styles/visual-tokens.css"))
    .walkDecls("--kova-radius-panel", (decl) =>
      tokens.push({ scope: decl.parent.selector, value: decl.value }),
    );
  assert.deepEqual(tokens, [{ scope: ":root", value: "24px" }]);
  for (const [css, name] of [[management, "library"]]) {
    const kind = name === "library" ? "library-inspector" : "plugin-detail";
    const selector = `body .spec400-${kind}[data-kova-dialog-surface]`;
    const sheet = postcss.parse(css);
    const block = sheet.nodes.find((node) => node.type === "rule" && node.selector === selector);
    assert.ok(block);
    assert.equal(block.parent.type, "root");
    const declarations = Object.fromEntries(
      block.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node]),
    );
    for (const [prop, value] of Object.entries({
      inset: "0 0 0 auto",
      width: name === "library" ? "420px" : "min(100%, 420px)",
      "max-width": "100%",
      height: "100dvh",
      "max-height": "100dvh",
      margin: "0",
      transform: "none",
      translate: "none",
    })) {
      assert.equal(declarations[prop].value, value);
      assert.equal(declarations[prop].important, true, `${name}: ${prop} keeps its viewport cap`);
    }
    assert.equal(declarations["border-radius"].value, "var(--kova-radius-panel)");
    assert.ok(!declarations["border-radius"].important);
    const phone = [];
    sheet.walkRules(selector, (node) => {
      if (node.parent.type === "atrule" && node.parent.params === "(max-width: 767px)")
        phone.push(node);
    });
    assert.equal(phone.length, 1);
    assert.ok(
      phone[0].nodes.some(
        (node) => node.prop === "width" && node.value === "100%" && node.important,
      ),
      `${name} retains a full-width phone inspector`,
    );
  }
  const pluginSheet = postcss.parse(plugins);
  const pluginSelector = ".spec400-plugin-detail[data-kova-dialog-surface]";
  const pluginDialog = pluginSheet.nodes.find(
    (node) => node.type === "rule" && node.selector === pluginSelector,
  );
  assert.ok(pluginDialog);
  const pluginDeclarations = Object.fromEntries(
    pluginDialog.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node]),
  );
  for (const [property, value] of Object.entries({
    inset: "50% auto auto 50%",
    width: "min(600px, calc(100vw - 32px))",
    "max-width": "600px",
    height: "auto",
    "max-height": "calc(100dvh - 48px)",
    "border-radius": "var(--kova-radius-panel)",
    transform: "none",
    "overflow-y": "auto",
  })) {
    assert.equal(pluginDeclarations[property].value, value);
    assert.ok(!pluginDeclarations[property].important);
  }
  const sharedDialog = read("src/components/ui/dialog.tsx");
  assert.match(sharedDialog, /left-1\/2 top-1\/2/);
  assert.match(sharedDialog, /-translate-x-1\/2 -translate-y-1\/2/);
  assert.equal(
    pluginDeclarations.translate,
    undefined,
    "Connections inherits the shared individual translation without applying a second offset",
  );
  const pluginPhone = [];
  pluginSheet.walkRules(pluginSelector, (node) => {
    if (node.parent.type === "atrule" && node.parent.params === "(max-width: 639px)")
      pluginPhone.push(node);
  });
  assert.equal(pluginPhone.length, 1);
  for (const [property, value] of Object.entries({
    width: "calc(100vw - 24px)",
    "max-height": "calc(100dvh - 24px)",
    padding: "20px",
  }))
    assert.ok(pluginPhone[0].nodes.some((node) => node.prop === property && node.value === value));
  const source = read("src/routes/library.tsx");
  assert.match(source, /spec400-library-inspector-title/);
  assert.match(source, /spec400-library-inspector-actions/);
});
test("image surfaces use shared geometry and neutral progress rather than ornamental effects", () => {
  const source = read("src/routes/images.tsx");
  assert.match(
    source,
    /id="images-title"\s+className="kova-page-title text-\[30px\] leading-tight font-normal sm:text-\[36px\]"/,
  );
  assert.match(
    source,
    /className="kova-app-shell kova-images-workspace[^"\n]*"\s+data-ui="modern"/,
  );
  assert.match(source, /spec400-image-prompt[^\n]*rounded-xl/);
  assert.doesNotMatch(
    source,
    /Sparkles|bg-gradient-to-br|imgAura|floatUp|rounded-full|text-\[34px\]/,
  );
  assert.match(source, /id="image-generating-label"/);
});
test("settings bounds the workspace below its sidebar breakpoint and Work uses shared coarse44px controls", () => {
  const css = read("src/styles/settings-page-layout.css");
  assert.match(
    css,
    /\.kova-settings-route \.kova-settings-page \.kova-settings-content \{[^}]*max-width: none/,
  );
  assert.match(css, /@container settings \(max-width: 719px\)/);
  const caps = [];
  postcss.parse(css).walkDecls("max-width", (declaration) => {
    if (declaration.parent.selector?.endsWith(".kova-settings-content"))
      caps.push(declaration.value);
  });
  assert.ok(
    caps.every((value) => value === "none"),
    "Settings content stays inside its own scrollable workspace",
  );
  assert.match(css, /--page-max: 1080px/);
  const source = read("src/components/WorkExecutionPanel.tsx");
  assert.doesNotMatch(source, /ml-2 rounded border bg-background p-1/);
  assert.match(source, /import \{ Button \} from "@\/components\/ui\/button"/);
  assert.match(read("src/components/ui/button.tsx"), /\[@media\(pointer:coarse\)\]:min-h-11/);
});

test("phone Projects places description before a single primary/templates action row", () => {
  const projects = readFileSync("src/routes/projects.tsx", "utf8");
  const management = readFileSync("src/styles/spec400-management.css", "utf8");
  assert.match(
    management,
    /\.spec400-projects \.kova-page-description\s*\{\s*grid-area: 1 \/ 1 \/ 2 \/ -1/,
  );
  assert.match(management, /\.spec400-projects \.kova-project-create\s*\{\s*grid-area: 2 \/ 1/);
  assert.match(management, /\.spec400-projects \.kova-project-templates\s*\{\s*grid-area: 2 \/ 2/);
  assert.match(projects, /id="project-sort-explanation" className="sr-only"/);
  assert.match(projects, /aria-describedby="project-sort-explanation"/);
  assert.match(projects, /Last opened \(this device\)/);
  assert.match(projects, /<SelectItem value="opened-help" disabled>/);
});

test("Projects loading retains toolbar and uses matching title description metadata structure", () => {
  const projects = read("src/routes/projects.tsx");
  const management = read("src/styles/spec400-management.css");
  assert.ok(
    projects.indexOf('aria-label="Search projects"') <
      projects.indexOf('aria-labelledby="projects-loading-title"'),
  );
  assert.match(projects, /isSignedIn && \(isLoading \|\| projects.length > 0\)/);
  const loading = projects.slice(
    projects.indexOf('aria-labelledby="projects-loading-title"'),
    projects.indexOf("projects-sign-in-title"),
  );
  assert.match(loading, /kova-list kova-project-file-list/);
  assert.match(loading, /kova-grid kova-file-grid/);
  assert.match(loading, /spec400-project-skeleton-content/);
  assert.match(loading, /kova-project-file-date/);
  assert.doesNotMatch(loading, /SkeletonCard|rounded-full/);
  assert.match(
    management,
    /kova-file-loading-list\s+\.kova-file-loading-item\s*\{\s*min-height: 56px;\s*height: 56px/,
  );
  assert.match(
    management,
    /data-kova-density="compact"[\s\S]*?kova-file-loading-list[\s\S]*?min-height: 48px/,
  );
});
