import assert from "node:assert/strict";
import test from "node:test";
import * as boundedJson from "../../src/lib/bounded-json.server.mjs";
import * as keyCredentials from "../../src/integrations/key-connection-credential.server.mjs";
import * as lockdown from "../../src/lib/lockdown-policy.mjs";
import { GRANOLA_NOTE_READ } from "../../src/integrations/connection-flows.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const owner = "00000000-0000-4000-8000-000000000005";
const key = "grn_fixture_only";
const request = (provider, binding) =>
  new Request("https://kovagpt.com/api/integrations/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...binding, provider, apiKey: key, owner_id: "different-user" }),
  });

function fixture(provider = "granola", binding = {}) {
  const expectedToken = keyCredentials.prepareKeyCredential(provider, {
    ...binding,
    apiKey: key,
  }).token;
  const state = { session: true, writes: [], reads: 0, encryption: 0 };
  const db = {
    from(table) {
      const filters = [];
      let row;
      const chain = {
        select() {
          return chain;
        },
        eq(column, value) {
          filters.push([column, value]);
          return chain;
        },
        is(column, value) {
          return chain.eq(column, value);
        },
        insert(value) {
          if (table !== "integration_linked_accounts") {
            state.writes.push([table, value]);
            return Promise.resolve({ error: null });
          }
          row = value;
          return chain;
        },
        update(value) {
          row = value;
          return chain;
        },
        maybeSingle() {
          if (table === "user_preferences")
            return Promise.resolve({ data: { settings: {} }, error: null });
          if (!row) return Promise.resolve({ data: state.previous ?? null, error: null });
          if (
            state.previous &&
            !filters.every(([column, value]) => state.previous[column] === value)
          )
            return Promise.resolve({ data: null, error: null });
          state.writes.push([table, row]);
          return Promise.resolve({ data: { id: "linked-id" }, error: null });
        },
      };
      return chain;
    },
  };
  const { Route } = loadUiModule(
    "src/routes/api/integrations/accounts.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/api-auth.server": {
        requireUser: async () =>
          state.anonymous
            ? new Response(null, { status: 401 })
            : {
                userId: owner,
                supabaseAdmin: db,
                revalidateSession: async () => state.session,
              },
      },
      "@/integrations/oauth-providers.server": {
        configuredKeyProviders: () => [
          { id: "granola", name: "Granola", requiredScopes: [GRANOLA_NOTE_READ] },
          { id: "hyperframes-heygen", name: "HyperFrames", requiredScopes: ["hyperframes:read"] },
          { id: "mixpanel", name: "Mixpanel", requiredScopes: ["mixpanel:cohorts:list"] },
          { id: "notion-private", name: "Notion linked page", requiredScopes: ["page:read"] },
        ],
      },
      "@/integrations/connected-tools.server": {},
      "@/lib/bounded-json.server.mjs": boundedJson,
      "@/lib/lockdown-policy.mjs": lockdown,
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: async () => ({ allowed: !state.limited, status: "limited" }),
      },
      "@/integrations/credential-vault.server": {
        encryptCredential: async (value) => {
          assert.equal(value, expectedToken);
          state.encryption++;
          return "encrypted-fixture";
        },
      },
      "@/integrations/key-connection-credential.server.mjs": keyCredentials,
      "@/integrations/connection-read.server.mjs": {
        readConnection: async (requestedProvider, query, token) => {
          assert.equal(requestedProvider, provider);
          assert.equal(query, provider === "notion-private" ? "open" : "recent");
          assert.equal(token, expectedToken);
          state.reads++;
          await state.onRead?.();
        },
      },
    },
    { Response, Error },
  );
  return { state, post: () => Route.server.handlers.POST({ request: request(provider, binding) }) };
}

