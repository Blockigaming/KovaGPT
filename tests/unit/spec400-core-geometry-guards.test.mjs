import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(path, "utf8");
test("inspectors override centered dialog caps and separate title from actions", () => {
  const management = read("src/styles/spec400-management.css");
  const plugins = read("src/styles/spec400-plugins.css");
  for (const [css, name] of [
    [management, "library"],
    [plugins, "plugin"],
  ]) {
    const selector = name === "library" ? "library-inspector" : "plugin-detail";
    const block = css.match(
      new RegExp(`body \\.spec400-${selector}\\[data-kova-dialog-surface\\] \\{([^}]+)\\}`),
    );
    assert.ok(block);
    assert.match(block[1], /height: 100dvh !important/);
    assert.match(block[1], /border-radius: 0 !important/);
  }
  const source = read("src/routes/library.tsx");
  assert.match(source, /spec400-library-inspector-title/);
  assert.match(source, /spec400-library-inspector-actions/);
});
test("image surfaces use shared geometry and neutral progress rather than ornamental effects", () => {
  const source = read("src/routes/images.tsx");
  assert.match(
    source,
    /text-2xl leading-8 font-semibold tracking-normal sm:text-\[28px\] sm:leading-9/,
  );
  assert.match(source, /spec400-image-prompt[^\n]*rounded-xl/);
  assert.doesNotMatch(
    source,
    /Sparkles|bg-gradient-to-br|imgAura|floatUp|rounded-full|text-\[34px\]/,
  );
  assert.match(source, /id="image-generating-label"/);
});
test("settings keeps its760px content cap below sidebar breakpoint and Work controls remain44px", () => {
  const css = read("src/styles/spec400-system.css");
  assert.match(
    css,
    /@container settings \(max-width:959px\) \{\s*body \.kova-settings-page \.kova-settings-content \{\s*max-width: 760px/,
  );
  const source = read("src/components/WorkExecutionPanel.tsx");
  assert.doesNotMatch(source, /ml-2 rounded border bg-background p-1/);
  assert.match(source, /min-h-11 rounded-lg border border-border px-3 text-sm/);
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
  assert.match(projects, /<option value="opened-help" disabled>/);
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
