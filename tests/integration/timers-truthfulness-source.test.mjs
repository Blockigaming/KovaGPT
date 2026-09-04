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
  assert.match(widget, /2xl:bottom-\[max\(1rem,var\(--safe-bottom\)\)\]/);
  assert.match(widget, /top-\[calc\(4rem\+var\(--safe-top\)\)\]/);
  assert.match(widget, /flex-col-reverse/);
  assert.match(widget, /2xl:flex-col/);
  assert.match(widget, /left-\[max\(1rem,var\(--safe-left\)\)\]/);
  assert.match(widget, /right-\[max\(1rem,var\(--safe-right\)\)\]/);
  assert.match(widget, /sm:w-72/);
  assert.match(widget, /max-h-\\[calc\\(100dvh-8rem-var\\(--safe-top\\)-var\\(--safe-bottom\\)\\)\\]/);
  assert.match(widget, /overflow-y-auto/);
  assert.ok((widget.match(/min-h-11/g) ?? []).length >= 4);
  assert.match(widget, /aria-label=\{\`\$\{done \? "Remove" : "Cancel"\} \$\{t\.label\}\`\}/);
});

test("due timers are ordered and cannot repeatedly fire when storage is unavailable", () => {
  assert.match(widget, /\.sort\(\(a, b\) => a\.fireAt - b\.fireAt\)/);
  assert.match(widget, /notifiedIdsRef/);
  assert.ok((widget.match(/!notifiedIdsRef\.current\.has\(timer\.id\)/g) ?? []).length >= 2);
  assert.match(widget, /\{ \.\.\.timer, fired: true \}/);
  assert.match(widget, /Loading timers/);
  assert.ok((widget.match(/disabled=\{!ready\}/g) ?? []).length >= 2);
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
  const capGuards =
    timerStore.match(/if \(current\.length >= MAX_TIMER_ITEMS\) return null;/g) ?? [];
  assert.equal(capGuards.length, 2);
  assert.match(timerStore, /return write\(userKey, \[\.\.\.current, item\]\) \? item : null/);
});
