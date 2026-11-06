import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { automaticMemorySource } from "../../src/lib/reviewed-memory-policy.mjs";
const source = readFileSync("src/components/ChatHistorySync.tsx", "utf8");
const ast = ts.createSourceFile(
  "sync.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let initializer;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "syncConversationSummaries")
    initializer = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const ownerId = "11111111-1111-4111-8111-111111111111";
const conversation = (id, completed = true) => ({
  id,
  title: "Question",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: `u-${id}`, role: "user", content: "What is 17 × 23?", createdAt: 1 },
    { id: `a-${id}`, role: "assistant", content: "391.", ...(completed ? { createdAt: 2 } : {}) },
  ],
});
function fixture(conversations) {
  const state = {
    settings: { rememberAcross: true, automaticMemory: true },
    blocked: false,
    records: Object.fromEntries(
      conversations.map((local) => [
        local.id,
        { id: local.id, local, revision: 1, localHash: "same", serverHash: "same", dirty: false },
      ]),
    ),
  };
  const writes = [],
    pending = [];
  const dependencies = {
    lifetime: new AbortController(),
    controller: { getState: () => state },
    ownerId,
    loadSettings: () => state.settings,
    isMemoryWriteBlocked: () => state.blocked,
    configureMemoryWrites: () => {},
    memoryLifetime: new AbortController(),
    summarized: new Map(),
    pendingSummaries: new Set(),
    automaticMemorySource,
    enqueueMemoryWrite: ({ run }) => {
      const promise = Promise.resolve().then(run);
      pending.push(promise);
      return promise;
    },
    writeMemoryForPrincipal: async (chat, principal, options) => {
      options.signal.throwIfAborted();
      writes.push({ id: chat.id, principal, options });
      return { memoryUpdated: true };
    },
  };
  const compiled = ts.transpileModule(`return (${initializer});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sync = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { state, writes, sync, drain: () => Promise.allSettled(pending) };
}
test("summary sync catches up every saved conversation without depending on the selected chat or route", async () => {
  const legacy = conversation("legacy");
  for (const m of legacy.messages) delete m.createdAt;
  const f = fixture([conversation("first"), conversation("second"), legacy]);
  f.sync();
  await f.drain();
  assert.deepEqual(
    f.writes.map((w) => w.id),
    ["first", "second", "legacy"],
  );
  assert.ok(f.writes.every((w) => w.principal === ownerId && w.options.contextSummaries === false));
  f.sync();
  await f.drain();
  assert.equal(f.writes.length, 3);
  f.state.records.first.revision = 2;
  f.sync();
  await f.drain();
  assert.equal(f.writes.length, 4);
});
test("partial generations, unsynced sources, temporary chats and opt-outs do not save", async () => {
  const f = fixture([
    conversation("streaming", false),
    { ...conversation("temporary"), temporary: true },
    conversation("dirty"),
  ]);
  f.state.records.dirty.dirty = true;
  f.sync();
  await f.drain();
  assert.equal(f.writes.length, 0);
  for (const settings of [
    { rememberAcross: false, automaticMemory: true },
    { rememberAcross: true, automaticMemory: false },
  ]) {
    const disabled = fixture([conversation("complete")]);
    disabled.state.settings = settings;
    disabled.sync();
    await disabled.drain();
    assert.equal(disabled.writes.length, 0);
  }
  const blocked = fixture([conversation("complete")]);
  blocked.state.blocked = true;
  blocked.sync();
  await blocked.drain();
  assert.equal(blocked.writes.length, 0);
});
