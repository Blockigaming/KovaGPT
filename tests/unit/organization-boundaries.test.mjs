import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../src/lib/organization-policy.mjs";
import * as bounded from "../../src/lib/bounded-json.server.mjs";
import * as security from "../../src/lib/auth-security.mjs";
const user = "11111111-1111-4111-8111-111111111111",
  org = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
function load(path, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      Response,
      Request,
      URL,
      AbortController,
      AbortSignal,
      DOMException,
      TextDecoder,
      Uint8Array,
      setTimeout,
      clearTimeout,
      process: { env: {} },
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
      ...globals,
    },
  );
  return exports;
}
const domainModule = load("src/lib/organization-domain.server.ts", {
  "node:dns/promises": { resolveTxt: () => assert.fail("unexpected real DNS") },
  "@/lib/organization-policy.mjs": policy,
});
const domain = {
  id,
  domain: "example.com",
  state: "verified",
  challenge_token: id,
  verification_expires_at: "2030-01-01T00:00:00Z",
};
function handlers({
  env = {},
  auth,
  status = "allowed",
  rpc = () => assert.fail("unexpected RPC"),
} = {}) {
  return load(
    "src/routes/api/organizations.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/api-auth.server": {
        requireVerifiedUser: async () => auth ?? { userId: user, supabaseAdmin: { rpc } },
      },
      "@/lib/auth-security.mjs": security,
      "@/lib/bounded-json.server.mjs": bounded,
      "@/lib/organization-policy.mjs": policy,
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: async (input) => {
          assert.equal(input.identity, `user:${user}`);
          return { allowed: status === "allowed", status, retryAfter: 60 };
        },
      },
      "@/lib/organization-domain.server": {
        ...domainModule,
        verifyOrganizationDns: async () => id,
      },
    },
    { process: { env } },
  ).Route.server.handlers;
}
const enabled = {
  KOVA_ORGANIZATION_ADMIN_ENABLED: "true",
  KOVA_ORGANIZATION_POLICY_VERSION: "approved-test-v1",
};
const body = (action, payload = {}) => ({
  action,
  organizationId: org,
  expectedRevision: 1,
  mutationId: id,
  payload,
});
const request = (data, headers = {}) =>
  new Request("https://kovagpt.test/api/organizations", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(data),
  });

