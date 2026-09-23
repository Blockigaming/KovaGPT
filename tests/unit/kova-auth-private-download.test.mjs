import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as download from "../../src/lib/kova-auth-private-download.mjs";
import * as contract from "../../src/lib/kova-auth-contract.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as policy from "../../src/lib/project-files-policy.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const sid = "44444444-4444-4444-8444-444444444444";
const generation = "55555555-5555-4555-8555-555555555555";
const token = "k".repeat(43);
const text = new TextEncoder().encode('{"value":"private"}\n');
const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rows = {
  project: {
    id,
    project_id: project,
    name: "note.txt",
    storage_path: `${project}/${id}.txt`,
    mime_type: "text/plain",
    size_bytes: text.length,
    kind: "file",
    status: "ready",
    content_sha256: hash(text),
  },
  deliverable: {
    id,
    owner_id: owner,
    title: "Report.txt",
    storage_reference: `agent-evidence:${owner}/${id}.txt`,
    mime_type: "text/plain",
    status: "ready",
    revision: 1,
    integrity_hash: hash(text),
  },
  export: {
    id,
    user_id: owner,
    status: "complete",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    size_bytes: text.length,
    storage_path: `${owner}/${id}/${generation}.json`,
  },
  evidence: {
    id: 7,
    job_id: project,
    event_type: "screenshot",
    payload: { storage_path: `${owner}/${id}.png` },
  },
};
const compiled = new Map();
function load(path, modules, fetchImpl = () => assert.fail("Unexpected external request")) {
  if (!compiled.has(path))
    compiled.set(
      path,
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
  const exports = {};
  new Function("exports", "require", "fetch", "process", compiled.get(path))(
    exports,
    (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
    fetchImpl,
    {
      env: {
        SUPABASE_URL: "https://fixture.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "admin",
      },
    },
  );
  return exports;
}
async function fixture(kind = "project", options = {}) {
  const original = rows[kind],
    bytes = kind === "evidence" ? image : text;
  const link = await download.ownedPrivateFileLink(kind, owner, original);
  const events = [];
  let fetched = false,
    metadataReads = 0,
    sessionReads = 0;
  const client = (admin) => ({
    from(table) {
      const filters = [];
      const query = {
        select() {
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        abortSignal(signal) {
          signal.throwIfAborted();
          return this;
        },
        async maybeSingle() {
          events.push(["query", admin, table, filters]);
          if (table === "account_deletion_fences") {
            assert.equal(admin, true);
            assert.deepEqual(filters, [["user_id", owner]]);
            return {
              data:
                options.fence || (fetched && options.fenceAfterRead) ? { user_id: owner } : null,
              error: null,
            };
          }
          if (table === "agent_jobs") {
            assert.equal(admin, false);
            assert.deepEqual(filters, [
              ["id", project],
              ["owner_id", owner],
            ]);
            return {
              data: options.missingJob ? null : { id: project, owner_id: owner },
              error: null,
            };
          }
          assert.equal(admin, kind === "export");
          assert.equal(
            table,
            {
              project: "project_files",
              deliverable: "agent_deliverables",
              export: "account_export_jobs",
              evidence: "agent_job_events",
            }[kind],
          );
          assert.equal(filters[0][1], String(original.id));
          if (kind === "export") assert.deepEqual(filters[1], ["user_id", owner]);
          if (kind === "deliverable") assert.deepEqual(filters[1], ["owner_id", owner]);
          metadataReads++;
          return {
            data:
              options.missing || (fetched && options.revokeRls)
                ? null
                : { ...original, ...options.row, ...(fetched ? options.changedRow : {}) },
            error: options.readError ? { message: "PRIVATE_DATABASE_DETAIL" } : null,
          };
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            assert.equal(admin, kind === "export");
            assert.equal(ttl, 30);
            events.push(["sign", admin, bucket, path]);
            return {
              data: {
                signedUrl:
                  options.signedUrl ??
                  `https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=INTERNAL_ONLY`,
              },
              error: options.signError ? { message: "PRIVATE_STORAGE_DETAIL" } : null,
            };
          },
        };
      },
    },
    get auth() {
      assert.fail("Owned delivery cannot invoke hosted Auth");
    },
  });
  const user = client(false),
    admin = client(true);
  const api = load("src/lib/api-auth.server.ts", {
    "@supabase/supabase-js": { createClient: (_url, key) => (key === "admin" ? admin : user) },
    "@/lib/billing-entitlement.server": {},
    "@/lib/auth-security.mjs": security,
    "@/lib/kova-auth-contract.mjs": { ...contract, resolveKovaAuthMode: () => "kova" },
    "@/lib/kova-auth-crypto.server.mjs": {
      digestKovaToken,
      signKovaCompatibilityJwt: () => "fixture-data-token",
    },
    "@/lib/kova-auth-store.server": {
      resolveSession: async (digest) => {
        assert.equal(digest, digestKovaToken(token));
        sessionReads++;
        if (options.revoked || (fetched && options.revokeAfterRead)) return null;
        return {
          accountId: options.account ?? owner,
          sessionId: fetched && options.rotateAfterRead ? generation : sid,
          email: "owner@example.invalid",
          emailVerified: !options.unverified,
          assuranceLevel: fetched && options.downgradeAfterRead ? "aal1" : "aal2",
        };
      },
    },
  });
  const handler = load(
    "src/lib/kova-auth-private-download.server.ts",
    {
      "./api-auth.server": api,
      "./distributed-rate-limit.server": {
        consumeApplicationRateLimit: async (input) => {
          assert.equal(input.identity, `user:${owner}`);
          return options.rate ?? { allowed: true };
        },
      },
      "./runtime-env.server": { runtimeEnv: () => "https://fixture.supabase.co" },
      "./ai/provider-transport.server.mjs": transport,
      "./endpoint-reliability.mjs": reliability,
      "./project-files-policy.mjs": policy,
      "./kova-auth-private-download.mjs": download,
    },
    async (url, init) => {
      fetched = true;
      events.push(["fetch", url]);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      return options.response?.(init) ?? new Response(options.bytes ?? bytes);
    },
  ).handleOwnedPrivateDownload;
  return {
    handler,
    link,
    events,
    user,
    admin,
    bytes,
    metadataReads: () => metadataReads,
    sessionReads: () => sessionReads,
    request: (headers = {}, suffix = "", method = "GET") =>
      new Request(`https://kova.test${link}${suffix}`, {
        method,
        headers: { Cookie: `__Host-kova_session=${token}`, ...headers },
      }),
  };
}
for (const kind of Object.keys(rows))
  test(`${kind}: actual cookie boundary and private delivery recheck state without exposing Storage credentials`, async () => {
    const f = await fixture(kind),
      response = await f.handler(f.request());
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.doesNotMatch(f.link, /INTERNAL_ONLY|token=/);
    assert.equal(f.metadataReads(), 2);
    assert.equal(f.sessionReads(), 3);
    assert.equal(f.events.filter((e) => e[0] === "sign").length, 1);
  });
for (const [name, headers, options] of [
  ["missing cookie", { Cookie: "" }, {}],
  ["bearer only", { Cookie: "", Authorization: "Bearer old-token" }, {}],
  ["revoked cookie", {}, { revoked: true }],
  ["foreign owner", {}, { account: generation }],
  ["unverified owner", {}, { unverified: true }],
  ["deleting owner", {}, { fence: true }],
])
  test(`copied file links cannot bypass ${name}`, async () => {
    const f = await fixture("project", options),
      r = await f.handler(f.request(headers));
    assert.notEqual(r.status, 200);
    assert.equal(
      f.events.some((e) => e[0] === "sign"),
      false,
    );
  });
for (const headers of [
  { Origin: "https://evil.test" },
  { "Sec-Fetch-Site": "same-site" },
  { Origin: "https://sibling.kova.test" },
])
  test("cross-origin private-file requests are rejected before authentication", async () => {
    const f = await fixture(),
      r = await f.handler(f.request(headers));
    assert.equal(r.status, 403);
    assert.equal(f.sessionReads(), 0);
  });
for (const suffix of ["&id=another", "&token=credential", "&path=object", "&version=other"])
  test(`ambiguous and credential-shaped private-file query ${suffix} is rejected`, async () => {
    const f = await fixture(),
      r = await f.handler(f.request({}, suffix));
    assert.equal(r.status, 400);
    assert.equal(f.sessionReads(), 0);
  });
test("non-GET private delivery rejects before authentication", async () => {
  const f = await fixture(),
    r = await f.handler(f.request({}, "", "POST"));
  assert.equal(r.status, 405);
  assert.equal(f.sessionReads(), 0);
});
for (const options of [
  { revokeAfterRead: true },
  { rotateAfterRead: true },
  { downgradeAfterRead: true },
  { fenceAfterRead: true },
  { revokeRls: true },
  { changedRow: { storage_path: `${project}/${generation}.txt` } },
  { changedRow: { status: "pending" } },
])
  test(`collected bytes are withheld after changed authority or metadata ${JSON.stringify(options)}`, async () => {
    const f = await fixture("project", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
    const body = await r.text();
    assert.doesNotMatch(body, /"value"|INTERNAL_ONLY/);
  });
for (const options of [
  { row: { storage_path: `${generation}/${id}.txt` } },
  { row: { storage_path: `${project}/../file.txt` } },
  { row: { storage_path: `${project}/%2e/file.txt` } },
  { row: { size_bytes: 11000000 } },
  { readError: true },
  { missing: true },
])
  test("invalid metadata or revoked RLS cannot reach Storage signing", async () => {
    const f = await fixture("project", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
    assert.equal(
      f.events.some((e) => e[0] === "sign"),
      false,
    );
    assert.doesNotMatch(await r.text(), /PRIVATE_DATABASE_DETAIL/);
  });
for (const signedUrl of [
  "https://evil.test/stolen?token=secret",
  `https://fixture.supabase.co/storage/v1/object/sign/project-files/${project}/other.txt?token=secret`,
  `https://user:pass@fixture.supabase.co/storage/v1/object/sign/project-files/${project}/${id}.txt`,
  `https://fixture.supabase.co/storage/v1/object/sign/project-files/${project}/${id}.txt#fragment`,
])
  test("private download rejects an untrusted signing target without fetching", async () => {
    const f = await fixture("project", { signedUrl }),
      r = await f.handler(f.request());
    assert.equal(r.status, 502);
    assert.equal(
      f.events.some((e) => e[0] === "fetch"),
      false,
    );
  });
test("integrity, byte-length, and upstream size failures withhold private bytes", async () => {
  for (const options of [
    { bytes: new Uint8Array(text.length).fill(42) },
    { bytes: text.slice(1) },
    {
      response: () =>
        new Response("x", { headers: { "Content-Length": String(11 * 1024 * 1024) } }),
    },
  ]) {
    const f = await fixture("project", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
  }
});
test("aborting a stalled Storage body terminates delivery", async () => {
  const controller = new AbortController();
  const f = await fixture("project", {
    response: () => {
      queueMicrotask(() => controller.abort());
      return new Response(new ReadableStream({ start() {} }));
    },
  });
  const request = new Request(f.request(), { signal: controller.signal });
  const r = await f.handler(request);
  assert.equal(r.status, 504);
});
test("evidence requires the original job owner and raster bytes", async () => {
  for (const options of [{ missingJob: true }, { bytes: text }]) {
    const f = await fixture("evidence", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
  }
});
test("account-export expiry and exact artifact path remain mandatory", async () => {
  for (const options of [
    { changedRow: { expires_at: "2000-01-01T00:00:00Z" } },
    { row: { storage_path: `${owner}/${generation}/${id}.json` } },
    { row: { user_id: generation } },
  ]) {
    const f = await fixture("export", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
  }
});
test("deliverables cannot change owners or bypass their recorded integrity hash", async () => {
  for (const options of [
    { row: { owner_id: generation } },
    { bytes: new Uint8Array(text.length).fill(42) },
    { changedRow: { revision: 2 } },
    { changedRow: { status: "deleted" } },
  ]) {
    const f = await fixture("deliverable", options),
      r = await f.handler(f.request());
    assert.notEqual(r.status, 200);
  }
});
test("unavailable request protection never starts private Storage work", async () => {
  const f = await fixture("export", { rate: { allowed: false, status: "unavailable" } }),
    r = await f.handler(f.request());
  assert.equal(r.status, 503);
  assert.equal(f.events.length, 0);
});

test("actual Work download handler emits an owned, version-bound link and retains explicit legacy signing", async () => {
  const createServerFn = () => {
    const fn = {
      middleware() {
        return this;
      },
      validator() {
        return this;
      },
      handler(handler) {
        return handler;
      },
    };
    return fn;
  };
  const work = load("src/lib/work.functions.ts", {
    "@tanstack/react-start": { createServerFn },
    zod: { z },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./kova-auth-private-download.mjs": download,
  });
  for (const provider of ["kova", "supabase"]) {
    let signed = 0;
    const client = {
      from(table) {
        assert.equal(table, "agent_deliverables");
        const q = {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          neq() {
            return this;
          },
          single: async () => ({ data: rows.deliverable, error: null }),
        };
        return q;
      },
      storage: {
        from: () => ({
          createSignedUrl: async () => {
            signed++;
            return { data: { signedUrl: "https://fixture.supabase.co/legacy" }, error: null };
          },
        }),
      },
    };
    const result = await work.downloadDeliverable({
      data: { id },
      context: { supabase: client, userId: owner, authProvider: provider },
    });
    assert.equal(signed, provider === "kova" ? 0 : 1);
    if (provider === "kova")
      assert.equal(
        result.url,
        await download.ownedPrivateFileLink("deliverable", owner, rows.deliverable),
      );
  }
});
