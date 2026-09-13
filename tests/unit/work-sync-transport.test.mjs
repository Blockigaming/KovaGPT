import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the shipped transport with only its Supabase session boundary substituted.
// No route, identity check, timeout or fetch implementation is rewritten.
const raw = await readFile(new URL("../../src/lib/work-sync-client.ts", import.meta.url), "utf8");
const compiled = ts
  .transpileModule(raw, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  .outputText.replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, "");
let getSession = async () => ({ data: { session: null } });
globalThis.__kovaWorkSyncTransportTest = { auth: { getSession: () => getSession() } };
const boundary = `import {readResponseBytesBounded} from ${JSON.stringify(new URL("../../src/lib/endpoint-reliability.mjs", import.meta.url).href)};\nconst supabase = globalThis.__kovaWorkSyncTransportTest;\n`;
const { requestWorkSync } = await import(
  `data:text/javascript;base64,${Buffer.from(boundary + compiled).toString("base64")}`
);
delete globalThis.__kovaWorkSyncTransportTest;
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

test("transport never sends a different signed-in account's bearer", async () => {
  let fetched = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("must not fetch");
  };
  getSession = async () => ({
    data: { session: { user: { id: otherId }, access_token: "fixture-token" } },
  });
  try {
    await assert.rejects(
      requestWorkSync(userId, "/api/work/sync", new AbortController().signal, {}),
      /identity_changed/,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("account switch aborts an unresolved session read before any fetch", async () => {
  const controller = new AbortController();
  getSession = () => new Promise(() => {});
  const request = requestWorkSync(userId, "/api/work/sync", controller.signal, {});
  controller.abort();
  await assert.rejects(request, /request_canceled/);
});

test("transport forwards the expected bearer and immutable body without caching", async () => {
  const original = globalThis.fetch;
  const body = { action: "recent", mutationId: "fixture-mutation" };
  getSession = async () => ({
    data: { session: { user: { id: userId }, access_token: "fixture-token" } },
  });
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/work/sync");
    assert.equal(init.headers.Authorization, "Bearer fixture-token");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.body, JSON.stringify(body));
    return Response.json({ result: { ok: true } });
  };
  try {
    assert.deepEqual(
      await requestWorkSync(userId, "/api/work/sync", new AbortController().signal, body),
      { result: { ok: true } },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("sync aborts oversized byte streams before buffering the whole response", async () => {
  const original = globalThis.fetch;
  let cancelled = false,
    pulls = 0;
  getSession = async () => ({
    data: { session: { user: { id: userId }, access_token: "captured-token" } },
  });
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  try {
    await assert.rejects(
      requestWorkSync(userId, "/api/work/sync", new AbortController().signal),
      /response_too_large/,
    );
    assert.equal(cancelled, true);
    assert.ok(pulls <= 10);
  } finally {
    globalThis.fetch = original;
  }
});

test("a deferred response cannot return private payload after the captured view is aborted", async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  let finishFetch, started;
  const fetching = new Promise((resolve) => {
    started = resolve;
  });
  getSession = async () => ({
    data: { session: { user: { id: userId }, access_token: "captured-token" } },
  });
  globalThis.fetch = async (path, init) => {
    assert.equal(init.headers.Authorization, "Bearer captured-token");
    started();
    return new Promise((resolve) => {
      finishFetch = resolve;
    });
  };
  try {
    const result = requestWorkSync(userId, "/api/work/execution", controller.signal);
    await fetching;
    controller.abort(new Error("view_cleared"));
    getSession = async () => ({
      data: { session: { user: { id: otherId }, access_token: "new-token" } },
    });
    finishFetch(Response.json({ private: "old owner payload" }));
    await assert.rejects(result, /view_cleared|aborted|canceled/);
  } finally {
    globalThis.fetch = original;
  }
});
