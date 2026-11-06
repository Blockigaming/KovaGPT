import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync("src/components/response-output-blocks.css", "utf8");
const source = readFileSync("src/components/ResponseMarkdown.tsx", "utf8");
test("inline code follows the neutral theme instead of a separate blue palette", () => {
  assert.match(css, /body \.prose-chat :not\(pre\) > code/);
  const inline = css.match(/body \.prose-chat :not\(pre\) > code\s*\{([^}]+)\}/)?.[1];
  assert.ok(inline);
  assert.match(inline, /color: var\(--foreground\)/);
  assert.match(inline, /background: var\(--surface-secondary\)/);
  assert.doesNotMatch(inline, /#[\da-f]{3,8}/i);
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
test("response footer omits Canvas and comparison actions", () => {
  const message = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.doesNotMatch(message, /Edit in Canvas|Compare versions/);
  assert.match(message, /<ResponseSpeechButton/);
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
