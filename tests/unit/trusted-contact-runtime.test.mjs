import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../src/lib/trusted-contact-policy.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as security from "../../src/lib/auth-security.mjs";

const actor = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const compiled = ts.transpileModule(readFileSync("src/routes/api/trusted-contacts.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(options = {}) {
  const calls = [],
    exports = {};
  const admin = {
    rpc(name, args) {
      calls.push({ event: "rpc", name, args });
      return {
        abortSignal: async (signal) => {
          assert.equal(signal.aborted, false);
          if (options.rpcThrow) throw new Error("private database credential");
          return options.rpcResult ?? { data: { id, revision: 2, state: "pending" }, error: null };
        },
      };
    },
  };
  const client = {
    auth: {
      getUser: async (token) => {
        calls.push({ event: "auth", token });
        return {
          data: {
            user: options.user ?? {
              id: actor,
              email: "verified@kova.test",
              email_confirmed_at: "2026-09-05",
            },
          },
          error: null,
        };
      },
    },
    from(table) {
      const query = { event: "read", table, operations: [] };
      calls.push(query);
      const builder = {};
      for (const method of ["select", "in", "eq", "order", "limit", "range"])
        builder[method] = (...args) => {
          query.operations.push({ method, args });
          return builder;
        };
      builder.abortSignal = async () =>
        options.readError
          ? { data: null, error: { message: "private SQL credential" } }
          : {
              data:
                table === "trusted_contact_blocks"
                  ? Array.from({ length: 101 }, (_, i) => ({ blocked_user_id: i }))
                  : [],
              error: null,
            };
      return builder;
    },
  };
  const dependencies = {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "node:crypto": { createHash, randomBytes },
    "@/lib/api-auth.server": {
      requireUser: async () =>
        options.unauthorized
          ? new Response("Unauthorized", { status: 401 })
          : { userId: actor, supabaseUser: client, supabaseAdmin: admin },
    },
    "@/lib/runtime-env.server": {
      runtimeEnv: (key) =>
        options.enabled === false
          ? ""
          : key === "KOVA_TRUSTED_CONTACTS_ENABLED"
            ? "true"
            : policy.TRUSTED_CONTACT_POLICY_VERSION,
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async (args) => {
        calls.push({ event: "rate", args });
        return options.budget ?? { allowed: true };
      },
    },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/auth-security.mjs": security,
    "@/lib/trusted-contact-policy.mjs": policy,
  };
  vm.runInNewContext(compiled, {
    exports,
    Response,
    URL,
    AbortSignal,
    require(name) {
      assert.ok(name in dependencies);
      return dependencies[name];
    },
  });
  return { handlers: exports.Route.server.handlers, calls };
}
function request(body, headers = {}, suffix = "") {
  return new Request(`https://kova.test/api/trusted-contacts${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer pinned", "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
const invite = {
  action: "invite",
  id,
  recipientEmail: "target@kova.test",
  consent: true,
  policyVersion: policy.TRUSTED_CONTACT_POLICY_VERSION,
};
const change = { action: "review", id, commandId, revision: 1 };

test("contact commands enforce auth, cross-site checks, bounded input, and activation before identity lookup", async () => {
  for (const [options, body, headers, expected] of [
    [{ unauthorized: true }, invite, {}, 401],
    [{}, invite, { "Sec-Fetch-Site": "cross-site" }, 403],
    [{}, "x".repeat(4097), {}, 400],
    [{}, { ...invite, consent: false }, {}, 400],
    [{ enabled: false }, invite, {}, 503],
    [{ enabled: false }, change, {}, 503],
    [{ budget: { allowed: false, status: "limited" } }, invite, {}, 429],
    [{ budget: { allowed: false, status: "unavailable" } }, invite, {}, 503],
  ]) {
    const { handlers, calls } = fixture(options);
    const response = await handlers.POST({ request: request(body, headers) });
    assert.equal(response.status, expected);
    assert.equal(
      calls.some((call) => ["auth", "rpc"].includes(call.event)),
      false,
    );
  }
});

test("invitation attempts are charged before lookup and use the authenticated verified sender", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.POST({
    request: request({ ...invite, actor: id, actorEmail: "forged@kova.test" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((call) => call.event),
    ["rate", "auth", "rpc"],
  );
  assert.equal(calls[0].args.identity, actor);
  assert.equal(calls[0].args.limit, 5);
  assert.equal(calls[2].args.p_actor, actor);
  assert.equal(calls[2].args.p_actor_email, "verified@kova.test");
  assert.equal((await response.json()).notificationDelivery, "in_app_only");
  for (const user of [
    { id, email: "verified@kova.test", email_confirmed_at: "now" },
    { id: actor, email: "verified@kova.test" },
  ]) {
    const failed = fixture({ user });
    assert.equal((await failed.handlers.POST({ request: request(invite) })).status, 409);
    assert.equal(
      failed.calls.some((call) => call.event === "rpc"),
      false,
    );
  }
});

test("review returns an in-memory token once while RPCs receive only its digest and caller identity", async () => {
  const { handlers, calls } = fixture();
  const response = await handlers.POST({ request: request(change) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.match(body.token, /^[a-f0-9]{64}$/u);
  const rpc = calls.find((call) => call.event === "rpc");
  assert.equal(rpc.args.p_actor, actor);
  assert.equal(rpc.args.p_token_digest, createHash("sha256").update(body.token).digest("hex"));
  assert.equal(JSON.stringify(rpc).includes(body.token), false);
  const accepted = fixture();
  const acceptance = await accepted.handlers.POST({
    request: request({
      ...change,
      action: "accept",
      token: body.token,
      consent: true,
      policyVersion: policy.TRUSTED_CONTACT_POLICY_VERSION,
    }),
  });
  assert.equal("token" in (await acceptance.json()), false);
  assert.equal(accepted.calls.find((call) => call.event === "rpc").args.p_consent, true);
});

test("privacy actions remain available while disabled and database failures never expose details", async () => {
  const { handlers, calls } = fixture({ enabled: false });
  assert.equal(
    (await handlers.POST({ request: request({ ...change, action: "revoke" }) })).status,
    200,
  );
  assert.equal(calls.find((call) => call.event === "rpc").args.p_action, "revoke");
  for (const options of [
    { rpcThrow: true },
    { rpcResult: { data: null, error: { message: "private database credential" } } },
  ]) {
    const failed = fixture(options);
    const response = await failed.handlers.POST({ request: request(change) });
    assert.equal(response.status, 409);
    assert.doesNotMatch(await response.text(), /private database|credential|token_digest/u);
  }
});

test("contact reads use caller RLS, isolate bounded active/history sets, and paginate private blocks", async () => {
  const { handlers, calls } = fixture({ enabled: false });
  const response = await handlers.GET({ request: request(undefined, {}, "?blockPage=2") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.enabled, false);
  assert.equal(body.blocked.length, 100);
  assert.equal(body.moreBlocked, true);
  assert.equal(body.blockPage, 2);
  assert.equal(
    calls.some((call) => call.event === "rpc"),
    false,
  );
  const read = calls.find((call) => call.table === "trusted_contact_blocks");
  assert.deepEqual(
    JSON.parse(JSON.stringify(read.operations.find((op) => op.method === "range").args)),
    [200, 300],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(read.operations.find((op) => op.method === "eq").args)),
    ["user_id", actor],
  );
  const failed = fixture({ readError: true });
  const failure = await failed.handlers.GET({ request: request(undefined) });
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private SQL|credential/u);
});
