import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/ChatHistorySync.tsx", "utf8");
const file = ts.createSourceFile(
  "sync.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const implementation = file.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "chatHistoryPresentation",
);
assert.ok(implementation);
const compiled = ts.transpileModule(
  `${implementation.getText(file)}\nexport { chatHistoryPresentation };`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  },
).outputText;
const { chatHistoryPresentation: present } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const state = (phase, ownerId = "owner-a") => ({
  ownerId,
  phase,
  error: null,
  pending: 0,
  migration: 0,
  conflicts: [],
});

test("automatic retries retain the existing recovery message and action", () => {
  let current = present(state("local"), state("offline"));
  for (const phase of ["connecting", "saving_device", "syncing", "pending", "syncing"]) {
    current = present(current, state(phase));
    assert.equal(current.phase, phase);
    assert.equal(current.recoveryPhase, "offline");
  }
});

test("successful sync and terminal states clear the retained recovery presentation", () => {
  const offline = present(state("local"), state("offline"));
  for (const phase of ["saved", "conflict", "cleared", "unavailable", "other_tab"]) {
    assert.equal(present(offline, state(phase)).recoveryPhase, undefined, phase);
  }
});

test("a different account never inherits the previous account's recovery state", () => {
  const offline = present(state("local"), state("offline"));
  assert.equal(present(offline, state("syncing", "owner-b")).recoveryPhase, undefined);
});

test("a new recovery failure replaces the retained message with its current cause", () => {
  const offline = present(state("local"), state("offline"));
  const retrying = present(offline, state("syncing"));
  assert.equal(present(retrying, state("device_error")).recoveryPhase, "device_error");
  assert.equal(present(retrying, state("blocked")).recoveryPhase, "blocked");
});
