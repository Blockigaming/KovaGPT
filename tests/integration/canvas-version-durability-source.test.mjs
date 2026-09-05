// Canvas edit history must never claim durability it does not have.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const message = readFileSync("src/components/ChatMessage.tsx", "utf8");

test("durable versions require a signed-in user plus chat and message ids", () => {
  assert.match(editor, /const canPersistVersions = Boolean\(isSignedIn && chatId && messageId\)/);
});

test("an entry is labelled saved only after the server write resolves", () => {
  assert.match(editor, /await autosaveQueueRef\.current\s*\.enqueue/u);
  assert.match(editor, /saveVersionFn\(snapshot\)/u);
  assert.match(editor, /durable = true;/);
  assert.match(editor, /label: durable \? "Saved to this chat" : "Session only"/);
  // Unsaved entries carry an explicit badge.
  assert.match(editor, /not saved/);
});

test("save failures surface an error instead of a false success", () => {
  assert.match(editor, /only kept for the current session/);
  assert.match(editor, /role="alert"[\s\S]{0,120}historyError/);
});

test("history copy reflects whether persistence is available", () => {
  assert.match(editor, /Edits are saved to this chat and stay available after you close Canvas\./);
  assert.match(editor, /Versions are kept only while this Canvas is open\./);
});

test("ChatMessage forwards the ids Canvas needs", () => {
  assert.match(message, /chatId=\{chatId \?\? null\}/);
  assert.match(message, /messageId=\{message\.id \?\? null\}/);
});

test("Canvas never edits, exports, or saves a silently truncated document", () => {
  assert.doesNotMatch(editor, /initialContent\.slice\(0,\s*LONG_THRESHOLD\)/);
  assert.doesNotMatch(editor, /content_text: value\.slice/);
  assert.match(editor, /const blob = new Blob\(\[value\]/);
  assert.match(editor, /if \(value\.length > 200_000\)/);
  assert.match(editor, /too large for Library[\s\S]{0,100}complete file/);
  assert.match(editor, /if \(trimmed\.length > 8000\)/);
  assert.doesNotMatch(editor, /value\.trim\(\)\.slice\(0, 8000\)/);
});

test("reopening Canvas applies the accepted durable edit without racing a new local edit", () => {
  assert.match(editor, /const remoteSnapshot = collaboration.snapshot/);
  assert.match(
    editor,
    /canApplyLoadedArtifactHistory\(acknowledgedEditRevision, localEditRevisionRef\.current\) &&\s*pendingAutosavesRef\.current === 0/,
  );
  assert.match(editor, /setAcknowledgedEditRevision\(editRevision\)/);
  assert.match(editor, /const content = adoptRemote\(\)/);
  assert.match(editor, /lastRecordedValueRef\.current = content/);
  assert.match(editor, /localEditRevisionRef\.current \+= 1/u);
});

test("Canvas debounce survives its saving-state render and records the exact edit snapshot", () => {
  const autosave = editor.slice(
    editor.indexOf("useEffect(() => {", editor.indexOf("exportDocument")),
  );
  const dependencies = autosave.slice(
    autosave.indexOf("}, ["),
    autosave.indexOf("]);", autosave.indexOf("}, [")),
  );

  assert.match(autosave, /const snapshot = value/);
  assert.match(autosave, /window\.setTimeout\(\(\) => \{[\s\S]{0,120}setSaveState\("saving"\)/);
  assert.match(autosave, /content: snapshot/);
  assert.match(
    autosave,
    /await autosaveQueueRef\.current\s*\.enqueue[\s\S]{0,1200}lastRecordedValueRef\.current = snapshot/,
  );
  assert.doesNotMatch(dependencies, /saveState/);
  assert.match(editor, /setSaveState\(durable \? "saved" : "session_only"\)/);
  assert.match(editor, /saveState === "session_only"[\s\S]{0,80}"Session only"/);
});

test("Canvas serializes accepted autosaves so an older request cannot win", () => {
  assert.match(editor, /createSerializedWriteQueue\(\)/u);
  assert.match(
    editor,
    /autosaveQueueRef\.current\s*\.enqueue\(\(\) =>[\s\S]{0,300}saveVersionFn\(snapshot\)/u,
  );
});

test("Canvas queues a revert behind an in-flight edit", () => {
  assert.match(editor, /const lastScheduledValueRef = useRef\(initialContent\)/u);
  assert.match(editor, /value === lastScheduledValueRef\.current/u);
  const scheduledAt = editor.indexOf("lastScheduledValueRef.current = snapshot;");
  const queuedAt = editor.slice(scheduledAt).search(/autosaveQueueRef\.current\s*\.enqueue/u);
  assert.ok(scheduledAt >= 0);
  assert.ok(queuedAt > 0);
  const autosaveStart = editor.indexOf("useEffect(() => {", editor.indexOf("exportDocument"));
  const debounceStart = editor.indexOf("const timer =", autosaveStart);
  assert.doesNotMatch(
    editor.slice(autosaveStart, debounceStart),
    /value === lastRecordedValueRef\.current/u,
  );
  assert.match(editor, /catch \(error\)[\s\S]{0,500}recoverFailedArtifactSnapshot/u);
  assert.match(editor, /setAutosaveRetryNonce\(\(nonce\) => nonce \+ 1\)/u);
  assert.match(editor, /const autosaveGenerationRef = useRef\(0\)/u);
  assert.match(
    editor,
    /autosaveGenerationRef\.current === generation[\s\S]{0,100}lastRecordedValueRef\.current = snapshot/u,
  );
});

test("Canvas Improve uses a real text selection and refuses an empty request", () => {
  assert.match(editor, /textareaRef\.current\?\.selectionStart/);
  assert.match(editor, /textareaRef\.current\?\.selectionEnd/);
  assert.match(editor, /end > start \? value\.slice\(start, end\) : value/);
  assert.match(editor, /if \(!trimmed\)/);
});

test("Canvas session identity and generation fence late history responses", () => {
  const hook = readFileSync("src/lib/use-canvas-collaboration.ts", "utf8");
  assert.match(
    editor,
    /key=\{JSON\.stringify\(\[user\?\.id, props\.chatId, props\.messageId, props\.projectId\]\)\}/,
  );
  assert.match(editor, /if \(!props\.open\) return null/);
  const version = hook.slice(
    hook.indexOf("const versionContent"),
    hook.indexOf("const olderComments"),
  );
  assert.match(version, /epoch\.current !== generation/);
  assert.match(
    editor,
    /const generation = autosaveGenerationRef\.current;[\s\S]{0,500}collaboration\.versionContent[\s\S]{0,200}autosaveGenerationRef\.current !== generation/,
  );
});