test("organization availability defaults disabled and never claims retention enforcement", () => {
  assert.equal(policy.organizationAvailability({}).available, false);
  assert.equal(
    policy.organizationAvailability({ KOVA_ORGANIZATION_ADMIN_ENABLED: "true" }).available,
    false,
  );
  assert.deepEqual(policy.organizationAvailability(enabled), {
    available: true,
    canClose: false,
    retentionEnforced: false,
  });
  assert.equal(
    policy.organizationAvailability({ ...enabled, KOVA_ORGANIZATION_CLOSURE_ENABLED: "true" })
      .canClose,
    true,
  );
});
test("public inputs reject internal verification/provider evidence, unsafe domains, and unbounded export cursors", () => {
  for (const input of [
    body("verifyDomain", { domainId: id, verifiedChallenge: id }),
    body("configureSso", { domainId: id, providerId: id }),
    body("setRole", { userId: user, role: "superadmin" }),
    body("create", { name: "Example" }),
  ])
    assert.throws(() => policy.parseOrganizationMutation(input));
  for (const value of [
    "https://example.com",
    "example.com/path",
    "127.0.0.1",
    "localhost",
    "x..com",
    "-x.com",
    "example.com\n",
  ])
    assert.throws(() => policy.normalizeOrganizationDomain(value));
  assert.equal(policy.normalizeOrganizationDomain("Example.COM"), "example.com");
  assert.throws(() =>
    policy.parseOrganizationQuery(
      `https://kovagpt.test/api/organizations?organizationId=${org}&view=audit&limit=201`,
    ),
  );
  assert.throws(() =>
    policy.parseOrganizationQuery(
      `https://kovagpt.test/api/organizations?organizationId=${org}&view=audit&cursor=5`,
    ),
  );
});
test("DNS verification requires the exact current public challenge and has a bounded timeout", async () => {
  let queried;
  assert.equal(
    await domainModule.verifyOrganizationDns(domain, async (name) => {
      queried = name;
      return [[`kovagpt-domain=${id}`]];
    }),
    id,
  );
  assert.equal(queried, "_kovagpt-verification.example.com");
  await assert.rejects(
    domainModule.verifyOrganizationDns(domain, async () => [["kovagpt-domain=unrelated"]]),
    /proof_missing/,
  );
  const fast = load(
    "src/lib/organization-domain.server.ts",
    { "node:dns/promises": {}, "@/lib/organization-policy.mjs": policy },
    { setTimeout: (fn) => setTimeout(fn, 1) },
  );
  await assert.rejects(
    fast.verifyOrganizationDns(domain, () => new Promise(() => {})),
    /dns_timeout/,
  );
});
test("SSO requires a fresh verified domain plus an exact operator-configured organization/provider binding", () => {
  const env = {
    KOVA_ORGANIZATION_SSO_CONNECTIONS_JSON: JSON.stringify({
      [org]: { providerId: user, domains: ["example.com"] },
    }),
  };
  assert.equal(domainModule.configuredOrganizationSsoProvider(org, domain, env, 0), user);
  for (const altered of [
    { ...domain, state: "pending" },
    { ...domain, verification_expires_at: null },
    { ...domain, domain: "unrelated.com" },
  ])
    assert.throws(() => domainModule.configuredOrganizationSsoProvider(org, altered, env, 0));
  assert.throws(() => domainModule.configuredOrganizationSsoProvider(user, domain, env, 0));
  assert.throws(() => domainModule.configuredOrganizationSsoProvider(org, domain, {}, 0));
});
test("disabled, unverified, rate-limited, cross-site, and inactive closure requests perform no mutation", async () => {
  const disabled = handlers();
  assert.equal(
    (await disabled.GET({ request: new Request("https://kovagpt.test/api/organizations") })).status,
    200,
  );
  assert.equal(
    (await disabled.POST({ request: request(body("rename", { name: "Example" })) })).status,
    503,
  );
  assert.equal(
    (
      await handlers({ env: enabled, auth: new Response("Verify email", { status: 403 }) }).POST({
        request: request(body("leave")),
      })
    ).status,
    403,
  );
  assert.equal(
    (await handlers({ env: enabled, status: "limited" }).POST({ request: request(body("leave")) }))
      .status,
    429,
  );
  assert.equal(
    (
      await handlers({ env: enabled }).POST({
        request: request(body("leave"), { "sec-fetch-site": "cross-site" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await handlers({ env: enabled }).POST({
        request: request(body("close", { confirmation: "Example" })),
      })
    ).status,
    503,
  );
});
test("domain proof sent to SQL is assembled only after current-owner and revision checks", async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return name === "read_organization_workspace"
      ? { data: { organization: { role: "owner", revision: 1 }, domains: [domain] }, error: null }
      : { data: { revision: 2 }, error: null };
  };
  const response = await handlers({ env: enabled, rpc }).POST({
    request: request(body("verifyDomain", { domainId: id })),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.p_actor_user_id, user);
  assert.equal(calls[1].args.p_payload.verifiedChallenge, id);
  let mutations = 0;
  const rejected = await handlers({
    env: enabled,
    rpc: async (name) => {
      if (name === "mutate_organization") mutations++;
      return {
        data: { organization: { role: "member", revision: 1 }, domains: [domain] },
        error: null,
      };
    },
  }).POST({ request: request(body("verifyDomain", { domainId: id })) });
  assert.equal(rejected.status, 403);
  assert.equal(mutations, 0);
});
test("account deletion preflight surfaces ownership transfer before callers start cleanup", async () => {
  const api = load("src/lib/organization-account-deletion.server.ts", {});
  let calls = 0;
  await assert.rejects(
    api.prepareOrganizationAccountDeletion(
      {
        rpc: async (name, args) => {
          calls++;
          assert.equal(name, "prepare_org_account_deletion");
          assert.equal(args.p_user_id, user);
          return { data: null, error: { message: "organization_ownership_transfer_required" } };
        },
      },
      user,
    ),
    (error) => error.status === 409 && error.code === "organization_ownership_transfer_required",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    api.prepareOrganizationAccountDeletion(
      { rpc: async () => ({ data: null, error: { message: "private database detail" } }) },
      user,
    ),
    (error) => error.status === 503 && !error.message.includes("private"),
  );
});
test("organization requests pin their principal and bound response bytes", async () => {
  let fetches = 0;
  const api = load(
    "src/lib/organization-client.ts",
    {
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: user }, access_token: "synthetic-token" } },
              error: null,
            }),
          },
        },
      },
    },
    {
      fetch: async () => {
        fetches++;
        return new Response("{}");
      },
    },
  );
  await assert.rejects(
    api.organizationRequest(org, "/api/organizations", new AbortController().signal),
    /session_changed/,
  );
  assert.equal(fetches, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.organizationRequest(user, "/api/organizations", controller.signal));
  assert.equal(fetches, 0);
  const large = load(
    "src/lib/organization-client.ts",
    {
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: user }, access_token: "synthetic-token" } },
              error: null,
            }),
          },
        },
      },
    },
    { fetch: async () => new Response("x".repeat(1_048_577)) },
  );
  await assert.rejects(
    large.organizationRequest(user, "/api/organizations", new AbortController().signal),
    /response_too_large/,
  );
});
