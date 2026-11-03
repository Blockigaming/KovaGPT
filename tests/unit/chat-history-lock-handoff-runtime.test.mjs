import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/ChatHistorySync.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChatHistorySync.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "acquire") callback = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback, "exercise the production lock callback");
const executable = ts.transpileModule(`const acquire = ${callback.getText(ast)}; acquire;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness() {
  const lifetime = new AbortController();
  const requests = [];
  const events = [];
  const view = { writable: false };
  let initialized = 0;
  const context = {
    lifetime,
    ownerId: "owner-a",
    view,
    controller: null,
    legacy: { active: [], archived: [] },
    controls: new Map(),
    channel: null,
    event: (phase) => events.push(phase),
    readOnlyRefresh: async () => {},
    loadChatHistoryDevice: async () => null,
    commitChatHistoryDevice: async () => {},
    requestWorkSync: async () => {},
    notifyChatHistoryChanged: () => {},
    tick: async () => {},
    createChatHistoryController: () => ({
      initialize: async () => {
        initialized += 1;
      },
    }),
    navigator: {
      locks: {
        request(name, options, acquire) {
          assert.equal(name, "kova-chat-history:owner-a");
          assert.equal(options.signal, lifetime.signal);
          assert.equal(options.steal, undefined);
          assert.equal(options.ifAvailable, undefined);
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
            requests.push({ acquire, resolve, reject });
          });
        },
      },
    },
  };
  const acquire = vm.runInNewContext(executable, context);
  return { acquire, context, lifetime, requests, events, view, initialized: () => initialized };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("a blocked tab waits without stealing or writing and resumes on release", async () => {
  const h = harness();
  const waiting = h.acquire(null);
  await flush();
  assert.equal(h.view.writable, false);
  assert.equal(h.initialized(), 0);
  assert.deepEqual(h.events, ["other_tab"]);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  const owned = request.acquire({ name: "kova-chat-history:owner-a" });
  await flush();
  assert.equal(h.initialized(), 1);
  assert.equal(h.view.writable, true);
  assert.deepEqual(h.events, ["other_tab", "connecting"]);
  h.lifetime.abort();
  await owned;
  request.resolve();
  await waiting;
});

test("unmount cancels a queued writer without initializing or becoming writable", async () => {
  const h = harness();
  const waiting = h.acquire(null);
  const rejection = assert.rejects(waiting, { name: "AbortError" });
  await flush();
  h.lifetime.abort();
  await rejection;
  assert.equal(h.initialized(), 0);
  assert.equal(h.view.writable, false);
});

test("an already stopped owner neither queues nor initializes", async () => {
  const h = harness();
  h.lifetime.abort();
  await h.acquire(null);
  await h.acquire({ name: "kova-chat-history:owner-a" });
  assert.equal(h.requests.length, 0);
  assert.equal(h.initialized(), 0);
});

test("ownership initialization must finish before the composer becomes writable", async () => {
  const h = harness();
  let finish;
  h.context.createChatHistoryController = () => ({
    initialize: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const owned = h.acquire({ name: "kova-chat-history:owner-a" });
  await flush();
  assert.equal(h.view.writable, false);
  finish();
  await flush();
  assert.equal(h.view.writable, true);
  h.lifetime.abort();
  await owned;
});

test("an owner stopped during initialization cannot enable editing", async () => {
  const h = harness();
  let finish;
  h.context.createChatHistoryController = () => ({
    initialize: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const owned = h.acquire({ name: "kova-chat-history:owner-a" });
  await flush();
  h.lifetime.abort();
  finish();
  await owned;
  assert.equal(h.view.writable, false);
});