test("Granola stores only an encrypted, owner-bound key after a provider read", async () => {
  const { state, post } = fixture();
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(state.reads, 1);
  assert.equal(state.encryption, 1);
  assert.equal(state.writes[0][1].owner_id, owner);
  assert.equal(state.writes[0][1].access_token_ciphertext, "encrypted-fixture");
  assert.equal(JSON.stringify(state.writes).includes(key), false);
});

test("Notion stores a page-bound token only after the exact page can be read", async () => {
  const pageId = "12345678-abcd-4123-8123-12345678abcd";
  const { state, post } = fixture("notion-private", { pageId });
  assert.equal((await post()).status, 200);
  assert.equal(state.reads, 1);
  assert.equal(state.encryption, 1);
  assert.equal(state.writes[0][1].owner_id, owner);
  assert.equal(state.writes[0][1].provider_account_id, pageId);
  assert.deepEqual(structuredClone(state.writes[0][1].granted_scopes), ["page:read"]);
  assert.equal(state.writes[0][1].access_token_ciphertext, "encrypted-fixture");
  assert.doesNotMatch(JSON.stringify(state.writes), /grn_fixture_only/u);

  const denied = fixture("notion-private", { pageId });
  denied.state.onRead = () => {
    throw new Error("connection_permission_required");
  };
  assert.equal((await denied.post()).status, 403);
  assert.equal(denied.state.encryption, 0);
  assert.deepEqual(denied.state.writes, []);
});

test("Granola refuses rejected credentials, a stale replacement, and a session that ended during validation", async () => {
  const denied = fixture();
  denied.state.onRead = () => {
    throw new Error("connection_permission_required");
  };
  assert.equal((await denied.post()).status, 403);
  assert.equal(denied.state.encryption, 0);
  assert.deepEqual(denied.state.writes, []);

  const concurrent = fixture();
  concurrent.state.previous = {
    id: "linked",
    owner_id: owner,
    provider_id: "granola",
    workspace_id: null,
    updated_at: "old",
    access_token_ciphertext: "old",
  };
  concurrent.state.onRead = () => {
    concurrent.state.previous = { ...concurrent.state.previous, access_token_ciphertext: "new" };
  };
  assert.equal((await concurrent.post()).status, 409);
  assert.deepEqual(concurrent.state.writes, []);

  const signedOut = fixture();
  signedOut.state.onRead = () => {
    signedOut.state.session = false;
  };
  assert.equal((await signedOut.post()).status, 401);
  assert.deepEqual(signedOut.state.writes, []);
});

test("Granola requires authentication and rate-limit admission before calling the provider", async () => {
  const unauthenticated = fixture();
  unauthenticated.state.anonymous = true;
  assert.equal((await unauthenticated.post()).status, 401);
  assert.equal(unauthenticated.state.reads, 0);
  const limited = fixture();
  limited.state.limited = true;
  assert.equal((await limited.post()).status, 429);
  assert.equal(limited.state.reads, 0);
});

test("HyperFrames uses the shared key setup with its own provider binding", async () => {
  const { state, post } = fixture("hyperframes-heygen");
  assert.equal((await post()).status, 200);
  assert.equal(state.reads, 1);
  assert.equal(state.writes[0][1].provider_id, "hyperframes-heygen");
  assert.equal(state.writes[0][1].access_token_ciphertext, "encrypted-fixture");
  assert.equal(state.writes[0][1].granted_scopes[0], "hyperframes:read");
});

test("Mixpanel binds a saved project, region and workspace to the encrypted credential", async () => {
  const binding = { username: "fixture", region: "in", projectId: "12", workspaceId: "34" };
  const { state, post } = fixture("mixpanel", binding);
  const response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(state.encryption, 1);
  assert.equal(state.writes[0][1].provider_account_id, "in:12:34");
  assert.equal(state.writes[0][1].access_token_ciphertext, "encrypted-fixture");
  assert.equal(JSON.stringify(state.writes).includes(`"username"`), false);
  assert.equal(JSON.stringify(state.writes).includes(key), false);
});
