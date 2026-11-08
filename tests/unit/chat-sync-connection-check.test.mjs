import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
const file = ts.createSourceFile(
  "sync.tsx",
  readFileSync("src/components/ChatHistorySync.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let node;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === "checkConnection") node = n;
  ts.forEachChild(n, visit);
}
visit(file);
assert.ok(node);
const code = ts.transpileModule(`${node.getText(file)};return checkConnection`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(transport) {
  const busy = [],
    connection = [],
    calls = [],
    checkGeneration = { current: 0 },
    checkOwner = { current: "owner-a" },
    signal = {};
  const deps = {
    state: { ownerId: "owner-a" },
    busy: false,
    setBusy: (v) => busy.push(v),
    setConnection: (v) => connection.push(v),
    checkGeneration,
    checkOwner,
    AbortSignal: {
      timeout: (ms) => {
        assert.equal(ms, 15000);
        return signal;
      },
    },
    requestWorkSync: async (...args) => {
      calls.push(args);
      return transport();
    },
  };
  return {
    run: new Function(...Object.keys(deps), code)(...Object.values(deps)),
    busy,
    connection,
    calls,
    checkGeneration,
    checkOwner,
    signal,
  };
}
test("connection check reads only the captured account and accepts an owner-bound history page", async () => {
  const f = fixture(async () => ({ ownerId: "owner-a", epoch: "epoch", records: [] }));
  await f.run();
  assert.deepEqual(f.busy, [true, false]);
  assert.deepEqual(f.connection, [{ ownerId: "owner-a", phase: "connected" }]);
  assert.deepEqual(f.calls, [["owner-a", "/api/chat/history?cursor=0", f.signal]]);
});
test("connection check does not publish private error details or accept a different account page", async () => {
  for (const response of [
    null,
    { ownerId: "owner-b", epoch: "epoch", records: [] },
    { ownerId: "owner-a" },
  ]) {
    const f = fixture(async () => response);
    await f.run();
    assert.deepEqual(f.connection, [{ ownerId: "owner-a", phase: "failed" }]);
  }
  const f = fixture(async () => {
    throw new Error("private backend message");
  });
  await f.run();
  assert.equal(JSON.stringify(f.connection).includes("private"), false);
  assert.equal(f.connection[0].phase, "failed");
});
test("late check results cannot publish or clear a replacement account pending state", async () => {
  let finish;
  const pending = new Promise((r) => (finish = r));
  const f = fixture(() => pending);
  const checking = f.run();
  f.checkOwner.current = "owner-b";
  f.checkGeneration.current++;
  finish({ ownerId: "owner-a", epoch: "epoch", records: [] });
  await checking;
  assert.deepEqual(f.connection, []);
  assert.deepEqual(f.busy, [true]);
});
