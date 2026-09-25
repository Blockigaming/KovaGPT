import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  fetchForPrincipal,
  writeMemoryForPrincipal,
} from "../../src/lib/chat-summary-snapshot.mjs";
import { requestDiscovery } from "../../src/lib/discovery/discovery-client.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = { user: { id: owner }, access_token: "original-owner-token" };
const getSession = async () => ({ data: { session } });
const noFetch = () => assert.fail("The rejected request must not reach the network");

test("Work and chat-history transports bind cookie requests to the captured owner and never dispatch to other endpoints", async () => {
  let current = owner,
    calls = 0,
    sessionReads = 0;
  const api = loadTs(
    "src/lib/work-sync-client.ts",
    {
      "@/lib/endpoint-reliability.mjs": reliability,
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => {
              sessionReads++;
              return { data: { session: { ...session, user: { id: current } } }, error: null };
            },
          },
        },
      },
      "@/lib/work-store": {},
      "@/lib/work-sync-state": {},
    },
    async (_path, init) => {
      calls++;
      assertOwned(init, init.body ? "POST" : "GET");
      return Response.json({ ok: true });
    },
  );
  const signal = new AbortController().signal;
  for (const path of [
    "/api/work/sync",
    "/api/work/execution?before=a",
    "/api/work/browser",
    "/api/work/output?id=a",
    "/api/chat/history",
  ]) {
    await api.requestWorkSync(owner, path, signal);
    await api.requestWorkSync(owner, path, signal, { action: "test" });
  }
  assert.equal(calls, 10);
  for (const path of [
    "https://evil.test/api/work/sync",
    "//evil.test/api/work/sync",
    "/api/auth/token",
    "/api/work/sync#token",
    "/api/work/sync/other",
  ])
    await assert.rejects(api.requestWorkSync(owner, path, signal), /destination_invalid/);
  assert.equal(sessionReads, 10);
  current = other;
  await assert.rejects(
    api.requestWorkSync(owner, "/api/work/sync", signal, { action: "write" }),
    /identity_changed/,
  );
  assert.equal(calls, 10);
});

function assertOwned(init, method = "POST") {
  assert.equal(init.method ?? "GET", method);
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.mode, "same-origin");
  assert.equal(init.redirect, "error");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), "Bearer original-owner-token");
  assert.equal(headers.get("X-Kova-Owner"), owner);
}

for (const path of [
  "/api/chat",
  "/api/memory",
  "/api/kovas",
  "/api/kovas/directory?query=a",
  "/api/admin/kovas",
]) {
  test(`${path}: actual principal transport carries cookies without accepting caller-chosen owner/token`, async () => {
    let calls = 0;
    const signal = new AbortController().signal;
    await fetchForPrincipal(
      owner,
      path,
      {
        method: "POST",
        body: "private payload",
        signal,
        credentials: "include",
        redirect: "follow",
        mode: "cors",
        headers: {
          Authorization: "Bearer attacker",
          "X-Kova-Owner": other,
          "Idempotency-Key": "attempt-one",
        },
      },
      {
        getSession,
        fetchImpl: async (url, init) => {
          calls++;
          assert.equal(url, path);
          assertOwned(init);
          assert.equal(init.body, "private payload");
          assert.equal(init.signal, signal);
          assert.equal(new Headers(init.headers).get("Idempotency-Key"), "attempt-one");
          return new Response(null, { status: 401 });
        },
      },
    );
    assert.equal(calls, 1, "An authentication rejection cannot replay a mutation");
  });
}

for (const destination of [
  "https://foreign.invalid/api/chat",
  "//foreign.invalid/api/chat",
  "/api/auth/refresh",
  "/api/chat#fragment",
  "/api/chat/child",
  "/private",
  "/api/\\foreign.invalid/chat",
]) {
  test(`principal transport rejects ${destination} before requesting a credential`, async () => {
    await assert.rejects(
      fetchForPrincipal(owner, destination, {}, { getSession: noFetch, fetchImpl: noFetch }),
      /destination/,
    );
  });
}

test("absolute same-origin Request preserves body/headers and refuses other origins", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "https://kova.example.test" } };
  try {
    const request = new Request("https://kova.example.test/api/chat", {
      method: "POST",
      body: "private",
      headers: { "Idempotency-Key": "request-key" },
    });
    await fetchForPrincipal(
      owner,
      request,
      {},
      {
        getSession,
        fetchImpl: async (actual, init) => {
          assert.equal(actual, request);
          assertOwned({ ...init, method: actual.method });
          assert.equal(await actual.text(), "private");
          assert.equal(new Headers(init.headers).get("Idempotency-Key"), "request-key");
          return Response.json({});
        },
      },
    );
    for (const input of [
      new URL("https://foreign.invalid/api/chat"),
      new Request("https://foreign.invalid/api/chat"),
    ])
      await assert.rejects(
        fetchForPrincipal(owner, input, {}, { getSession: noFetch, fetchImpl: noFetch }),
        /destination/,
      );
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("guest requests cannot inherit cookies, a bearer or a captured owner", async () => {
  await fetchForPrincipal(
    null,
    "/api/chat",
    { credentials: "include", headers: { Authorization: "Bearer stale", "X-Kova-Owner": owner } },
    {
      getSession: noFetch,
      fetchImpl: async (_, init) => {
        assert.equal(init.credentials, "omit");
        assert.equal(init.mode, "same-origin");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers.has("Authorization"), false);
        assert.equal(init.headers.has("X-Kova-Owner"), false);
        return Response.json({});
      },
    },
  );
});

