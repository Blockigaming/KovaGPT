import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync("src/components/ChatInput.tsx", "utf8");

test("mobile long press opens the real image picker, not the attachment sheet", () => {
  assert.match(composer, /press\.startedAt >= 500/);
  assert.match(composer, /plusLongPressRef\.current/);
  assert.match(composer, /photoRef\.current\?\.click\(\)/);
  assert.match(composer, /setPlusOpen\(false\)/);
  assert.match(composer, /onChange=\{onFileChange\}/);
});

test("photo shortcut keeps normal tap, modal accessibility and sign-in checks", () => {
  assert.match(composer, /aria-label="Attach"/);
  assert.match(composer, /if \(!requireFileAccount\(event\.currentTarget\)\) return/);
  assert.match(composer, /setPlusOpen\(true\)/);
  assert.match(composer, /onContextMenu=\{\(event\) => \{/);
  assert.match(
    composer,
    /Math\.hypot\(event\.clientX - press\.x, event\.clientY - press\.y\) > 12/,
  );
});
