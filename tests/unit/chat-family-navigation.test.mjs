import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { CollaborationError } from "../../src/lib/collaboration-client.mjs";

function load(path, name, bindings) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const body = source.statements
    .filter((s) => !ts.isImportDeclaration(s))
    .map((s) => s.getText(source))
    .join("\n")
    .replace(/^export /gm, "");
  const script = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = { Error, ...bindings };
  vm.runInNewContext(`${script}\nglobalThis.result = ${name};`, context);
  return context.result;
}

function history(overrides = {}) {
  const state = { epoch: 1, rows: [], writes: [], current: true };
  const persist = load("src/lib/chat-route-persistence.ts", "persistChatRoute", {
    chatHistorySnapshot: () => state.epoch,
    loadConversations: () => state.rows,
    saveConversations: async (_, rows) => {
      state.writes.push(rows);
      state.rows = rows;
      return true;
    },
    ...overrides,
  });
  return { state, persist };
}

test("chat URLs wait for storage acknowledgement and survive readback", async () => {
  let finish;
  let rows = [];
  const { persist } = history({
    loadConversations: () => rows,
    saveConversations: async (_, items) => {
      await new Promise((r) => {
        finish = r;
      });
      rows = items;
      return true;
    },
  });
  let settled = false;
  const pending = persist("alice", [{ id: "chat" }], "chat", () => true).then((v) => {
    settled = true;
    return v;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  assert.equal(await pending, true);
});

test("temporary chats never receive saved URLs or enter the saved payload", async () => {
  const { state, persist } = history();
  const rows = [{ id: "private", temporary: true }, { id: "saved" }];
  assert.equal(await persist(null, rows, "private", () => true), false);
  assert.equal(state.writes.length, 0);
  assert.equal(await persist(null, rows, "saved", () => true), true);
  assert.deepEqual(
    Array.from(state.rows, (r) => r.id),
    ["saved"],
  );
});

test("failed, omitted, or superseded history writes cannot publish a route", async () => {
  for (const saveConversations of [
    async () => false,
    async () => true,
    async () => {
      throw new Error("quota");
    },
  ]) {
    const { persist } = history({ saveConversations });
    assert.equal(await persist("alice", [{ id: "chat" }], "chat", () => true), false);
  }
  const { state, persist } = history();
  assert.equal(await persist("alice", [{ id: "chat" }], "chat", () => false), false);
  assert.equal(state.writes.length, 0);
  const pending = persist("alice", [{ id: "chat" }], "chat", () => state.current);
  state.current = false;
  assert.equal(await pending, false);
  state.current = true;
  const superseded = persist("alice", [{ id: "chat" }], "chat", () => true);
  state.epoch++;
  assert.equal(await superseded, false);
});

function canvas(reply) {
  const effects = [],
    states = [],
    requests = [];
  const hook = load("src/lib/use-canvas-collaboration.ts", "useCanvasCollaboration", {
    AbortController,
    CollaborationError,
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useState: (initial) => {
      const cell = { value: initial };
      states.push(cell);
      return [
        initial,
        (v) => {
          cell.value = v;
        },
      ];
    },
    useEffect: (fn) => effects.push(fn),
    useCollaborationPresence: () => ({}),
    parseCanvasSnapshot: (value) => value,
    mergeCanvasSnapshot: (_, value) => value,
    collaborationRequest: async (...args) => {
      requests.push(args);
      return reply;
    },
  });
  hook({
    open: true,
    actorId: "alice",
    chatId: "chat",
    messageId: "message",
    documentId: "document",
    initialContent: "",
  });
  const cleanup = effects[0]();
  return { states, requests, cleanup };
}
const snapshot = {
  document: {
    id: "document",
    chat_id: "chat",
    message_id: "message",
    revision: 1,
    content: "Saved draft",
  },
};
const flush = () => new Promise((r) => setImmediate(r));

test("direct Canvas pages fetch the exact document without creating a replacement", async () => {
  const { requests, states } = canvas(snapshot);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1], "get");
  assert.equal(requests[0][2].documentId, "document");
  assert.equal(states[0].value.snapshot.document.content, "Saved draft");
});

test("Canvas rejects mismatched documents and ignores results after leaving the page", async () => {
  const wrong = canvas({ ...snapshot, document: { ...snapshot.document, id: "other" } });
  await flush();
  assert.equal(wrong.states[0].value, null);
  assert.match(wrong.states[1].value.message, /access is unavailable/);
  const abandoned = canvas(snapshot);
  abandoned.cleanup();
  await flush();
  assert.equal(abandoned.states[0].value, null);
});

test("publishing the current chat URL preserves queued attachments; switching chats clears them", () => {
  const source = ts.createSourceFile(
    "index.tsx",
    readFileSync("src/routes/index.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("const initialHome")
    )
      effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect);
  for (const id of ["chat", "another-chat"]) {
    const cleared = [],
      selected = [];
    const context = {
      principalReady: true,
      storagePrincipal: "alice",
      routeConversationId: id,
      activeIdRef: { current: "chat" },
      lastRouteRef: { current: JSON.stringify(["alice", null]) },
      setActiveId: (value) => selected.push(value),
      setEditingMessage() {},
      setAttachments: (value) => cleared.push(value),
    };
    vm.runInNewContext(`(${effect})();`, context);
    assert.equal(cleared.length, id === "chat" ? 0 : 1);
    assert.equal(selected.length, id === "chat" ? 0 : 1);
  }
});
