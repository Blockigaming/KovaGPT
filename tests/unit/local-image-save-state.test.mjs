import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { deferred } from "../helpers/ui-state-harness.mjs";
function saveCallback(env) {
  const source = ts.createSourceFile(
    "image.tsx",
    readFileSync("src/components/LocalImageEditor.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let code;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === "saveCopy")
      code = n.initializer.getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  const js = ts.transpileModule("const fn=" + code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), js + ";return fn;")(...Object.values(env));
}
function fixture() {
  const state = {},
    calls = [],
    waits = [],
    env = {
      actor: "owner",
      current: { blob: new Blob(["first pixel snapshot"], { type: "image/png" }) },
      pending: { current: false },
      active: { current: true },
      attempt: { current: null },
      source: { prompt: "Original", id: "original" },
      crypto: webcrypto,
      setSaving: (v) => (state.saving = v),
      setError: (v) => (state.error = v),
      setSaved: (v) => (state.saved = v),
      dataUrl: async (blob) =>
        "data:image/png;base64," + Buffer.from(await blob.arrayBuffer()).toString("base64"),
      save: (request) => {
        const d = deferred();
        calls.push({ request, ...d });
        waits[calls.length - 1]?.resolve();
        return d.promise;
      },
    };
  return {
    env,
    state,
    calls,
    wait: (index) => {
      if (calls[index]) return Promise.resolve();
      waits[index] ??= deferred();
      return waits[index].promise;
    },
  };
}
test("image save binds exact edited bytes and identity, retaining newer edits and original", async () => {
  const f = fixture(),
    first = f.env.current.blob,
    run = saveCallback(f.env);
  const pending = run();
  await f.wait(0);
  await run();
  assert.equal(f.calls.length, 1);
  f.env.current = { blob: new Blob(["newer pixels"], { type: "image/png" }) };
  f.calls[0].resolve({ id: "saved-copy" });
  await pending;
  assert.equal(f.state.saved.blob, first);
  assert.notEqual(f.state.saved.blob, f.env.current.blob);
  assert.equal(f.env.source.id, "original");
  assert.equal(f.calls[0].request.data.expectedOwnerId, "owner");
  assert.equal(
    f.calls[0].request.data.imageUrl,
    "data:image/png;base64," + Buffer.from(await first.arrayBuffer()).toString("base64"),
  );
});
test("unknown edited-copy save retries same identity; unmount suppresses late acknowledgement", async () => {
  const f = fixture();
  const first = saveCallback(f.env)();
  await f.wait(0);
  f.calls[0].reject(new Error("lost receipt"));
  await first;
  const retry = saveCallback(f.env)();
  await f.wait(1);
  assert.equal(f.calls[1].request.data.idempotencyKey, f.calls[0].request.data.idempotencyKey);
  f.env.active.current = false;
  f.calls[1].resolve({ id: "saved" });
  await retry;
  assert.equal(f.state.saved, undefined);
});
