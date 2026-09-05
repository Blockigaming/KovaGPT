import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as nodeCrypto from "node:crypto";
import * as policy from "../../src/lib/scim/policy.mjs";
import * as bounded from "../../src/lib/bounded-json.server.mjs";
const uid = "11111111-1111-4111-8111-111111111111",
  org = "22222222-2222-4222-8222-222222222222",
  provider = "33333333-3333-4333-8333-333333333333",
  id = "44444444-4444-4444-8444-444444444444",
  token = "a".repeat(43);
function load({
  enabled = true,
  actor = uid,
  rpc = () => ({ data: null, error: null }),
  registry = true,
} = {}) {
  const calls = [],
    exports = {},
    admin = {
      rpc(name, args) {
        calls.push({ name, args });
        return { abortSignal: async () => rpc(name, args) };
      },
    };
  const dependencies = {
    "node:crypto": nodeCrypto,
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () => ({ userId: actor, supabaseAdmin: admin }),
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/auth-security.mjs": {
      isCrossSiteMutation: (r) => r.headers.get("sec-fetch-site") === "cross-site",
    },
    "@/lib/bounded-json.server.mjs": bounded,
    "@/lib/organization-policy.mjs": { organizationAvailability: () => ({ available: true }) },
    "@/lib/organization-domain.server": {
      configuredOrganizationSsoProvider: () => {
        if (!registry) throw Error();
        return provider;
      },
    },
    "./policy.mjs": policy,
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/scim/server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      process: { env: { KOVA_ORGANIZATION_SCIM_ENABLED: enabled ? "true" : "false" } },
      AbortSignal,
      URL,
      Response,
      Request,
      Headers,
      console,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  return { ...exports, calls };
}
const info = { organizationId: org, providerId: provider, domain: {} };
const user = {
  id,
  external_id: "subject",
  user_name: "person@example.com",
  display_name: "Person",
  active: true,
  revision: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const native = (method = "GET", path = "Users", body, extra = {}) =>
  new Request(`https://kova.test/api/scim/v2/${org}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/scim+json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
test("actual SCIM endpoint is disabled by default, authenticates discovery and rejects removed provider configuration before any resource mutation", async () => {
  let app = load({ enabled: false });
  assert.equal((await app.receiveScim(native(), org, "Users")).status, 503);
  assert.equal(app.calls.length, 0);
  app = load();
  assert.equal(
    (await app.receiveScim(new Request("https://kova.test"), org, "Schemas")).status,
    401,
  );
  assert.equal(app.calls.length, 0);
  app = load({ registry: false, rpc: () => ({ data: info, error: null }) });
  assert.equal((await app.receiveScim(native("POST", "Users", {}), org, "Users")).status, 503);
  assert.equal(app.calls.length, 1);
  app = load({ rpc: () => ({ data: info, error: null }) });
  const res = await app.receiveScim(
    native("GET", "ServiceProviderConfig"),
    org,
    "ServiceProviderConfig",
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).etag.supported, true);
  assert.equal(
    app.calls[0].args.p_token_hash,
    nodeCrypto.createHash("sha256").update(token).digest("hex"),
  );
  assert.ok(!JSON.stringify(app.calls).includes(token));
});
test("actual PATCH pins ETag read and replacement; concurrent change fails without unconditional overwrite", async () => {
  const app = load({
    rpc: (_name, args) => ({
      data: args.p_operation === "authorize" ? info : args.p_operation === "get" ? user : null,
      error: args.p_operation === "replace" ? { code: "40001" } : null,
    }),
  });
  const input = {
    schemas: [policy.SCIM_SCHEMA.patch],
    Operations: [{ op: "replace", path: "active", value: false }],
  };
  assert.equal(
    (await app.receiveScim(native("PATCH", `Users/${id}`, input), org, `Users/${id}`)).status,
    428,
  );
  const result = await app.receiveScim(
    native("PATCH", `Users/${id}`, input, { "If-Match": 'W/"3"' }),
    org,
    `Users/${id}`,
  );
  assert.equal(result.status, 412);
  const mutation = app.calls.find((call) => call.args.p_operation === "replace").args;
  assert.equal(mutation.p_data.expectedRevision, 3);
  assert.equal(mutation.p_data.resource.externalId, "subject");
  assert.equal(mutation.p_data.resource.active, false);
});
test("owner endpoint pins captured principal, current owner revision and explicit consent; plaintext token is returned once and only its hash is stored", async () => {
  const make = (body) =>
    new Request("https://kova.test/api/organizations/scim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const app = load({
    rpc: (_name, args) => ({
      data:
        args.p_operation === "status"
          ? { ...info, revision: 4, providerReady: true }
          : { revision: 5, enabled: true },
      error: null,
    }),
  });
  const input = {
    expectedUserId: uid,
    organizationId: org,
    operation: "rotate",
    expectedRevision: 4,
    consent: true,
  };
  assert.equal(
    (await app.administerScim(make({ ...input, expectedUserId: provider }))).status,
    403,
  );
  assert.equal(app.calls.length, 0);
  assert.equal((await app.administerScim(make({ ...input, consent: false }))).status, 409);
  const response = await app.administerScim(make(input)),
    value = await response.json();
  assert.equal(response.status, 200);
  assert.match(value.token, /^[A-Za-z0-9_-]{43}$/);
  const call = app.calls.find((call) => call.args.p_operation === "rotate");
  assert.equal(
    call.args.p_data.tokenHash,
    nodeCrypto.createHash("sha256").update(value.token).digest("hex"),
  );
  assert.equal(call.args.p_data.expectedRevision, 4);
  assert.ok(!JSON.stringify(app.calls).includes(value.token));
});
