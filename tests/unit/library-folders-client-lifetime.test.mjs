import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as originalPolicy from "../../src/lib/library-original-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "99999999-9999-4999-8999-999999999999";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const folder = {
  id,
  parentId,
  name: "Research",
  position: 2,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-19T12:00:00Z",
};
const session = (account = owner) => ({
  data: { session: { user: { id: account }, access_token: `fixture-token-${account}` } },
  error: null,
});
function deferred() {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
}
function load(path, dependencies, globals = {}) {
  const exports = {};
  const names = Object.keys(globals);
  new Function(
    "exports",
    "require",
    ...names,
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(
    exports,
    (key) => {
      assert.ok(Object.hasOwn(dependencies, key), `Unexpected dependency ${key}`);
      return dependencies[key];
    },
    ...names.map((name) => globals[name]),
  );
  return exports;
}
function fixture({ getSession = async () => session(), fetcher, afterAuth } = {}) {
  const requests = [];
  const deadlines = [];
  let authCalls = 0;
  const original = load("src/lib/library-original-client.ts", {
    sonner: { toast: {} },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          getSession() {
            authCalls++;
            return getSession();
          },
        },
      },
    },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/library-original-policy.mjs": originalPolicy,
  });
  const api = load(
    "src/lib/library-folders.ts",
    {
      "@/lib/library-original-client": {
        async originalLibraryHeaders(capturedOwner, signal) {
          const headers = await original.originalLibraryHeaders(capturedOwner, signal);
          afterAuth?.();
          return headers;
        },
      },
      "@/lib/endpoint-reliability.mjs": reliability,
    },
    {
      fetch: async (url, init) => {
        requests.push({ url, init });
        assert.equal(init.signal.aborted, false, "Never dispatch an already-aborted request");
        return fetcher ? fetcher(url, init) : Response.json({ folders: [folder] });
      },
      AbortSignal: {
        any: (signals) => AbortSignal.any(signals),
        timeout(ms) {
          const controller = new AbortController();
          deadlines.push({ ms, controller });
          return controller.signal;
        },
      },
    },
  );
  return { api, requests, deadlines, authCalls: () => authCalls };
}
const operations = {
  list: (api, signal) => api.listLibraryFolders(owner, signal),
  create: (api, signal) =>
    api.createLibraryFolder(owner, { name: "Research", parentId: null }, signal),
  rename: (api, signal) => api.renameLibraryFolder(owner, { id, name: "Renamed" }, signal),
  delete: (api, signal) => api.deleteLibraryFolder(owner, id, signal),
  move: (api, signal) => api.moveLibraryItems(owner, { itemIds: [id], folderId: null }, signal),
};

test("every folder operation pins its captured owner and preserves request/result mapping", async () => {
  const responses = [
    {
      folders: [
        {
          id: id.toUpperCase(),
          parent_id: parentId.toUpperCase(),
          name: folder.name,
          position: folder.position,
          created_at: folder.createdAt,
          updated_at: folder.updatedAt,
        },
      ],
    },
    { folder },
    { folder: { ...folder, name: "Renamed" } },
    { deletedFolderCount: 2, movedToRootCount: 3 },
    { movedCount: 1 },
  ];
  const f = fixture({ fetcher: () => Response.json(responses.shift()) });
  const controller = new AbortController();
  assert.deepEqual(await operations.list(f.api, controller.signal), [folder]);
  assert.deepEqual(await operations.create(f.api, controller.signal), folder);
  assert.deepEqual(await operations.rename(f.api, controller.signal), {
    ...folder,
    name: "Renamed",
  });
  assert.deepEqual(await operations.delete(f.api, controller.signal), {
    deletedFolderCount: 2,
    movedToRootCount: 3,
  });
  assert.deepEqual(await operations.move(f.api, controller.signal), {
    movedCount: 1,
    folderId: null,
  });
  assert.equal(f.authCalls(), 5);
  assert.deepEqual(
    f.requests.map(({ url, init }) => [url, init.method, init.body && JSON.parse(init.body)]),
    [
      ["/api/library/folders", "GET", undefined],
      ["/api/library/folders", "POST", { name: "Research", parentId: null }],
      ["/api/library/folders", "PATCH", { id, name: "Renamed" }],
      ["/api/library/folders", "DELETE", { id }],
      ["/api/library/bulk-move", "POST", { itemIds: [id], folderId: null }],
    ],
  );
  for (const { init } of f.requests) {
    assert.equal(init.headers.Authorization, `Bearer fixture-token-${owner}`);
    assert.equal(init.headers["X-Kova-Owner"], owner);
    assert.equal(
      init.headers["Content-Type"],
      init.method === "GET" ? undefined : "application/json",
    );
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.mode, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.deepEqual(
    f.deadlines.map(({ ms }) => ms),
    [15000, 15000, 15000, 15000, 15000],
  );
});

test("delayed auth cannot dispatch any folder operation as a later account", async (t) => {
  for (const [name, invoke] of Object.entries(operations)) {
    await t.test(name, async () => {
      const auth = deferred();
      const f = fixture({ getSession: () => auth.promise });
      const pending = invoke(f.api, new AbortController().signal);
      assert.equal(f.authCalls(), 1);
      assert.equal(f.requests.length, 0);
      auth.resolve(session(otherOwner));
      await assert.rejects(pending, /Your account changed/);
      assert.equal(f.requests.length, 0);
    });
  }
});

test("already-aborted lifetimes skip both auth and network for every operation", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  for (const invoke of Object.values(operations)) {
    await assert.rejects(invoke(f.api, controller.signal), { name: "AbortError" });
  }
  assert.equal(f.authCalls(), 0);
  assert.equal(f.requests.length, 0);
});

