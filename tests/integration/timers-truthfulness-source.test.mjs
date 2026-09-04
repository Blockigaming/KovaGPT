import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const widget = read("src/components/TimersWidget.tsx");
const timerStore = read("src/lib/timers.ts");

test("the timer launcher is reachable, responsive, and exposes usable touch targets", () => {
  assert.doesNotMatch(widget, /visibleItems\.length === 0 && !open/);
  assert.match(widget, /bottom-\[max\(1rem,var\(--safe-bottom\)\)\]/);
  assert.match(widget, /left-\[max\(1rem,var\(--safe-left\)\)\]/);
  assert.match(widget, /right-\[max\(1rem,var\(--safe-right\)\)\]/);
  assert.match(widget, /sm:w-72/);
  assert.ok((widget.match(/min-h-11/g) ?? []).length >= 4);
  assert.match(widget, /aria-label=\{\`\$\{done \? "Remove" : "Cancel"\} \$\{t\.label\}\`\}/);
});

test("due timers are ordered and cannot repeatedly fire when storage is unavailable", () => {
  assert.match(widget, /\.sort\(\(a, b\) => a\.fireAt - b\.fireAt\)/);
  assert.match(widget, /notifiedIdsRef/);
  assert.match(widget, /notifiedIdsRef\.current\.has\(timer\.id\)/);
  assert.match(widget, /\{ \.\.\.timer, fired: true \}/);
  assert.match(widget, /The timer could not be saved in this browser/);
  assert.match(widget, /The timer could not be removed from this browser/);
});

test("timer persistence rejects malformed records and reports failed writes", () => {
  assert.match(timerStore, /typeof item\.fireAt !== "number"/);
  assert.match(timerStore, /Number\.isFinite\(item\.fireAt\)/);
  assert.match(timerStore, /slice\(0, MAX_TIMER_ITEMS\)/);
  assert.match(timerStore, /function write\([^)]*\): boolean/);
  assert.match(timerStore, /if \(!storage\) return false/);
  assert.match(timerStore, /\): TimerItem \| null/);
  assert.match(
    timerStore,
    /return write\(userKey, \[\.\.\.read\(userKey\), item\]\) \? item : null/,
  );
});
