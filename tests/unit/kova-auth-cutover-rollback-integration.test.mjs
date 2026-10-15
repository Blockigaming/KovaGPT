import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  authDatabase,
  digest,
  livePasswordAccount,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";
import { authHttp, postgresTransport } from "../helpers/kova-auth-http.mjs";

// Actual browser authority, session handler/store, API admission and migrations.
// Hosted signature verification and JWT signing are explicit transport fixtures;
// this does not certify live OAuth, deployed HTTP isolation or a traffic switch.
const browserSource = ts.transpileModule(
  readFileSync("src/lib/kova-auth-browser.ts", "utf8").replaceAll("import.meta.env", "TEST_ENV"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const env = {
  SUPABASE_URL: "https://fixture.invalid",
  SUPABASE_PUBLISHABLE_KEY: "fixture-public",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-admin",
  KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test",
};
const token = "K".repeat(43);
const bearer = (id = owner) => `fixture-hosted-${id}`;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];

function deployment(db, mode, { retirementFailure = false } = {}) {
  const calls = [];
  const rpc = postgresTransport(db, ["kova_auth_resolve_session", "kova_auth_revoke_session"]);
  const h = authHttp({
    mode,
    env,
    rpc,
    crypto: { signKovaCompatibilityJwt: () => "fixture-compatibility-token" },
    modules: {
      "@/lib/billing-entitlement.server": {},
      "@supabase/supabase-js": {
        createClient(_url, key, options) {
          if (key === env.SUPABASE_SERVICE_ROLE_KEY)
            return {
              async rpc(name, args) {
                calls.push(name);
                assert.equal(name, "kova_auth_legacy_session_allowed");
                if (retirementFailure) return { error: { message: "private transport fixture" } };
                return {
                  data: await scalar(db, "select public.kova_auth_legacy_session_allowed($1)", [
                    args.p_account_id,
                  ]),
                };
              },
            };
          const id = options.global.headers.Authorization.replace("Bearer fixture-hosted-", "");
          return {
            auth: {
              async getUser() {
                calls.push("hosted-user");
                const user = (
                  await db.query(
                    "select id, email, email_confirmed_at, deleted_at, banned_until from auth.users where id=$1",
                    [id],
                  )
                ).rows[0];
                return { data: { user: user ? JSON.parse(JSON.stringify(user)) : null } };
              },
              async getClaims() {
                calls.push("hosted-claims");
                return { data: { claims: { sub: id, aal: "aal1", role: "authenticated" } } };
              },
            },
          };
        },
      },
    },
  });
  const api = h.loadModule("@/lib/api-auth.server", "src/lib/api-auth.server.ts");
  const request = ({ id = owner, cookie = null, hosted = true } = {}) =>
    new Request("https://kova.test/api/private", {
      headers: {
        ...(hosted ? { Authorization: `Bearer ${bearer(id)}` } : {}),
        ...(cookie ? { Cookie: `__Host-kova_session=${cookie}`, "X-Kova-Owner": id } : {}),
      },
    });
  function browser(cookie = null) {
    const exports = {};
    vm.runInNewContext(browserSource, {
      exports,
      Response,
      URL,
      Error,
      TEST_ENV: { VITE_KOVA_AUTH_MODE: mode },
      fetch: async (path) => {
        assert.equal(path, "/api/auth/session");
        return h.handleKovaSession(
          new Request("https://kova.test/api/auth/session", {
            headers: cookie ? { Cookie: `__Host-kova_session=${cookie}` } : {},
          }),
        );
      },
    });
    return exports;
  }
  return { api, h, calls, request, browser };
}

test("paired hosted → dual → owned → dual rollback preserves UUID, provider links and owner-bound data", async () => {
  const db = await authDatabase();
  try {
    const at = new Date().toISOString();
    const until = new Date(Date.now() + 86400000).toISOString();
    // Nonsecret application FK fixtures, not substitutes for full product tables.
    await db.exec(`alter table auth.identities add column provider text, add column provider_id text;
      create table public.cutover_record_fixture(owner_id uuid primary key references auth.users(id), saved_value text);
      create table public.cutover_entitlement_fixture(owner_id uuid primary key references auth.users(id), plan text);`);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.invalid',$3),($2,'other@example.invalid',$3)",
      [owner, other, at],
    );
    await db.query(
      "insert into auth.identities(id,user_id,provider,provider_id) values(gen_random_uuid(),$1,'google','fixture-google-subject')",
      [owner],
    );
    await db.query(
      "insert into public.cutover_record_fixture values($1,'preserved draft'),($2,'other owner record')",
      [owner, other],
    );
    await db.query("insert into public.cutover_entitlement_fixture values($1,'pro'),($2,'free')", [
      owner,
      other,
    ]);
    const retained = async () =>
      (
        await db.query(`select
      (select jsonb_agg(to_jsonb(x) order by owner_id) from public.cutover_record_fixture x) records,
      (select jsonb_agg(to_jsonb(x) order by owner_id) from public.cutover_entitlement_fixture x) entitlements,
      (select jsonb_agg(to_jsonb(x) order by id) from auth.identities x) hosted_links`)
      ).rows;
    const before = await retained();
    const hosted = deployment(db, "supabase");
    assert.equal(hosted.browser().browserKovaAuthMode(), "supabase");
    assert.equal((await hosted.api.requireUser(hosted.request())).userId, owner);

    const adopted = (
      await db.query(
        "select * from public.kova_auth_finish_google($1,'fixture-google-subject','owner@example.invalid',true,'Owner',$2,$3,$4)",
        [other, digest("handoff"), until, at],
      )
    ).rows[0];
    assert.equal(adopted.account_id, owner);
    assert.equal(adopted.candidate_used, false);
    await db.query("select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)", [
      digest("handoff"),
      digest(token),
      until,
      digest("unused-challenge"),
      until,
      at,
    ]);
    for (const mode of ["dual", "kova", "dual"]) {
      const d = deployment(db, mode);
      const browser = d.browser(token);
      assert.equal(browser.browserKovaAuthMode(), mode);
      const principal = await browser.resolveKovaSessionAuthority();
      const caller = await d.api.requireUser(d.request({ cookie: token }));
      assert.equal(principal.accountId, owner);
      assert.equal(caller.userId, principal.accountId);
      assert.equal(caller.authProvider, "kova");
      assert.equal(await caller.revalidateSession(), true);
      assert.deepEqual(await retained(), before);
      assert.equal(
        await scalar(
          db,
          "select provider_subject from kova_private.auth_identities where account_id=$1 and provider='google'",
          [owner],
        ),
        "fixture-google-subject",
      );
      const otherCaller = await d.api.requireUser(d.request({ id: other }));
      if (mode === "dual") assert.equal(otherCaller.userId, other);
      else assert.equal(otherCaller.status, 401);
    }
    const rollback = deployment(db, "dual");
    await rollback.h.store.revokeSession(digest(token));
    const denied = await rollback.api.requireUser(rollback.request({ cookie: token }));
    assert.equal(denied.status, 401);
    assert.ok(
      !rollback.calls.includes("hosted-user"),
      "revoked owned cookie cannot reveal dormant hosted authority",
    );
    await assert.rejects(
      rollback.browser(token).resolveKovaSessionAuthority(),
      /kova_session_rejected/,
    );
    assert.deepEqual(await retained(), before);
  } finally {
    await db.close();
  }
});

