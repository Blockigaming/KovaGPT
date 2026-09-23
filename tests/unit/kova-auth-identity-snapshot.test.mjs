import assert from "node:assert/strict";
import test from "node:test";
import { readAccountIdentity } from "../../src/lib/account-identity.server.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const identity = {
  id,
  email: "real@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "kova" },
  user_metadata: { full_name: "Real" },
};
async function mode(value, run) {
  const previous = process.env.KOVA_AUTH_MODE;
  process.env.KOVA_AUTH_MODE = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.KOVA_AUTH_MODE;
    else process.env.KOVA_AUTH_MODE = previous;
  }
}
for (const value of ["kova", "dual"])
  test(`${value}: verified directory projection is closed and never invokes hosted administration`, async () =>
    mode(value, async () => {
      const calls = [];
      const client = {
        get auth() {
          throw new Error("hosted Auth forbidden");
        },
        rpc: async (name, args) => {
          calls.push([name, args]);
          return {
            data: {
              ...identity,
              encrypted_password: "secret",
              user_metadata: { full_name: "Real", access_token: "secret" },
            },
          };
        },
      };
      const result = await readAccountIdentity(client, id);
      assert.equal(result.email, identity.email);
      assert.doesNotMatch(JSON.stringify(result), /secret|access_token|encrypted_password/u);
      assert.deepEqual(calls, [
        [
          "kova_auth_account_snapshot",
          { p_account_id: id, p_allow_legacy: value === "dual", p_require_verified: true },
        ],
      ]);
    }));
test("owned identity null, outages and malformed data cannot fall back to a hosted user", async (t) =>
  mode("kova", async () => {
    for (const [name, response, expected] of [
      ["absent", { data: null }, null],
      ["unverified", { data: { ...identity, email_confirmed_at: null } }, null],
      ["outage", { data: null, error: { message: "private" } }, "error"],
      [
        "different owner",
        { data: { ...identity, id: "20000000-0000-4000-8000-000000000002" } },
        "error",
      ],
      ["shadow", { data: { ...identity, email: "shadow+test@auth.invalid.kovagpt.com" } }, "error"],
      [
        "wrong authority",
        { data: { ...identity, app_metadata: { provider: "supabase" } } },
        "error",
      ],
      ["malformed", { data: [] }, "error"],
      ["suspended", { data: { ...identity, banned_until: "infinity" } }, null],
    ])
      await t.test(name, async () => {
        const client = {
          get auth() {
            throw new Error("no fallback");
          },
          rpc: async () => response,
        };
        if (expected === "error")
          await assert.rejects(
            readAccountIdentity(client, id),
            /account_identity_(invalid|unavailable)/u,
          );
        else assert.equal(await readAccountIdentity(client, id), expected);
      });
  }));
test("invalid owner IDs fail before a database call", async () => {
  for (const value of [null, "", [], "owner", "../id"])
    assert.equal(await readAccountIdentity({}, value), null);
});
test("legacy mode keeps its explicit hosted implementation but strips credential-shaped metadata", async () =>
  mode("supabase", async () => {
    const client = {
      auth: {
        admin: {
          getUserById: async (requested) => {
            assert.equal(requested, id);
            return {
              data: {
                user: {
                  ...identity,
                  app_metadata: { provider: "google", private: "secret" },
                  user_metadata: { full_name: "Real", token: "secret" },
                },
              },
            };
          },
        },
      },
    };
    const row = await readAccountIdentity(client, id);
    assert.equal(row.app_metadata.provider, "supabase");
    assert.doesNotMatch(JSON.stringify(row), /secret|token/u);
  }));
