// Canvas edit history must never claim durability it does not have.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  applySelectionEdit,
  buildRewriteInstruction,
  MAX_SELECTION_CHARS,
  validateSelectionRange,
} from "../../src/lib/selection-edit.mjs";

const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
const message = readFileSync("src/components/ChatMessage.tsx", "utf8");
const selectionDialog = readFileSync("src/components/SelectionEditDialog.tsx", "utf8");

test("durable versions require a signed-in user plus chat and message ids", () => {
  assert.match(editor, /const canPersistVersions = Boolean\(isSignedIn && chatId && messageId\)/);
});

test("an entry is labelled saved only after the server write resolves", () => {
  assert.match(editor, /await autosaveQueueRef\.current\s*\.enqueue/u);
  assert.match(editor, /saveVersionFn\(snapshot\)/u);
  assert.match(editor, /durable = true;/);
  assert.match(
    editor,
    /label: `\$\{snapshotOrigin\} · \$\{durable \? "saved to this result" : "session only"\}`/,
  );
  assert.ok(editor.indexOf("saveVersionFn(snapshot)") < editor.indexOf("durable = true;"));
  assert.ok(editor.indexOf("durable = true;") < editor.indexOf("label: `${snapshotOrigin}"));
  // Unsaved entries carry an explicit badge.
  assert.match(editor, /version\.durable \? null : \([\s\S]{0,250}not saved/);
});

test("save failures surface an error instead of a false success", () => {
  assert.match(editor, /only kept for the current session/);
  assert.match(editor, /role="alert"[\s\S]{0,120}historyError/);
});

test("history copy reflects whether persistence is available", () => {
  assert.match(
    editor,
    /canPersistVersions\s*\? "Confirmed edits stay with this result\. Preview an earlier revision before restoring it as a new revision\."\s*: "Versions are kept only while this result is open\. Save to Library or export to keep your work\."/,
  );
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
  assert.doesNotMatch(editor, /value\.trim\(\)\.slice\(0, 8000\)/);
  // Selection editing moved to its dedicated dialog. Oversized passages are
  // rejected by the shared range validator, never silently truncated.
  assert.match(
    selectionDialog,
    /validateSelectionRange\(target\.source, target\.start, target\.end\)/,
  );
  assert.match(selectionDialog, /if \(!target \|\| invalid\) return/);
  assert.match(selectionDialog, /text: selected/);
  assert.equal(MAX_SELECTION_CHARS, 8_000);
  const selected = " " + "x".repeat(MAX_SELECTION_CHARS - 2) + "\n";
  const source = `prefix\n${selected}\nsuffix`;
  const start = "prefix\n".length;
  assert.equal(validateSelectionRange(source, start, start + selected.length).selected, selected);
  assert.throws(
    () => validateSelectionRange(source, start, start + MAX_SELECTION_CHARS + 1),
    /characters or fewer/,
  );
  assert.equal(
    applySelectionEdit(source, start, start + selected.length, "replacement"),
    "prefix\nreplacement\nsuffix",
  );
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
  const source = ts.createSourceFile(
    "ArtifactEditor.tsx",
    editor,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let improve;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "improve")
      improve = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(improve, "execute the actual Result Improve callback");
  const invoke = (area, canEdit = true) => {
    const targets = [],
      errors = [];
    const bindings = {
      canPersistVersions: true,
      remoteSnapshot: { canEdit },
      textareaRef: { current: area },
      toast: { error: (message) => errors.push(message) },
      setRewriteTarget: (target) => targets.push(target),
      value: "Before\n  exact selected text  \nAfter",
    };
    new Function(...Object.keys(bindings), `return (${improve})();`)(...Object.values(bindings));
    return { targets, errors, value: bindings.value };
  };
  for (const area of [null, { selectionStart: 9, selectionEnd: 9 }]) {
    const result = invoke(area);
    assert.deepEqual(result.targets, []);
    assert.deepEqual(result.errors, ["Select the passage you want to revise first."]);
  }
  const selected = invoke({ selectionStart: 7, selectionEnd: 30 });
  assert.deepEqual(selected.targets, [{ source: selected.value, start: 7, end: 30 }]);
  assert.deepEqual(selected.errors, []);
  assert.deepEqual(invoke({ selectionStart: 7, selectionEnd: 30 }, false).targets, []);
  assert.match(editor, /<SelectionEditDialog[\s\S]{0,180}target=\{rewriteTarget\}/);
  assert.match(selectionDialog, /if \(!instruction\.trim\(\)\)/);
  assert.throws(() => buildRewriteInstruction(" \n ", "selected text"), /Describe how/);
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
