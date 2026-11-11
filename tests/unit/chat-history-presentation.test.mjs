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

const statusImplementation = file.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ChatHistorySyncStatus",
);
assert.ok(statusImplementation);
const statusCode = ts.transpileModule(
  `${statusImplementation.getText(file).replace(/^export\s+/, "")}\nreturn ChatHistorySyncStatus();`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
function notice(current, ownerId = "owner-a") {
  const dependencies = {
    current,
    EMPTY: state("local", null),
    subscribe: () => () => {},
    controls: new Map([[ownerId, {}]]),
    useUser: () => ({ user: ownerId ? { id: ownerId } : null }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: (initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    Button: "button",
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props ?? {},
        children: children.flat(Infinity),
      }),
    },
  };
  return new Function(...Object.keys(dependencies), statusCode)(...Object.values(dependencies));
}

test("a pending migration keeps the same notice through background sync transitions", () => {
  for (const phase of ["local", "connecting", "saving_device", "syncing", "pending", "local"]) {
    const rendered = notice({ ...state(phase), migration: 2 });
    assert.ok(rendered, `${phase} must not remove the migration decision`);
    assert.equal(rendered.props["aria-label"], "Chat history synchronization");
    const heading = rendered.children.find((node) => node?.props?.role === "status");
    assert.deepEqual(heading.children, ["Earlier chat history remains on this device"]);
  }
  assert.equal(notice(state("saved")), null, "remove the notice when no decision remains");
});

test("background sync without a migration remains quiet and critical errors remain visible", () => {
  for (const phase of [
    "local",
    "connecting",
    "saving_device",
    "syncing",
    "pending",
    "saved",
    "offline",
    "rate_limited",
  ])
    assert.equal(notice(state(phase)), null, phase);
  const rendered = notice({ ...state("auth_required"), migration: 2 });
  const heading = rendered.children.find((node) => node?.props?.role === "status");
  assert.match(heading.children.join(""), /Your session needs verification/);
});

test("a migration notice never appears for a different or signed-out account", () => {
  const pending = { ...state("local"), migration: 2 };
  assert.equal(notice(pending, "owner-b"), null);
  assert.equal(notice(pending, null), null);
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

test("rate-limited recovery stays distinct from offline through retries and clears on success", () => {
  let current = present(state("local"), state("rate_limited"));
  current = present(current, state("syncing"));
  assert.equal(current.recoveryPhase, "rate_limited");
  assert.equal(present(current, state("saved")).recoveryPhase, undefined);
  assert.equal(present(current, state("syncing", "owner-b")).recoveryPhase, undefined);
});

test("transient retries stay quiet while critical recovery remains actionable", () => {
  const migration = notice({ ...state("pending"), migration: 1, recoveryPhase: "offline" });
  assert.ok(migration, "unsaved device migration must stay visible");
  assert.doesNotMatch(JSON.stringify(migration), /Retry chat sync/);

  const critical = notice({ ...state("pending"), recoveryPhase: "device_error" });
  assert.ok(critical, "device save failure must remain visible during retry");
  assert.match(JSON.stringify(critical), /Retry chat sync/);
});
