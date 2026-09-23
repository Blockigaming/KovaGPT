import assert from "node:assert/strict";
import test from "node:test";
import { authDatabase } from "../helpers/kova-auth-database.mjs";
import { authHttp, authRequest, postgresTransport } from "../helpers/kova-auth-http.mjs";

const env = {
  KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test",
  KOVA_AUTH_ORIGIN: "https://kova.test",
  KOVA_EMAIL_QUEUE_ENABLED: "true",
  KOVA_GOOGLE_CLIENT_ID: "fixture-client",
  KOVA_GOOGLE_CLIENT_SECRET: "fixture-only-not-a-real-secret",
};
const state = "s".repeat(43);

function harness(db, kind, response) {
  let candidate;
  const deletes = [];
  const operation =
    kind === "password" ? "kova_auth_create_password_account" : "kova_auth_finish_google";
  const transport = postgresTransport(db, [operation]);
  const h = authHttp({
    env,
    crypto: {
      decryptKovaSecret: () =>
        JSON.stringify({
          kind: "google-state",
          browserDigest: "a".repeat(64),
          publicOrigin: env.KOVA_AUTH_PUBLIC_ORIGIN,
          authOrigin: env.KOVA_AUTH_ORIGIN,
          issuedAt: Date.now() - 1000,
          expiresAt: Date.now() + 500000,
          verifier: "v".repeat(64),
        }),
      encryptKovaSecret: () => "fixture-encrypted-binding",
      verifyGoogleIdToken: async () => ({
        subject: "fixture-google-subject",
        email: "owner@example.test",
        displayName: "Owner",
      }),
    },
    fetch: async (url, init) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      return Response.json({ id_token: "signature-verification-injected-at-provider-boundary" });
    },
    modules: {
      "@/integrations/supabase/client.server": {
        supabaseAdmin: {
          async rpc(name, args) {
            if (name === "kova_auth_create_compatibility_principal") {
              candidate = (
                await db.query("select public.kova_auth_create_compatibility_principal() as id")
              ).rows[0].id;
              return { data: candidate };
            }
            if (name === "kova_auth_delete_unused_compatibility_principal") {
              deletes.push(args.p_account_id);
              return {
                data: (
                  await db.query(
                    "select public.kova_auth_delete_unused_compatibility_principal($1) as ok",
                    [args.p_account_id],
                  )
                ).rows[0].ok,
              };
            }

            if (name === "kova_auth_consume_oauth_state")
              return {
                data: [
                  {
                    nonce_digest_hex: "a".repeat(64),
                    pkce_verifier_ciphertext: "fixture",
                    return_to: "/",
                  },
                ],
              };
            const result = await transport(name, args);
            assert.equal(result.error, undefined, result.error?.message);
            return response(result, candidate);
          },
        },
      },
    },
  });
  const run = () =>
    kind === "password"
      ? h.handleKovaSignup(
          authRequest(
            { email: "owner@example.test", password: "a valid password fixture" },
            { path: "/api/auth/signup" },
          ),
        )
      : h.handleKovaGoogleCallback(
          new Request(`https://kova.test/api/auth/google/callback?state=${state}&code=fixture`, {
            headers: { Cookie: `__Host-kova_oauth_state=${state}` },
          }),
        );
  return {
    ...h,
    run,
    deletes,
    get id() {
      return candidate;
    },
  };
}

for (const kind of ["password", "google"]) {
  for (const [label, response] of [
    [
      "lost reply",
      () => {
        throw new Error("simulated response loss after commit");
      },
    ],
    ["malformed reply", () => ({ data: [] })],
    [
      "contradictory unused reply",
      (result) => ({ data: [{ ...result.data[0], candidate_used: false }] }),
    ],
  ]) {
    test(`${kind}: ${label} preserves the adopted account and pending credentials`, async () => {
      const db = await authDatabase();
      try {
        const h = harness(db, kind, response);
        const result = await h.run();
        assert.equal(result.status, kind === "password" ? 503 : 303);
        if (kind === "google")
          assert.match(result.headers.get("location"), /google_exchange_failed/u);
        assert.deepEqual(h.deletes, []);
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from kova_private.auth_accounts where id=$1",
              [h.id],
            )
          ).rows[0].n,
          1,
        );
        if (kind === "password") {
          assert.equal(
            (
              await db.query(
                "select count(*)::int as n from kova_private.auth_credentials where account_id=$1",
                [h.id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (
              await db.query(
                "select count(*)::int as n from kova_private.auth_email_verifications where account_id=$1 and consumed_at is null",
                [h.id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (await db.query("select count(*)::int as n from public.test_email_queue")).rows[0].n,
            1,
          );
        } else {
          assert.equal(
            (
              await db.query(
                "select count(*)::int as n from kova_private.auth_identities where account_id=$1 and provider='google'",
                [h.id],
              )
            ).rows[0].n,
            1,
          );
        }
        assert.doesNotMatch(
          JSON.stringify(h.logs),
          /owner@example|fixture-google|simulated response/u,
        );
      } finally {
        await db.close();
      }
    });
  }
  test(`${kind}: only a positively acknowledged unused candidate is deleted`, async () => {
    const db = await authDatabase();
    try {
      const first = harness(db, kind, (result) => result);
      const initial = await first.run();
      assert.equal(initial.status, kind === "password" ? 202 : 303);
      const second = harness(db, kind, (result) => result);
      const repeated = await second.run();
      assert.equal(repeated.status, kind === "password" ? 202 : 303);
      assert.deepEqual(second.deletes, [second.id]);
      assert.equal((await db.query("select count(*)::int as n from auth.users")).rows[0].n, 1);
      assert.equal(
        (await db.query("select count(*)::int as n from kova_private.auth_accounts")).rows[0].n,
        1,
      );
    } finally {
      await db.close();
    }
  });
}
