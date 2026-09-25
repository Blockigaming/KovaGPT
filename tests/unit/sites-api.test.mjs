import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../src/lib/sites-policy.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "../../src/lib/bounded-json.server.mjs";
import { parseBearerToken } from "../../src/lib/auth-security.mjs";
const source = await readFile("src/routes/api/sites.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gmu, "").replace(/^export /gmu, ""),
  {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const owner = "123e4567-e89b-42d3-a456-426614174000",
  site = "223e4567-e89b-42d3-a456-426614174000";
function fixture({ current = true, claims = owner, hosting = null, provider = "supabase" } = {}) {
  const calls = [];
  const context = {
    ...policy,
    readBoundedJsonObject,
    BoundedJsonError,
    parseBearerToken,
    Response,
    Request,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto,
    process: { env: {} },
    requireVerifiedUser: async () => ({
      userId: owner,
      authProvider: provider,
      claims: { sub: owner, session_id: claims },
      supabaseAdmin: {
        rpc(name, args) {
          calls.push([name, args]);
          return {
            abortSignal: async () => ({
              data: ["check_kova_site_auth_session", "check_kova_owned_site_auth_session"].includes(
                name,
              )
                ? current
                : {},
              error: null,
            }),
          };
        },
      },
      supabaseUser: {
        auth: {
          getClaims: async () => {
            throw new Error("A verified principal must not require another hosted lookup");
          },
        },
      },
    }),
    getCallerTier: async () => "free",
    STORAGE_LIMITS_BYTES: { free: 1000000 },
    assertNotBanned: async () => null,
    isCrossSiteMutation: () => false,
    consumeApplicationRateLimit: async () => ({ allowed: true }),
    readySiteHosting: async () => hosting,
    createFileRoute: () => (value) => value,
  };
  vm.runInNewContext(compiled + "\nglobalThis.handlers = Route.server.handlers", context);
  return { calls, handlers: context.handlers };
}
function request(body) {
  return new Request("https://kovagpt.test/api/sites", {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function mutation(action, payload) {
  return { action, siteId: site, mutationId: crypto.randomUUID(), revision: 1, payload };
}
test("revoked and malformed Auth sessions cannot reach private Site reads or mutations", async () => {
  for (const options of [{ current: false }, { claims: "missing" }]) {
    const f = fixture(options);
    assert.equal((await f.handlers.GET({ request: request() })).status, 403);
    assert.equal((await f.handlers.POST({ request: request(mutation("delete", {})) })).status, 403);
    assert.ok(f.calls.every(([name]) => name === "check_kova_site_auth_session"));
  }
});

test("Sites reads use the already-verified owned cookie principal, with no hosted bearer lookup", async () => {
  const f = fixture({ provider: "kova" });
  const response = await f.handlers.GET({ request: new Request("https://kovagpt.test/api/sites") });
  assert.equal(response.status, 200);
  assert.equal(f.calls[0][0], "check_kova_owned_site_auth_session");
  assert.equal(f.calls[0][1].p_user, owner);
  assert.equal(f.calls[0][1].p_session, owner);
  assert.ok(!f.calls.some(([name]) => name === "check_kova_site_auth_session"));
});

test("missing, revoked or unrecognized owned Sites authority cannot reach a read", async () => {
  for (const options of [
    { provider: "kova", current: false },
    { provider: "unknown" },
    { provider: "kova", claims: "missing" },
  ]) {
    const f = fixture(options);
    assert.equal(
      (await f.handlers.GET({ request: new Request("https://kovagpt.test/api/sites") })).status,
      403,
    );
    assert.ok(f.calls.every(([name]) => name === "check_kova_owned_site_auth_session"));
  }
});
test("an unavailable isolated host cannot mint an access ticket or publish a version", async () => {
  const f = fixture();
  for (const body of [
    { action: "ticket", siteId: site, payload: {} },
    mutation("publish", { versionId: crypto.randomUUID(), visibility: "public" }),
  ]) {
    assert.equal((await f.handlers.POST({ request: request(body) })).status, 503);
  }
  assert.ok(f.calls.every(([name]) => name === "check_kova_site_auth_session"));
});
test("version admission binds the authenticated owner and computes immutable hashes from actual bytes", async () => {
  const f = fixture();
  const files = [{ path: "index.html", base64: btoa("<h1>Actual bytes</h1>") }];
  const version = crypto.randomUUID();
  const response = await f.handlers.POST({
    request: request(mutation("saveVersion", { versionId: version, files })),
  });
  assert.equal(response.status, 200);
  const args = f.calls.find(([name]) => name === "mutate_kova_site")[1];
  assert.equal(args.p_owner, owner);
  assert.equal(args.p_site, site);
  assert.equal(args.p_payload.files[0].sha256, await policy.sha256("<h1>Actual bytes</h1>"));
  assert.equal(
    args.p_payload.manifestSha256,
    (await policy.inspectSiteFiles(files)).manifestSha256,
  );
  const forged = mutation("saveVersion", {
    versionId: version,
    files,
    manifestSha256: "0".repeat(64),
  });
  assert.equal((await f.handlers.POST({ request: request(forged) })).status, 400);
  assert.equal(f.calls.filter(([name]) => name === "mutate_kova_site").length, 1);
});