for (const result of [
  { data: { session: null } },
  { data: { session: { ...session, user: { id: other } } } },
  { data: { session }, error: new Error("untrusted cached session") },
]) {
  test(`principal transport rejects missing, changed or unverified session ${JSON.stringify(result)}`, async () => {
    await assert.rejects(
      fetchForPrincipal(
        owner,
        "/api/chat",
        {},
        { getSession: async () => result, fetchImpl: noFetch },
      ),
      /Account changed/,
    );
  });
}

test("aborting an unresolved session lookup prevents both immediate and late dispatch", async () => {
  const controller = new AbortController();
  let finish;
  const pending = fetchForPrincipal(
    owner,
    "/api/chat",
    { signal: controller.signal },
    {
      getSession: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      fetchImpl: noFetch,
    },
  );
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  finish({ data: { session } });
  await Promise.resolve();
  await assert.rejects(
    fetchForPrincipal(
      owner,
      "/api/chat",
      { signal: controller.signal },
      { getSession: noFetch, fetchImpl: noFetch },
    ),
    (error) => error.name === "AbortError",
  );
});

test("memory rereads the current owner after descriptor collection and cannot write another account", async () => {
  let changed = false;
  let calls = 0;
  await assert.rejects(
    writeMemoryForPrincipal(
      {
        id: other,
        temporary: false,
        messages: Array.from({ length: 4 }, () => ({
          role: "user",
          content: "original private context",
        })),
      },
      owner,
      {
        getSession: async () => ({
          data: { session: changed ? { ...session, user: { id: other } } : session },
        }),
        fetchImpl: async (path, init) => {
          calls++;
          assert.match(path, /^\/api\/memory\?/u);
          assertOwned(init, "GET");
          changed = true;
          return Response.json({ enabled: false });
        },
      },
    ),
    /Account changed/,
  );
  assert.equal(calls, 1);
});

for (const body of [undefined, { operation: "save", id: "article-a" }]) {
  test(`Discovery ${body ? "mutation" : "read"} keeps owned authority and never retries`, async () => {
    let calls = 0;
    const result = await requestDiscovery({
      owner,
      body,
      getSession,
      fetchImpl: async (path, init) => {
        calls++;
        assert.equal(path, "/api/discovery");
        assertOwned(init, body ? "POST" : "GET");
        assert.equal(init.headers["X-Kova-Expected-User"], owner);
        return Response.json({ error: "denied" }, { status: 401 });
      },
    });
    assert.equal(result.response.status, 401);
    assert.equal(calls, 1);
  });
}

test("Discovery rejects changed/error session evidence before sending private data", async () => {
  for (const result of [
    { data: { session: { ...session, user: { id: other } } } },
    { data: { session }, error: new Error("unavailable") },
  ])
    await assert.rejects(
      requestDiscovery({ owner, getSession: async () => result, fetchImpl: noFetch }),
      /account changed/,
    );
});

function loadTs(file, modules, fetcher, suffix = "") {
  const exports = {};
  const output = ts.transpileModule(readFileSync(file, "utf8") + suffix, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("exports", "require", "fetch", output)(
    exports,
    (key) => {
      assert.ok(modules[key], key);
      return modules[key];
    },
    fetcher,
  );
  return exports;
}

test("Library suffixes cannot redirect credentials into another route or bypass cancellation", async () => {
  const library = loadTs(
    "src/lib/library-items-client.ts",
    {
      "./library-original-client": { originalLibraryHeaders: noFetch },
      "./endpoint-reliability.mjs": reliability,
    },
    noFetch,
  );
  for (const suffix of ["/../../auth/refresh", "//foreign.invalid", "#fragment", "?id=a#fragment"])
    await assert.rejects(
      library.libraryItemsRequest(owner, suffix, new AbortController().signal),
      /destination/,
    );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    library.libraryItemsRequest(owner, "", controller.signal),
    (error) => error.name === "AbortError",
  );
});

test("the actual Gmail event-source read and mutation bind cookie authority to the captured owner", async () => {
  let current = owner,
    calls = 0;
  const api = loadTs(
    "src/components/TaskGmailEventSource.tsx",
    {
      react: {},
      "react/jsx-runtime": {},
      "@/components/ui/button": {},
      "@/lib/principal-browser-storage.mjs": {},
      "@/lib/endpoint-reliability.mjs": reliability,
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: { ...session, user: { id: current } } } }),
          },
        },
      },
    },
    async (path, init) => {
      calls++;
      assert.ok(path.startsWith("/api/tasks/event-sources"));
      assertOwned(init, init.body ? "POST" : "GET");
      if (init.body) assert.equal(JSON.parse(init.body).expectedUserId, owner);
      return Response.json({ sources: [] });
    },
    "\nexport const testSourceRequest = sourceRequest;\n",
  );
  const signal = new AbortController().signal;
  await api.testSourceRequest(owner, "grant-a", signal);
  await api.testSourceRequest(owner, "grant-a", signal, {
    action: "disable",
    expectedUserId: other,
  });
  current = other;
  await assert.rejects(
    api.testSourceRequest(owner, "grant-a", signal, { action: "watch" }),
    /account changed/,
  );
  assert.equal(calls, 2);
});
