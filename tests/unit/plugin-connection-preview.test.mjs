import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const source = readFileSync(
  new URL("../../review-kit/components/PluginConnectionPreview.tsx", import.meta.url),
  "utf8",
);
const pure = source.slice(
  source.indexOf("export type PluginPreviewProvider"),
  source.indexOf("export function PluginConnectionPreview("),
);
const code = transformSync(pure, { loader: "ts", format: "cjs", target: "es2022" }).code;
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const { createConnectionPreviewState: create, connectionPreviewReducer: reduce } = module.exports;
const permissions = ["Read sample files", "Write sample drafts"];
function pending() {
  let state = create(permissions);
  for (const permission of permissions)
    state = reduce(state, { type: "permission", permission, checked: true });
  return reduce(state, { type: "start" });
}

test("connection preview requires all explicit sample permissions", () => {
  const initial = create(permissions);
  assert.equal(reduce(initial, { type: "start" }), initial);
  let state = reduce(initial, { type: "permission", permission: permissions[0], checked: true });
  assert.equal(reduce(state, { type: "start" }), state);
  state = reduce(state, { type: "permission", permission: permissions[1], checked: true });
  state = reduce(state, { type: "permission", permission: permissions[1], checked: false });
  assert.equal(reduce(state, { type: "start" }), state);
  assert.equal(
    reduce(state, { type: "permission", permission: "Unknown access", checked: true }),
    state,
  );
  assert.equal(pending().stage, "pending");
});

test("only pending sample connections can receive a connection outcome", () => {
  const initial = create(permissions);
  assert.equal(reduce(initial, { type: "result", result: "connected" }), initial);
  for (const result of ["connected", "failed", "denied"])
    assert.equal(reduce(pending(), { type: "result", result }).stage, result);
  const canceled = reduce(pending(), { type: "cancel" });
  assert.equal(canceled.stage, "canceled");
  assert.equal(reduce(canceled, { type: "result", result: "connected" }), canceled);
});

test("failure denial cancellation and expiry retry through fresh consent", () => {
  for (const stage of ["failed", "denied", "canceled", "reconnect"]) {
    const state = reduce({ ...pending(), stage }, { type: "retry" });
    assert.deepEqual(state, create(permissions));
    assert.equal(reduce(state, { type: "start" }), state);
  }
  const connected = reduce(pending(), { type: "result", result: "connected" });
  assert.equal(reduce(connected, { type: "expire" }).stage, "reconnect");
});

test("sample disconnect requires confirmation and can be canceled", () => {
  const connected = reduce(pending(), { type: "result", result: "connected" });
  assert.equal(reduce(connected, { type: "confirmDisconnect" }), connected);
  const confirmation = reduce(connected, { type: "disconnect" });
  assert.equal(confirmation.stage, "disconnect");
  assert.deepEqual(reduce(confirmation, { type: "keep" }), connected);
  assert.deepEqual(reduce(confirmation, { type: "confirmDisconnect" }), create(permissions));
});

test("reset clears sample state in every stage without mutating provider permissions", () => {
  for (const stage of [
    "consent",
    "pending",
    "canceled",
    "denied",
    "failed",
    "connected",
    "reconnect",
    "disconnect",
  ]) {
    assert.deepEqual(reduce({ ...pending(), stage }, { type: "reset" }), create(permissions));
  }
  const input = ["Read", "Read", "Write"];
  assert.deepEqual(create(input).permissions, ["Read", "Write"]);
  assert.deepEqual(input, ["Read", "Read", "Write"]);
});

test("review-only flow has no network, storage, provider redirect or fake account identity", () => {
  assert.doesNotMatch(
    source,
    /\b(?:fetch|useServerFn|localStorage|sessionStorage|window\.open|location\.assign|setTimeout)\s*\(/,
  );
  assert.match(source, /Connection preview · sample data/);
  assert.match(source, /preview@example\.invalid/);
  assert.match(source, /No real account is connected/);
  assert.match(source, /\{open && <PreviewSession key=\{provider\.id\}/);
});