test("abort while auth is pending rejects promptly and prevents a later root-folder create", async () => {
  const auth = deferred();
  const f = fixture({ getSession: () => auth.promise });
  const controller = new AbortController();
  const pending = operations.create(f.api, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  auth.resolve(session());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 0);
});

test("abort after validated auth but before fetch never dispatches a mutation", async () => {
  const controller = new AbortController();
  const f = fixture({ afterAuth: () => controller.abort() });
  await assert.rejects(operations.create(f.api, controller.signal), { name: "AbortError" });
  assert.equal(f.authCalls(), 1);
  assert.equal(f.requests.length, 0);
});

test("caller abort reaches an in-flight request", async () => {
  const started = deferred();
  const f = fixture({
    fetcher: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        started.resolve();
      }),
  });
  const controller = new AbortController();
  const pending = operations.create(f.api, controller.signal);
  await started.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.requests[0].init.signal.aborted, true);
});

test("caller abort bounds stalled response reads and cancels their stream", async () => {
  const started = deferred();
  let canceled = false;
  const f = fixture({
    fetcher: () =>
      new Response(
        new ReadableStream({
          pull() {
            started.resolve();
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
  });
  const controller = new AbortController();
  const pending = operations.list(f.api, controller.signal);
  await started.promise;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true);
});

test("a late successful response cannot escape an ended lifetime", async () => {
  const response = deferred();
  const started = deferred();
  const f = fixture({
    fetcher: () => {
      started.resolve();
      return response.promise;
    },
  });
  const controller = new AbortController();
  const pending = operations.list(f.api, controller.signal);
  await started.promise;
  controller.abort();
  response.resolve(Response.json({ folders: [folder] }));
  await assert.rejects(pending, { name: "AbortError" });
});

test("the same request deadline bounds delayed auth and stalled body reads", async (t) => {
  await t.test("auth deadline", async () => {
    const auth = deferred();
    const f = fixture({ getSession: () => auth.promise });
    const pending = operations.create(f.api, new AbortController().signal);
    f.deadlines[0].controller.abort(new DOMException("Timed out", "TimeoutError"));
    await assert.rejects(pending, /abort|timed out/i);
    auth.resolve(session());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.requests.length, 0);
  });
  await t.test("body deadline", async () => {
    const started = deferred();
    const f = fixture({
      fetcher: () =>
        new Response(
          new ReadableStream({
            pull() {
              started.resolve();
            },
          }),
        ),
    });
    const pending = operations.list(f.api, new AbortController().signal);
    await started.promise;
    f.deadlines[0].controller.abort(new DOMException("Timed out", "TimeoutError"));
    await assert.rejects(pending, { name: "TimeoutError" });
  });
});

test("HTTP failures preserve their public error code, status, and message", async () => {
  const cases = [
    [401, "unauthorized", "Your session expired. Sign in again and retry."],
    [409, "library_folder_name_conflict", "A folder with that name already exists here."],
    [429, "library_mutation_rate_limited", "Too many Library changes. Wait a moment and retry."],
    [404, "library_folder_not_found", "That folder no longer exists."],
    [
      404,
      "library_item_or_folder_not_found",
      "Some selected items or the destination folder no longer exist. Refresh and retry.",
    ],
    [400, "invalid_folder_name", "Use a folder name between 1 and 120 characters without slashes."],
    [
      503,
      "library_folders_unavailable",
      "Library organization is temporarily unavailable. Retry shortly.",
    ],
    [500, null, "The Library change could not be completed. Please try again."],
  ];
  for (const [status, code, message] of cases) {
    const f = fixture({
      fetcher: () =>
        code ? Response.json({ error: code }, { status }) : new Response("not JSON", { status }),
    });
    await assert.rejects(operations.list(f.api, new AbortController().signal), (error) => {
      assert.ok(error instanceof f.api.LibraryFolderRequestError);
      assert.equal(error.code, code ?? "library_request_failed");
      assert.equal(error.status, status);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test("malformed, oversized, or incomplete successful results retain retryable response errors", async () => {
  const cases = [
    [operations.list, () => new Response("not JSON")],
    [operations.list, () => Response.json([])],
    [operations.list, () => Response.json({ folders: [{ ...folder, id: "invalid" }] })],
    [operations.list, () => new Response("x".repeat(512 * 1024 + 1))],
    [operations.create, () => Response.json({ folder: null })],
    [operations.rename, () => Response.json({ folder: { ...folder, name: "" } })],
    [operations.delete, () => Response.json({ deletedFolderCount: 1.5, movedToRootCount: 0 })],
    [operations.move, () => Response.json({ movedCount: 0 })],
  ];
  for (const [invoke, fetcher] of cases) {
    const f = fixture({ fetcher });
    await assert.rejects(invoke(f.api, new AbortController().signal), (error) => {
      assert.ok(error instanceof f.api.LibraryFolderRequestError);
      assert.equal(error.code, "invalid_library_response");
      assert.equal(error.status, 503);
      return true;
    });
  }
});
