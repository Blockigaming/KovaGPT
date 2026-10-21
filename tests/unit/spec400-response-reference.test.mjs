import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync("src/components/response-output-blocks.css", "utf8");
const source = readFileSync("src/components/ResponseMarkdown.tsx", "utf8");
test("blue response accent is scoped to inline code, with both theme contrasts", () => {
  assert.match(css, /body \.prose-chat :not\(pre\) > code/);
  assert.match(css, /html\.dark body \.prose-chat :not\(pre\) > code/);
  assert.match(css, /#1555a5/);
  assert.match(css, /#8cbeff/);
});
test("table stays semantic and independently scrollable with horizontal separators", () => {
  assert.match(source, /<table ref=\{table\}>\{children\}<\/table>/);
  assert.match(source, /aria-label="Scrollable comparison table"/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /border-bottom: 1px solid var\(--border\)/);
  assert.match(css, /border-radius: var\(--kova-radius-output\)/);
});
test("neutral code boxes use the actual theme foreground", () => {
  assert.match(css, /\.prose-chat \.kova-response-output pre \{\s*color: var\(--foreground\);/);
  assert.match(css, /\.kova-response-output pre code \{\s*color: inherit;/);
});
test("narrow Open result keeps its full accessible name with a compact target", () => {
  const actions = readFileSync("src/components/response-action-refinement.css", "utf8");
  const message = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.match(actions, /@media \(max-width: 359px\)/);
  assert.match(actions, /\.kova-open-result-action > span \{\s*display: none/);
  assert.match(
    message,
    /aria-label=\{artifactKind === "code" \? "Open code result" : "Open writing result"\}/,
  );
});

test("image action controls retain common padding and ordinary icon tokens", () => {
  assert.match(
    css,
    /\.kova-image-actions button \{[^}]*min-height: 44px;[^}]*border-radius: var\(--kova-radius-button\);[^}]*padding: 0 16px;/s,
  );
  assert.match(css, /\.kova-image-actions svg \{\s*width: 20px;\s*height: 20px;/);
  const image = readFileSync("src/components/ResponseImage.tsx", "utf8");
  assert.match(image, /className="spec400-loading-spinner"/);
});
