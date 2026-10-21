import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const css = readFileSync("src/styles/spec400-chat.css", "utf8");
const composer = readFileSync("src/components/ChatInput.tsx", "utf8");

test("spec400 composer owns rectangular geometry without legacy pill selectors", () => {
  assert.match(css, /\.spec400-composer\s*\{[^}]*min-height:\s*128px;[^}]*border-radius:\s*12px;/s);
  assert.match(css, /data-composer-surface="empty"[^}]*min-height:\s*160px/s);
  assert.match(
    css,
    /max-width:\s*1023px[^}]*\}[\s\S]*?\.spec400-composer\s*\{\s*min-height:\s*120px/,
  );
  assert.doesNotMatch(composer, /className="kova-composer(?:\s|")/);
});

test("spec400 fullscreen and empty-state exceptions outrank historic prototype rules", () => {
  assert.match(
    css,
    /\.kova-assistant section\.kova-empty-chat > div\.kova-empty-chat-content\s*\{[^}]*padding-block:\s*32px !important/s,
  );
  assert.match(
    css,
    /body \.spec400-context-drawer\[data-kova-dialog-surface\]\s*\{[^}]*border-radius:\s*0 !important;[^}]*max-width:\s*300px !important;[^}]*max-height:\s*100dvh !important;[^}]*translate:\s*none/s,
  );
  assert.match(
    css,
    /body \.spec400-expanded-input\[data-kova-dialog-surface\]\s*\{[^}]*border-radius:\s*0 !important;[^}]*max-width:\s*100vw !important/s,
  );
});

test("spec400 automatic retries reuse the original idempotency identity", () => {
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(route, /id: requestId \?\? newId\(\)/);
  assert.match(route, /"Idempotency-Key": userMsg\.id/);
  assert.match(
    route,
    /send\(text, atts, retryTool, _retryAttempt \+ 1, nextConvId, priorMessages, userMsg\.id\)/,
  );
});
