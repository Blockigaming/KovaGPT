import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const library = readFileSync("src/routes/library.tsx", "utf8");
const metadata = readFileSync("src/lib/library-list-metadata.ts", "utf8");
const css = readFileSync("src/styles/spec400-management.css", "utf8");
const sharedCss = readFileSync("src/styles/file-directories.css", "utf8");
const parsed = ts.createSourceFile(
  "library.tsx",
  library,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
const elements = nodes.filter(ts.isJsxElement);
const hasClass = (node, name) =>
  node.openingElement.attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(parsed) === "className" &&
      ts.isStringLiteral(attribute.initializer) &&
      attribute.initializer.text.split(/\s+/).includes(name),
  );
const elementWithClass = (name) => elements.find((node) => hasClass(node, name));
const tag = (node) => node.openingElement.tagName.getText(parsed);
const hasAncestor = (node, ancestor) => {
  for (let current = node.parent; current; current = current.parent)
    if (current === ancestor) return true;
  return false;
};

test("metadata fields live in the closed-by-default Filters popover while active chips remain outside", () => {
  const popover = elements.find((node) => tag(node) === "Popover");
  const panel = elementWithClass("spec400-library-filter-panel");
  const metadata = elementWithClass("spec400-library-metadata-filters");
  const chips = elementWithClass("spec400-filter-chips");
  assert.ok(popover && panel && metadata && chips);
  assert.ok(hasAncestor(metadata, panel));
  assert.ok(hasAncestor(panel, popover));
  assert.equal(hasAncestor(chips, popover), false);
  assert.equal(popover.openingElement.attributes.properties.length, 0);
  assert.match(panel.getText(parsed), /Source and date filters apply to loaded items/);
  assert.match(
    metadata.getText(parsed),
    /value=\{sourceFilter\} onValueChange=\{setSourceFilter\}/,
  );
  assert.match(metadata.getText(parsed), /value=\{dateFilter\} onValueChange=\{setDateFilter\}/);
  for (const reset of ['setSourceFilter("all")', 'setDateFilter("all")', 'setQuery("")'])
    assert.ok(chips.getText(parsed).includes(reset));
});

test("Library utilities share one quiet row and loaded file sizes stay within Details", () => {
  const utilities = elementWithClass("spec400-library-secondary");
  const availability = elementWithClass("spec400-library-availability");
  assert.ok(hasAncestor(availability, utilities));
  for (const label of ["Shared chats", "Folders", "Refresh Library"])
    assert.ok(utilities.getText(parsed).includes(label));
  assert.match(availability.getText(parsed), /Loaded file sizes:/);
  const header = nodes.find(
    (node) =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "WorkspacePageHeader",
  );
  assert.doesNotMatch(header.getText(parsed), /meta=|Refresh Library/);
  assert.match(header.getText(parsed), /setUploadOpen\(true\)/);
  assert.match(
    css,
    /\.spec400-library-secondary summary\s*\{[^}]*font-size: 0\.8125rem;[^}]*font-weight: 400;/,
  );
});

test("Library preview combines title and metadata in one minimum 44px target without clipping long names", () => {
  const title = elementWithClass("spec400-library-row-title");
  const button = title.parent;
  assert.equal(tag(button), "button");
  assert.match(button.openingElement.getText(parsed), /onClick=\{openPreview\}/);
  assert.match(button.getText(parsed), /className="kova-file-row-type"/);
  assert.match(library, /const metadata = libraryListMetadata\(item\)/);
  assert.match(metadata, /savedAt: item\.created_at/);
  assert.match(button.getText(parsed), /time dateTime=\{metadata.savedAt\}>Saved \{dateLabel\}/);
  assert.match(css, /\.kova-file-row-name button\s*\{[^}]*min-height: 44px;[^}]*padding: 0;/);
  assert.doesNotMatch(css, /\.kova-file-row-name button\s*\{[^}]*min-height: 24px/);
  assert.match(
    css,
    /\.spec400-library-row-title\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/,
  );
});

test("Library has 56px comfortable and 48px compact rows while selection and action targets stay 44px", () => {
  assert.match(
    css,
    /\.spec400-library\s+\.kova-file-row\s*\{[^}]*min-height: 56px;[^}]*padding: 5px 12px;/,
  );
  assert.match(
    css,
    /html\[data-kova-density="compact"\][^{]*\.spec400-library\s+\.kova-file-row\s*\{[^}]*min-height: 48px;[^}]*padding-block: 1px;/,
  );
  assert.match(sharedCss, /\.kova-file-selection-spacer\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(library, /className="flex h-11 w-11[^"\n]*"\s*aria-label=\{`Actions for/);
  assert.match(
    css,
    /\.spec400-library \.kova-file-toolbar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/,
  );
  assert.match(css, /@container \(min-width: 720px\)/);
});
