import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_EMAIL_EVENTS,
  DEFAULT_ACCOUNT_EMAIL_PREFERENCES,
  parseAccountEmailPreferencePatch,
  parseAccountEmailPreferences,
} from "../../src/lib/account-email-preferences.mjs";
import { makeAccountEmailPreferenceHandlers } from "../../src/lib/account-email-preferences-http.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const origin = "https://staging.example.test";
const request = (method = "GET", body, headers = {}) =>
  new Request(`${origin}/api/account/email-preferences`, {
    method,
    headers: {
      "X-Kova-Owner": owner,
      ...(method === "PATCH" ? { Origin: origin, "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
function fixture(overrides = {}) {
  const calls = [];
  const dependencies = {
    authenticate: async () => ({ userId: owner, emailVerified: true }),
    consumeRateLimit: async (input) => {
      calls.push(["limit", input]);
      return { allowed: true, status: "allowed" };
    },
    readPreferences: async (auth) => {
      calls.push(["read", auth.userId]);
      return { ...DEFAULT_ACCOUNT_EMAIL_PREFERENCES };
    },
    updatePreferences: async (auth, patch) => {
      calls.push(["update", auth.userId, patch]);
      return { ...DEFAULT_ACCOUNT_EMAIL_PREFERENCES, ...patch };
    },
    publicOrigin: origin,
    ...overrides,
  };
  return { calls, handlers: makeAccountEmailPreferenceHandlers(dependencies) };
}

test("catalogue implements owner defaults without turning requested action mail into a preference", () => {
  assert.equal(ACCOUNT_EMAIL_EVENTS.length, 9);
  assert.deepEqual(
    Object.entries(DEFAULT_ACCOUNT_EMAIL_PREFERENCES)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    [
      "password_changed",
      "security_method_added",
      "security_method_changed",
      "security_method_removed",
      "account_deletion_scheduled",
      "account_deleted",
    ],
  );
  assert.equal(parseAccountEmailPreferencePatch({ email_verification: false }), null);
  assert.equal(parseAccountEmailPreferencePatch({ password_recovery: false }), null);
  assert.equal(parseAccountEmailPreferences({ new_login: false }), null);
  assert.deepEqual(
    parseAccountEmailPreferences(DEFAULT_ACCOUNT_EMAIL_PREFERENCES),
    DEFAULT_ACCOUNT_EMAIL_PREFERENCES,
  );
});

test("GET reads server-owned preferences and PATCH saves only the supplied known event", async () => {
  const { handlers, calls } = fixture();
  const get = await handlers.GET({ request: request() });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await get.json(), {
    version: 1,
    preferences: DEFAULT_ACCOUNT_EMAIL_PREFERENCES,
  });
  const patch = await handlers.PATCH({
    request: request("PATCH", { preferences: { new_login: true } }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).preferences.new_login, true);
  assert.deepEqual(
    calls.find(([kind]) => kind === "update"),
    ["update", owner, { new_login: true }],
  );
  assert.equal(calls[0][1].identity, `account:${owner}`);
});

test("cross-origin changes, missing owner and unverified identity never reach storage", async () => {
  for (const [custom, req, status] of [
    [
      {},
      request("PATCH", { preferences: { new_login: true } }, { Origin: "https://attacker.test" }),
      403,
    ],
    [{}, request("PATCH", { preferences: { new_login: true } }, { Origin: "" }), 403],
    [{}, request("GET", undefined, { "X-Kova-Owner": "another-owner" }), 409],
    [{ authenticate: async () => ({ userId: owner, emailVerified: false }) }, request(), 403],
    [
      { authenticate: async () => Response.json({ error: "Unauthorized" }, { status: 401 }) },
      request(),
      401,
    ],
  ]) {
    const { handlers, calls } = fixture(custom);
    const response = await handlers[req.method]({ request: req });
    assert.equal(response.status, status);
    assert.equal(calls.filter(([kind]) => kind === "read" || kind === "update").length, 0);
  }
});

test("unknown keys, recipient/owner selectors, nonboolean values and oversized bodies are rejected", async () => {
  for (const body of [
    { preferences: {} },
    { preferences: { email_verification: false } },
    { preferences: { new_login: "yes" } },
    { preferences: { new_login: true }, recipient: "attacker@example.test" },
    { preferences: { new_login: true }, ownerId: owner },
    { preferences: { unknown_event: false } },
    { preferences: { new_login: true }, padding: "a".repeat(2100) },
  ]) {
    const { handlers, calls } = fixture();
    const result = await handlers.PATCH({ request: request("PATCH", body) });
    assert.ok([400, 413].includes(result.status));
    assert.equal(
      calls.some(([kind]) => kind === "update"),
      false,
    );
  }
});

test("distributed limiter and backend uncertainty fail closed with generic errors", async () => {
  for (const [override, status] of [
    [{ consumeRateLimit: async () => ({ allowed: false, status: "limited" }) }, 429],
    [
      {
        consumeRateLimit: async () => {
          throw new Error("private upstream details");
        },
      },
      503,
    ],
    [
      {
        readPreferences: async () => {
          throw new Error("private key details");
        },
      },
      503,
    ],
    [{ readPreferences: async () => ({ new_login: false }) }, 503],
  ]) {
    const { handlers } = fixture(override);
    const result = await handlers.GET({ request: request() });
    assert.equal(result.status, status);
    assert.doesNotMatch(await result.text(), /private|key details|upstream/u);
  }
});

test("a revoked or replaced current session does not read or disclose saved preferences", async () => {
  const { handlers, calls } = fixture({
    authenticate: async () => ({
      userId: owner,
      emailVerified: true,
      revalidateSession: async () => false,
    }),
  });
  const result = await handlers.GET({ request: request() });
  assert.equal(result.status, 401);
  assert.equal(
    calls.some(([kind]) => kind === "read"),
    false,
  );
});