test("dual rollback retains database retirement and fails closed if its check is unavailable", async () => {
  const db = await authDatabase();
  try {
    await livePasswordAccount(db, { token });
    assert.equal(
      await scalar(db, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
      false,
    );
    for (const mode of ["dual", "kova", "dual"]) {
      const d = deployment(db, mode);
      const response = await d.api.requireUser(d.request());
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const failed = deployment(db, "dual", { retirementFailure: true });
    const response = await failed.api.requireUser(failed.request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private transport fixture/);
    assert.equal(
      await scalar(
        db,
        "select count(*)::int from kova_private.auth_legacy_retirements where account_id=$1",
        [owner],
      ),
      1,
    );
  } finally {
    await db.close();
  }
});

test("plain supabase reversion is explicitly NOT a safe post-retirement rollback", async () => {
  const db = await authDatabase();
  try {
    await livePasswordAccount(db, { token });
    const d = deployment(db, "supabase");
    const caller = await d.api.requireUser(d.request());
    // A signed hosted JWT accepted by hosted Auth still reaches API admission.
    // This is a reproduced unsafe configuration, NOT a security acceptance pass.
    assert.equal(caller.authProvider, "supabase");
    assert.ok(!d.calls.includes("kova_auth_legacy_session_allowed"));
    assert.equal(
      await scalar(db, "select public.kova_auth_legacy_session_allowed($1)", [owner]),
      false,
    );
  } finally {
    await db.close();
  }
});
