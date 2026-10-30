import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (file) => readFileSync(file, "utf8");
const directory = read("src/styles/file-directories.css");
const projects = read("src/styles/project-directory.css");
const theme = read("src/styles.css");
const tokens = read("src/styles/visual-tokens.css");

function rule(css, selector, media = null) {
  let found;
  postcss.parse(css).walkRules((node) => {
    const parentMedia = node.parent.type === "atrule" ? node.parent.params : null;
    if (node.selector.replace(/\s+/g, " ") === selector && parentMedia === media) found = node;
  });
  assert.ok(found, `Missing ${selector} in ${media ?? "desktop"}`);
  return Object.fromEntries(
    found.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
  );
}
const pageSelector = ".kova-core-page.kova-file-directory";
const page = rule(directory, pageSelector);
const title = rule(directory, `${pageSelector} .kova-page-title`);
const projectCard = rule(
  projects,
  '.kova-app-shell[data-ui="modern"] .kova-project-directory.kova-core-page.kova-file-directory.spec400-projects .kova-project-file .kova-project-file-name h3',
);

test("directory labels use the SDK UI stack while project display type is an explicit separate role", () => {
  assert.match(theme, /--font-sans:\s*var\(--font-ui\)/);
  assert.match(tokens, /--font-ui:\s*ui-sans-serif,\s*-apple-system,\s*system-ui,/);
  assert.match(tokens, /--font-reading:\s*Georgia,\s*"Times New Roman",\s*serif/);
  assert.match(tokens, /--font-display:\s*var\(--font-ui\)/);
  assert.equal(title["font-family"], "var(--font-ui)");
  assert.equal(projectCard["font-family"], "var(--font-ui)");
  assert.doesNotMatch(directory, /Georgia|Times New Roman|font-family:[^;]*\bserif\b/);
  const projectRoute = read("src/routes/projects.tsx");
  assert.match(projectRoute, /reference="claude\.projects\.header"\s+readingTitle/);
  assert.match(
    read("src/components/WorkspacePageHeader.tsx"),
    /readingTitle\s*\?\s*\{\s*fontFamily:\s*"var\(--font-reading\)"/,
  );
});

test("collection title weight and row labels have distinct, scoped typography", () => {
  assert.equal(page["--page-title-weight"], "500");
  assert.equal(title["letter-spacing"], "-0.025em");
  assert.equal(projectCard["font-weight"], "500");
  assert.equal(projectCard["letter-spacing"], "normal");
  assert.equal(projectCard["font-size"], "14px");
  assert.equal(projectCard["line-height"], "22px");
});

test("directory headings use 30/40 desktop and 24/28 phone geometry with bounded collection cards", () => {
  assert.equal(page["--page-title-size"], "30px");
  assert.equal(page["--page-title-line"], "40px");
  assert.equal(page["--surface-card-radius"], "var(--kova-radius-card)");
  assert.match(tokens, /--kova-radius-card:\s*16px;/);
  assert.match(theme, /--radius-xl:\s*var\(--kova-radius-card\);/);
  const phone = rule(directory, pageSelector, "(max-width: 767px)");
  assert.equal(phone["--page-title-size"], "24px");
  assert.equal(phone["--page-title-line"], "28px");
  assert.equal(projectCard["text-overflow"], "ellipsis");
  assert.equal(projectCard["min-width"], "0");
  assert.equal(projectCard["overflow"], "hidden");
});
