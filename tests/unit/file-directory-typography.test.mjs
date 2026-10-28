import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directory = readFileSync("src/styles/file-directories.css", "utf8");
const shared = readFileSync("src/styles/core-pages.css", "utf8");
const theme = readFileSync("src/styles.css", "utf8");
const tokens = readFileSync("src/styles/visual-tokens.css", "utf8");
const block = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing ${selector}`);
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
};
const page = block(directory, ".kova-core-page.kova-file-directory");
const title = block(directory, ".kova-core-page.kova-file-directory .kova-page-title");
const projectTitle = block(
  directory,
  ".kova-core-page.kova-file-directory .kova-project-file-name h3",
);

test("directory base styles preserve inherited font tokens", () => {
  assert.match(theme, /--font-sans:\s*"IBM Plex Sans"/);
  assert.match(title, /font-family: var\(--font-sans\) !important;/);
  assert.match(projectTitle, /font-family: var\(--font-sans\);/);
  assert.doesNotMatch(directory, /Georgia|Times New Roman|font-family:[^;]*\bserif\b/);
});

test("directory base weight tokens remain shared without changing tracking", () => {
  assert.match(block(shared, ".kova-directory"), /--page-title-weight: 500;/);
  assert.match(page, /--page-title-weight: 500;/);
  assert.match(projectTitle, /font-weight: 500;/);
  assert.match(title, /letter-spacing: -0\.035em !important;/);
  assert.match(projectTitle, /letter-spacing: -0\.02em;/);
});

test("directory headings preserve desktop, phone, and project title geometry", () => {
  assert.match(page, /--page-title-size: 32px;/);
  assert.match(page, /--page-title-line: 40px;/);
  assert.match(page, /--surface-card-radius: var\(--kova-radius-card\);/);
  assert.match(tokens, /--kova-radius-card: 20px;/);
  assert.match(theme, /--radius-xl: var\(--kova-radius-card\);/);
  const phone = block(
    directory.slice(directory.indexOf("@media (max-width: 767px)")),
    ".kova-core-page.kova-file-directory",
  );
  assert.match(phone, /--page-title-size: 28px;/);
  assert.match(phone, /--page-title-line: 36px;/);
  assert.match(projectTitle, /font-size: 20px;/);
  assert.match(projectTitle, /line-height: 27px;/);
  assert.match(projectTitle, /-webkit-line-clamp: 2;/);
  const rowTitle = block(
    directory,
    ".kova-core-page.kova-file-directory .kova-project-file-row .kova-project-file-name h3",
  );
  assert.match(rowTitle, /font-size: 18px;/);
  assert.match(rowTitle, /line-height: 24px;/);
});
