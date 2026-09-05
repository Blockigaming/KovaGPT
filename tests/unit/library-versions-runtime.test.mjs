import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as bounded from "../../src/lib/bounded-json.server.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  generation = "33333333-3333-4333-8333-333333333333";
function load(file, modules, fetcher = () => assert.fail("Unexpected fetch")) {
  const exports = {};
  new Function(
    "exports",
    "require",
    "fetch",
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(
    exports,
    (key) => {
      assert.ok(modules[key], key);
      return modules[key];
    },
    fetcher,
  );
  return exports;
}
function fixture() {
  const calls = [],
    state = { data: { items: [], cursor: null }, error: null };
  const admin = {
    rpc: (name, args) => ({
      abortSignal: (signal) => {
        calls.push({ name, args, signal });
        return Promise.resolve({ data: state.data, error: state.error });
      },
    }),
  };
  const route = load("src/routes/api/library/items.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () => ({ userId: owner, supabaseAdmin: admin }),
      getCallerTier: async () => "free",
      assertNotBanned: async () => null,
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/bounded-json.server.mjs": bounded,
    "@/lib/ai/provider-transport.server.mjs": transport,
    "@/lib/modes": { STORAGE_LIMITS_BYTES: { free: 500 } },
  }).Route;
  return { calls, state, handle: (request) => route.server.handlers[request.method]({ request }) };
}
const post = (body, headers = {}) =>
  new Request("https://kova.test/api/library/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kova-Owner": owner, ...headers },
    body: JSON.stringify(body),
  });
test("Library list validates bounded query/cursor and pins owner before the service-only metadata page", async () => {
  const f = fixture();
  let response = await f.handle(
    post(
      { operation: "list", query: "private phrase", sort: "oldest", folder: "all", filter: "all" },
      { "X-Kova-Owner": "other" },
    ),
  );
  assert.equal(response.status, 409);
  assert.equal(f.calls.length, 0);
  response = await f.handle(post({ operation: "list", query: "x".repeat(201) }));
  assert.equal(response.status, 400);
  assert.equal(f.calls.length, 0);
  response = await f.handle(post({ operation: "list", cursor: "not JSON" }));
  assert.equal(response.status, 400);
  response = await f.handle(
    post({
      operation: "list",
      query: "private phrase",
      sort: "oldest",
      folder: "all",
      filter: "all",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls[0].name, "list_library_items_page");
  assert.equal(f.calls[0].args.p_owner, owner);
  assert.equal(f.calls[0].args.p_query, "private phrase");
  assert.ok(f.calls[0].signal instanceof AbortSignal);
});
test("Library text replacement sends exact displayed identity and revision, with byte limits and redacted failures", async () => {
  const f = fixture();
  let response = await f.handle(post({ operation: "replace_text", id, revision: 1, text: "new" }));
  assert.equal(response.status, 409);
  assert.equal(f.calls.length, 0);
  response = await f.handle(
    post({ operation: "replace_text", id, generation, revision: 1, text: "界".repeat(100001) }),
  );
  assert.equal(response.status, 400);
  assert.equal(f.calls.length, 0);
  f.state.data = 2;
  response = await f.handle(
    post({ operation: "replace_text", id, generation, revision: 1, text: "new" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: 2 });
  assert.deepEqual(f.calls[0].args, {
    p_owner: owner,
    p_item: id,
    p_generation: generation,
    p_revision: 1,
    p_text: "new",
    p_storage_limit: 500,
  });
  f.state.error = { message: "Private body and internal database detail" };
  response = await f.handle(
    post({ operation: "replace_text", id, generation, revision: 1, text: "new" }),
  );
  assert.equal(response.status, 409);
  assert.ok(!(await response.text()).includes("Private body"));
});
test("Library history and body reads require current item identity and return unavailable after deletion", async () => {
  const f = fixture();
  let response = await f.handle(
    new Request(`https://kova.test/api/library/items?id=${id}`, {
      headers: { "X-Kova-Owner": owner },
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(f.calls.length, 0);
  f.state.data = { versions: [] };
  response = await f.handle(
    new Request(`https://kova.test/api/library/items?id=${id}&generation=${generation}&history=1`, {
      headers: { "X-Kova-Owner": owner },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].name, "read_library_version_history");
  f.state.data = null;
  response = await f.handle(
    new Request(
      `https://kova.test/api/library/items?id=${id}&generation=${generation}&revision=1`,
      { headers: { "X-Kova-Owner": owner } },
    ),
  );
  assert.equal(response.status, 404);
  assert.equal(f.calls[1].name, "read_library_text_version");
});
test("browser listing keeps full bodies out of cached page items and rejects stale item revisions before handoff", async () => {
  const calls = [],
    headers = [];
  let current = {
    id,
    content_generation: generation,
    content_revision: 2,
    content_text: "private full body",
    metadata: {},
  };
  const client = load(
    "src/lib/library-items-client.ts",
    {
      "./library-original-client": {
        originalLibraryHeaders: async (owner, signal) => {
          headers.push({ owner, signal });
          return { "X-Kova-Owner": owner };
        },
      },
      "./endpoint-reliability.mjs": reliability,
    },
    async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        init.method === "POST"
          ? { items: [{ ...current, content_excerpt: "preview" }], cursor: null }
          : current,
      );
    },
  );
  const signal = new AbortController().signal,
    page = await client.listLibraryPage(
      owner,
      { query: "", sort: "newest", folder: "all", filter: "all", favorites: "" },
      signal,
    );
  assert.equal(page.items[0].content_text, null);
  assert.equal(page.items[0].content_excerpt, "preview");
  assert.equal(page.items[0].content_loaded, false);
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(headers[0].owner, owner);
  await assert.rejects(
    client.readLibraryItem(owner, { ...page.items[0], content_revision: 1 }, signal),
    /changed/,
  );
  const item = await client.readLibraryItem(owner, page.items[0], signal);
  assert.equal(item.content_text, "private full body");
  assert.equal(item.content_loaded, true);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.readLibraryItem(owner, page.items[0], aborted.signal), /abort/i);
});
