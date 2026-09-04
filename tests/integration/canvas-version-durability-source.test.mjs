// Canvas edit history must never claim durability it does not have.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const message = readFileSync("src/components/ChatMessage.tsx", "utf8");
const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");

test("durable versions require a signed-in user plus chat and message ids", () => {
  assert.match(editor, /const canPersistVersions = Boolean\(isSignedIn && chatId && messageId\)/);
});

test("an entry is labelled saved only after the server write resolves", () => {
  assert.match(editor, /await autosaveQueueRef\.current\.enqueue/u);
  assert.match(editor, /saveVersionFn\(\{/u);
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
  assert.match(editor, /const accepted = rows\.find\(\(row\) => row\.accepted\)/);
  assert.match(
    editor,
    /if \(current !== initialContent\) return current;[\s\S]{0,100}autosaveQueueRef\.current\.reset\(accepted\.content\)/,
  );
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
  assert.match(autosave, /autosaveQueueRef\.current\.needsSync\(value\)/);
  assert.match(autosave, /content: queuedSnapshot/);
  assert.match(autosave, /if \(cancelled\) return;[\s\S]{0,100}\.acknowledge\(snapshot\)/);
  assert.doesNotMatch(autosave, /lastRecordedValueRef/);
  assert.doesNotMatch(dependencies, /saveState/);
  assert.match(editor, /setSaveState\(durable \? "saved" : "session_only"\)/);
  assert.match(editor, /saveState === "session_only"[\s\S]{0,80}"Session only"/);
});

test("Canvas tracks enqueue intent before serializing accepted autosaves", () => {
  assert.match(editor, /createSerializedSnapshotQueue\(initialContent\)/u);
  assert.match(
    editor,
    /autosaveQueueRef\.current\.enqueue\(snapshot, \(queuedSnapshot\) =>[\s\S]{0,300}saveVersionFn\(\{/u,
  );
  assert.match(editor, /content: queuedSnapshot/u);
});

test("Canvas Improve uses a real text selection and refuses an empty request", () => {
  assert.match(editor, /textareaRef\.current\?\.selectionStart/);
  assert.match(editor, /textareaRef\.current\?\.selectionEnd/);
  assert.match(editor, /end > start \? value\.slice\(start, end\) : value/);
  assert.match(editor, /if \(!trimmed\)/);
});

test("Canvas applies only the resolved principal's supported workspace default", () => {
  assert.match(editor, /loadPrincipalStoredRecord\(/u);
  assert.match(editor, /WORKSPACE_DEFAULTS_KEY_BASE/u);
  assert.match(editor, /if \(!open \|\| !isLoaded\) return/u);
  assert.match(editor, /migrateLegacyGuest: userKey === null/u);
  assert.match(editor, /\}, \[open, isLoaded, userKey, kind, initialMode\]\)/u);
  const preferenceEffect = editor.slice(
    editor.indexOf("// Authentication may resolve"),
    editor.indexOf("// Load durable versions"),
  );
  assert.doesNotMatch(preferenceEffect, /setValue|autosaveQueueRef\.current\.reset/u);
  assert.doesNotMatch(editor, /localStorage\.getItem\("kova-workspace-defaults-v1"\)/u);
});

test("settings expose only workspace defaults with real consumers", () => {
  assert.match(settings, /"prompt", "Prompt defaults"/u);
  assert.match(settings, /"research",\s*"Research defaults"/u);
  assert.match(settings, /"artifact", "Artifact defaults"/u);
  assert.doesNotMatch(settings, /"project", "Project defaults"/u);
  assert.doesNotMatch(settings, /"work", "Work defaults"/u);
});
