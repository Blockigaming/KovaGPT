import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("context search filters the display without discarding hidden selections on save", () => {
  const text = source("routes/context-packs.tsx");
  assert.match(text, /const visibleCandidates = candidates\.filter/);
  assert.match(
    text,
    /const items = candidates\s*\.filter\(\(item\) => selected\.includes\(item\.key\)\)/,
  );
  assert.match(text, /visibleCandidates\.map\(\(item\)/);
  assert.match(text, /all\.findIndex\(\(candidate\) => candidate\.key === item\.key\) === index/);
  assert.match(text, /min-w-0 w-full h-11/);
  assert.match(text, /context items selected/);
});

test("prompt dialogs use focus-managed primitives and invalidate cancelled history loads", () => {
  const text = source("routes/prompt-studio.tsx");
  assert.equal((text.match(/<DialogContent/g) || []).length, 2);
  assert.equal((text.match(/onCloseAutoFocus=/g) || []).length, 2);
  assert.match(text, /dialogTriggerRef\.current\?\.focus\(\)/);
  assert.match(text, /request !== inspectionRequestRef\.current/);
  assert.match(text, /inspectionRequestRef\.current \+= 1/);
  assert.match(text, /aria-label="Loading prompt history"/);
  assert.doesNotMatch(text, /role="dialog"/);
});

test("graph keyboard controls preserve focus visibility and prevent Space scrolling", () => {
  const text = source("routes/knowledge-graph.tsx");
  assert.match(text, /e\.key === "Enter" \|\| e\.key === " "[\s\S]*?e\.preventDefault\(\)/);
  assert.match(text, /group-focus-visible:stroke-foreground/);
  assert.match(text, /aria-pressed=\{selected === node\.id\}/);
  assert.match(text, /onClick=\{\(\) => prepareResource\(node\)\}/);
  assert.match(text, /role="group"/);
});

test("chat study dialog restores focus to the response action that opened it", () => {
  const text = source("components/ChatStudyControl.tsx");
  const message = source("components/ChatMessage.tsx");
  assert.match(
    text,
    /onCloseAutoFocus=\{\(event\) => \{\s+event.preventDefault\(\);\s+onRestoreFocus\(\);/,
  );
  assert.match(message, /ref=\{responseMoreRef\}/);
  assert.match(message, /studyReturnFocusRef.current = responseMoreRef.current/);
  assert.match(
    message,
    /restoreDialogFocus\(studyReturnFocusRef.current, studyReturnUrlRef.current\)/,
  );
});

test("moderation inspection removes stale actions and has touch-sized disabled controls", () => {
  const text = source("routes/admin/kovas.tsx");
  assert.match(
    text,
    /async function inspect\(\) \{[\s\S]*?if \(busy[\s\S]*?setRows\(\[\]\);[\s\S]*?setBusy\(true\)/,
  );
  assert.match(text, /encodeURIComponent\(lookup\.trim\(\)\)/);
  assert.match(text, /min-h-11[^"]*disabled:cursor-not-allowed disabled:opacity-50/);
});

test("prompt loading continues when there is no saved local draft", () => {
  const text = source("routes/prompt-studio.tsx");
  assert.doesNotMatch(text, /if \(!saved\) return/);
  assert.match(text, /if \(saved\) \{/);
  assert.match(text, /Promise\.all\(\[list\(\{\}\), getProjects\(\{\}\), getPacks\(\{\}\)\]\)/);
});
