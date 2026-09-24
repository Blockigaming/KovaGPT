import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as contract from "../../src/lib/kova-auth-contract.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import { digestKovaToken } from "../../src/lib/kova-auth-crypto.server.mjs";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as originalPolicy from "../../src/lib/library-original-policy.mjs";
import { resolveLibraryImageUrl } from "../../src/lib/library-image-url.ts";
import { assertImagePrincipal } from "../../src/lib/multimodal/image-source.server.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
const sid = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
const token = "K".repeat(43);
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const storagePath = `${owner}/${generation}.png`;
const url = `https://kova.test/api/library/files?kind=image&id=${id}&owner=${owner}&generation=${generation}`;
const cookie = { Cookie: `__Host-kova_session=${token}` };
const compiler = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const compiled = new Map();
function load(path, modules, fetcher = () => assert.fail("Unexpected transport")) {
  if (!compiled.has(path))
    compiled.set(
      path,
      ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: compiler }).outputText,
    );
  const exports = {};
  new Function("exports", "require", "fetch", "process", compiled.get(path))(
    exports,
    (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
    fetcher,
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
function fixture(options = {}) {
  const events = [];
  let reads = 0,
    resolutions = 0;
  const row = {
    owner_id: owner,
    item_id: id,
    generation,
    storage_path: storagePath,
    size_bytes: bytes.length,
    mime_type: "image/png",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    state: "ready",
    legacy: false,
    ...options.row,
  };
  const admin = {
    from(table) {
      assert.equal(table, "account_deletion_fences");
      const query = {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, "user_id");
          assert.equal(value, owner);
          return this;
        },
        abortSignal() {
          return this;
        },
        maybeSingle: async () => ({ data: options.fence ?? null, error: null }),
      };
      return query;
    },
    rpc(name, args) {
      assert.equal(name, "read_library_image_upload");
      assert.deepEqual(args, { p_owner: owner, p_id: id });
      events.push("metadata");
      reads++;
      const data = options.missing ? null : { ...row, ...(reads > 1 ? options.changedRow : {}) };
      return {
        abortSignal: async (signal) => {
          signal.throwIfAborted();
          return { data, error: options.readError ?? null };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "library-images");
        return {
          createSignedUrl: async (path, ttl) => {
            events.push("sign");
            assert.equal(path, row.storage_path);
            assert.equal(ttl, 30);
            return {
              data: {
                signedUrl:
                  options.signedUrl ??
                  `https://fixture.supabase.co/storage/v1/object/sign/library-images/${path}?token=INTERNAL_ONLY`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
  // Execute the real shared cookie authorizer: no-cookie/revoked requests cannot
  // be accepted just because this route fixture has a matching owner in its URL.
  const api = load("src/lib/api-auth.server.ts", {
    "@supabase/supabase-js": {
      createClient: (_url, key) =>
        key === "admin"
          ? admin
          : { auth: { getUser: () => assert.fail("Hosted Auth must not be called") } },
    },
    "@/lib/billing-entitlement.server": {},
    "@/lib/auth-security.mjs": security,
    "@/lib/kova-auth-contract.mjs": { ...contract, resolveKovaAuthMode: () => "kova" },
    "@/lib/kova-auth-crypto.server.mjs": {
      digestKovaToken,
      signKovaCompatibilityJwt: () => "fixture-data-jwt",
    },
    "@/lib/kova-auth-store.server": {
      resolveSession: async (digest) => {
        events.push("session");
        resolutions++;
        assert.equal(digest, digestKovaToken(token));
        if (options.revoked || (resolutions > 1 && options.revokeAfterRead)) return null;
        return {
          accountId: options.account ?? owner,
          sessionId: resolutions > 1 && options.rotateAfterRead ? other : sid,
          email: "owner@example.invalid",
          emailVerified: options.unverified !== true,
          assuranceLevel: resolutions > 1 && options.downgradeAfterRead ? "aal1" : "aal2",
        };
      },
    },
  });
  const modules = {
    "@/lib/api-auth.server": api,
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async (input) => {
        events.push("rate");
        assert.equal(input.identity, `user:${owner}`);
        assert.equal(input.action, "library_private_image");
        return options.rate ?? { allowed: true };
      },
    },
    "@/lib/runtime-env.server": { runtimeEnv: () => options.base ?? "https://fixture.supabase.co" },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/ai/provider-transport.server.mjs": transport,
  };
  const delivery = load(
    "src/lib/library-private-delivery.server.ts",
    modules,
    async (target, init) => {
      events.push("fetch");
      assert.match(target, /^https:\/\/fixture\.supabase\.co\//u);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(init.cache, "no-store");
      options.onFetch?.();
      if (options.fetchImpl) return options.fetchImpl(target, init);
      return new Response(options.bytes ?? bytes, {
        headers: options.headers ?? { "Content-Type": "image/png" },
      });
    },
  );
  return {
    delivery,
    api,
    admin,
    row,
    events,
    modules,
    request: (init = {}) => new Request(url, { headers: cookie, ...init }),
  };
}

test("owned private images execute cookie authorization twice, verify bytes, and never return a signed capability", async () => {
  const f = fixture();
  const response = await f.delivery.handlePrivateLibraryImage(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.deepEqual(f.events, [
    "session",
    "rate",
    "metadata",
    "sign",
    "fetch",
    "metadata",
    "session",
  ]);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.doesNotMatch(JSON.stringify([...response.headers]), /INTERNAL_ONLY|supabase|token=/u);
});
for (const [label, options, headers] of [
  ["missing cookie", {}, {}],
  ["bearer only", {}, { Authorization: "Bearer fixture-data-jwt" }],
  ["revoked cookie", { revoked: true }, cookie],
  ["other account", { account: other }, cookie],
  ["unverified account", { unverified: true }, cookie],
])
  test(`a copied private-image link cannot bypass ${label}`, async () => {
    const f = fixture(options),
      response = await f.delivery.handlePrivateLibraryImage(f.request({ headers }));
    assert.ok([401, 403].includes(response.status));
    assert.ok(!f.events.includes("metadata"));
  });
for (const [label, init] of [
  ["POST", { method: "POST" }],
  ["cross-site", { headers: { ...cookie, "Sec-Fetch-Site": "cross-site" } }],
  ["sibling origin", { headers: { ...cookie, Origin: "https://other.kova.test" } }],
])
  test(`private image rejects ${label} before authentication or storage`, async () => {
    const f = fixture(),
      response = await f.delivery.handlePrivateLibraryImage(f.request(init));
    assert.ok([403, 405].includes(response.status));
    assert.deepEqual(f.events, []);
  });
for (const suffix of ["&id=" + id, "&token=secret", "&path=x"])
  test(`private image rejects ambiguous or capability-shaped query ${suffix.split("=")[0]}`, async () => {
    const f = fixture(),
      response = await f.delivery.handlePrivateLibraryImage(
        new Request(url + suffix, { headers: cookie }),
      );
    assert.equal(response.status, 400);
    assert.deepEqual(f.events, []);
  });
for (const [label, row] of [
  ["foreign owner", { owner_id: other }],
  ["stale generation", { generation: other }],
  ["retired", { state: "retired" }],
  ["traversal", { storage_path: `${owner}/../other.png` }],
  ["foreign path", { storage_path: `${other}/${generation}.png` }],
  ["encoded path", { storage_path: `${owner}/%2e%2e/x.png` }],
  ["oversize metadata", { size_bytes: 8388609 }],
  ["active content", { mime_type: "image/svg+xml" }],
  ["missing integrity", { sha256: null }],
])
  test(`private image refuses ${label} before Storage signing`, async () => {
    const f = fixture({ row }),
      response = await f.delivery.handlePrivateLibraryImage(f.request());
    assert.equal(response.status, 404);
    assert.ok(!f.events.includes("sign"));
  });
for (const options of [
  { revokeAfterRead: true },
  { rotateAfterRead: true },
  { downgradeAfterRead: true },
  { changedRow: { state: "retired" } },
  { changedRow: { sha256: "a".repeat(64) } },
])
  test(`private image withholds already-read bytes after ${JSON.stringify(options)}`, async () => {
    const f = fixture(options),
      response = await f.delivery.handlePrivateLibraryImage(f.request());
    assert.ok([401, 404].includes(response.status));
    assert.doesNotMatch(await response.text(), /INTERNAL_ONLY|supabase|token=|private.*bytes/u);
    assert.ok(f.events.includes("fetch"));
  });
for (const options of [
  { signedUrl: "https://foreign.test/steal" },
  { signedUrl: `https://fixture.supabase.co/storage/v1/object/sign/other/${storagePath}?token=x` },
  {
    signedUrl: `https://user:password@fixture.supabase.co/storage/v1/object/sign/library-images/${storagePath}`,
  },
])
  test("private image cannot fetch an untrusted signing result", async () => {
    const f = fixture(options),
      response = await f.delivery.handlePrivateLibraryImage(f.request());
    assert.equal(response.status, 502);
    assert.ok(!f.events.includes("fetch"));
  });
for (const options of [
  { bytes: new TextEncoder().encode("<svg></svg>") },
  { bytes: Uint8Array.from([...bytes.slice(0, -1), 2]) },
  { headers: { "Content-Length": "8388609" } },
])
  test("private image rejects unbounded, non-raster or altered bytes", async () => {
    const f = fixture(options),
      response = await f.delivery.handlePrivateLibraryImage(f.request());
    assert.ok([404, 502].includes(response.status));
  });
test("legacy image aliases retain scoped delivery with conservative size metadata, not fabricated hashes", async () => {
  const f = fixture({
    row: { legacy: true, item_id: other, sha256: null, mime_type: null, size_bytes: 8388608 },
  });
  const response = await f.delivery.handlePrivateLibraryImage(f.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
});
test("abort cancels a stalled image body without waiting for unbounded storage", async () => {
  const controller = new AbortController();
  let canceled = false;
  const f = fixture({
    fetchImpl: async () => {
      setTimeout(() => controller.abort(), 5);
      return new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
      );
    },
  });
  const response = await f.delivery.handlePrivateLibraryImage(
    f.request({ signal: controller.signal }),
  );
  assert.equal(response.status, 504);
  assert.equal(canceled, true);
});
test("private image rate-limit failure starts no storage read", async () => {
  for (const status of ["unavailable", "limited"]) {
    const f = fixture({ rate: { allowed: false, status } }),
      response = await f.delivery.handlePrivateLibraryImage(f.request());
    assert.equal(response.status, status === "unavailable" ? 503 : 429);
    assert.ok(!f.events.includes("metadata"));
  }
});
test("actual Library server function emits owned reauthorized URLs and keeps legacy signing explicit", async () => {
  const f = fixture();
  let hostedSigned = 0;
  const chain = {
    middleware() {
      return this;
    },
    validator() {
      return this;
    },
    handler(run) {
      return run;
    },
  };
  const api = load("src/lib/library-images.functions.ts", {
    "@tanstack/react-start": { createServerFn: () => chain },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/lockdown-policy.mjs": {},
    "@/lib/safe-image-url": {},
    zod: { z },
    "@/lib/library-save-idempotency.mjs": {},
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/integrations/supabase/client.server": { supabaseAdmin: f.admin },
    "@/lib/runtime-env.server": {},
    "@/lib/library-image-storage.server.mjs": {},
  });
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    single: async () => ({
      data: { file_url: storagePath, user_id: owner, item_type: "image" },
      error: null,
    }),
  };
  const supabase = {
    from: () => query,
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          hostedSigned++;
          return { data: { signedUrl: "https://fixture.supabase.co/legacy" } };
        },
      }),
    },
  };
  const result = await api.getLibraryImageUrl({
    data: { id },
    context: { supabase, userId: owner, authProvider: "kova" },
  });
  assert.equal(new URL(result.url, "https://kova.test").href, url);
  assert.equal(hostedSigned, 0);
  assert.equal(
    await resolveLibraryImageUrl({ id, file_url: storagePath }, async () => result),
    result.url,
  );
  await api.getLibraryImageUrl({
    data: { id },
    context: { supabase, userId: owner, authProvider: "supabase" },
  });
  assert.equal(hostedSigned, 1);
});
test("actual original-document route withholds bytes if the owned session expires during download", async () => {
  const f = fixture({ revokeAfterRead: true });
  const route = load("src/routes/api/library/files.ts", {
    ...f.modules,
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/library-private-delivery.server": f.delivery,
    "@/lib/modes": {},
    "@/lib/library-original-policy.mjs": originalPolicy,
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/library-original-files.server.mjs": {
      downloadOriginalLibraryDocument: async () => ({
        row: { mime_type: "application/pdf", file_name: "Original.pdf" },
        bytes: new TextEncoder().encode("PRIVATE_ORIGINAL_BYTES"),
      }),
    },
  }).Route;
  const response = await route.server.handlers.GET({
    request: new Request(`https://kova.test/api/library/files?id=${id}&generation=${generation}`, {
      headers: { ...cookie, "X-Kova-Owner": owner },
    }),
  });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /PRIVATE_ORIGINAL_BYTES/u);
  assert.deepEqual(f.events, ["session", "session"]);
});

test("the real cookie authorizer rejects a captured owner's request before signing credentials for another account", async () => {
  const f = fixture();
  const response = await f.api.requireVerifiedUser(
    f.request({ headers: { ...cookie, "X-Kova-Owner": other } }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(f.events, ["session"]);
});

test("server-function middleware carries verified session authority into private image delivery", async () => {
  for (const provider of ["kova", "supabase"]) {
    const api = load("src/integrations/supabase/auth-middleware.ts", {
      "@tanstack/react-start": { createMiddleware: () => ({ server: (run) => run }) },
      "@tanstack/react-start/server": { getRequest: () => new Request(url, { headers: cookie }) },
      "@/lib/api-auth.server": {
        optionalUser: async () => ({
          userId: owner,
          authProvider: provider,
          supabaseUser: {},
          claims: { session_id: sid },
        }),
      },
    });
    const result = await api.requireSupabaseAuth({ next: async (value) => value });
    assert.equal(result.context.authProvider, provider);
    assert.equal(result.context.userId, owner);
  }
});
for (const options of [
  {},
  { revokeAfterRead: true },
  { rotateAfterRead: true },
  { downgradeAfterRead: true },
  { fence: { user_id: owner } },
]) {
  test(`image operations recheck the actual owned-session closure without hosted Auth: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const auth = await f.api.requireVerifiedUser(
      f.request({ headers: { ...cookie, "X-Kova-Owner": owner } }),
    );
    assert.equal(auth.authProvider, "kova");
    if (Object.keys(options).length)
      await assert.rejects(assertImagePrincipal(auth), /no longer available/u);
    else await assertImagePrincipal(auth);
    assert.deepEqual(f.events, ["session", "session"]);
  });
}
test("image operations cannot replace a live-session check with missing, boolean or coerced proof", async () => {
  for (const proof of [
    undefined,
    true,
    () => Promise.resolve("true"),
    () => Promise.resolve(null),
  ]) {
    const f = fixture(),
      auth = await f.api.requireVerifiedUser(
        f.request({ headers: { ...cookie, "X-Kova-Owner": owner } }),
      );
    auth.revalidateSession = proof;
    await assert.rejects(assertImagePrincipal(auth), /no longer available/u);
  }
});
test("cancellation terminates an owned image recheck even if its backend ignores the signal", async () => {
  const f = fixture(),
    auth = await f.api.requireVerifiedUser(
      f.request({ headers: { ...cookie, "X-Kova-Owner": owner } }),
    ),
    controller = new AbortController();
  auth.revalidateSession = () => new Promise(() => {});
  const pending = assertImagePrincipal(auth, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
