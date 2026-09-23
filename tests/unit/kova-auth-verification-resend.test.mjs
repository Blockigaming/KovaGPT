import assert from "node:assert/strict";
import test from "node:test";
import { authDatabase, digest, now, owner, other } from "../helpers/kova-auth-database.mjs";
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
const hour = "2026-09-21T13:00:00Z";
const later = "2026-09-21T12:01:01Z";
const email = "pending@example.invalid";
const hash = `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`;
async function pending(db) {
  await db.query("insert into auth.users(id,email) values($1,$2)", [owner, email]);
  await db.query(
    "select * from public.kova_auth_create_password_account($1,$2,'Pending',$3,$4,$5,'{}',$6)",
    [owner, email, hash, digest("original"), hour, now],
  );
}
const resend = (db, token = "replacement", at = later, target = email) =>
  db.query(
    "select public.kova_auth_resend_verification($1,$2,$3,jsonb_build_object('to',$1::text,'label','kova-auth-verification','purpose','auth'),$4) queued",
    [target, digest(token), hour, at],
  );
const snapshot = async (db) =>
  (
    await db.query(`select
 (select jsonb_agg(to_jsonb(c)) from kova_private.auth_credentials c) credentials,
 (select jsonb_agg(to_jsonb(v)) from kova_private.auth_email_verifications v) verifications,
 (select jsonb_agg(to_jsonb(q)) from public.test_email_queue q) emails`)
  ).rows;
test("resend and repeat signup preserve the original password and rotate only mailbox proof after the cooldown", async () => {
  const db = await authDatabase();
  try {
    await pending(db);
    const original = (await snapshot(db))[0].credentials;
    assert.equal((await resend(db, "too-soon", now)).rows[0].queued, false);
    assert.equal((await resend(db)).rows[0].queued, true);
    assert.deepEqual((await snapshot(db))[0].credentials, original);
    assert.equal((await resend(db, "immediate", later)).rows[0].queued, false);
    await assert.rejects(
      db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
        digest("original"),
        digest("bad-session"),
        hour,
        later,
      ]),
    );
    // An unauthenticated retry carrying a different password can only resend.
    const retry = (
      await db.query(
        "select * from public.kova_auth_create_password_account($1,$2,'Changed',$3,$4,$5,jsonb_build_object('to',$2::text,'label','kova-auth-verification','purpose','auth'),$6)",
        [other, email, hash.replaceAll("b", "c"), digest("retry"), hour, "2026-09-21T12:02:02Z"],
      )
    ).rows[0];
    assert.equal(retry.account_id, owner);
    assert.equal(retry.verification_created, true);
    assert.deepEqual((await snapshot(db))[0].credentials, original);
    const result = (
      await db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
        digest("retry"),
        digest("good-session"),
        hour,
        "2026-09-21T12:02:02Z",
      ])
    ).rows[0];
    assert.equal(result.account_id, owner);
    assert.equal(
      (
        await db.query(
          "select secret_hash from kova_private.auth_credentials where account_id=$1",
          [owner],
        )
      ).rows[0].secret_hash,
      hash,
    );
    assert.equal((await resend(db, "verified", "2026-09-21T12:03:03Z")).rows[0].queued, false);
  } finally {
    await db.close();
  }
});
test("lost/expired verification is recoverable and a mail queue failure rolls back replacement atomically", async () => {
  const db = await authDatabase();
  try {
    await pending(db);
    await db.exec(
      "update kova_private.auth_email_verifications set expires_at='2026-09-21T12:00:30Z'",
    );
    const before = await snapshot(db);
    await db.exec(
      "create or replace function public.enqueue_email(queue_name text,payload jsonb) returns bigint language plpgsql as $$begin raise exception 'fixture queue unavailable';end$$",
    );
    await assert.rejects(resend(db));
    assert.deepEqual(await snapshot(db), before);
    await db.exec(
      "create or replace function public.enqueue_email(queue_name text,payload jsonb) returns bigint language sql as $$insert into public.test_email_queue(queue_name,payload) values(queue_name,payload) returning id$$",
    );
    assert.equal((await resend(db)).rows[0].queued, true);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_email_verifications where consumed_at is null",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("resend is service-only, does not enumerate missing accounts, and denies changed account or credential state", async (t) => {
  const db = await authDatabase();
  try {
    await pending(db);
    assert.equal(
      (await resend(db, "unknown", later, "absent@example.invalid")).rows[0].queued,
      false,
    );
    for (const [label, sql] of [
      ["suspended", "update kova_private.auth_accounts set suspended_until='infinity'"],
      ["deleted", "update kova_private.auth_accounts set deleted_at=now()"],
      ["disabled identity", "update kova_private.auth_identities set disabled_at=now()"],
      ["disabled credential", "update kova_private.auth_credentials set disabled_at=now()"],
      ["legacy ban", "update auth.users set banned_until='infinity'"],
      [
        "legacy MFA",
        "insert into auth.mfa_factors values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','verified')",
      ],
    ])
      await t.test(label, async () => {
        await db.exec("begin");
        try {
          await db.exec(sql);
          assert.equal((await resend(db)).rows[0].queued, false);
        } finally {
          await db.exec("rollback");
        }
      });
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(resend(db));
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await resend(db)).rows[0].queued, true);
  } finally {
    await db.close();
  }
});
test("resend HTTP returns the same accepted response for missing and pending addresses and rejects forged scope before DB access", async (t) => {
  for (const queued of [false, true]) {
    const f = authHttp({
      env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", KOVA_EMAIL_QUEUE_ENABLED: "true" },
      rpc: async (name, args) => {
        assert.equal(name, "kova_auth_resend_verification");
        assert.equal(args.p_email, email);
        assert.match(args.p_verification_digest_hex, /^[a-f0-9]{64}$/);
        return { data: queued, error: null };
      },
    });
    const r = await f.handleKovaVerificationResend(
      authRequest({ email }, { path: "/api/auth/verify/resend" }),
    );
    assert.equal(r.status, 202);
    assert.deepEqual(await r.json(), {
      accepted: true,
      message: "If verification is available for this address, check your inbox.",
    });
    assert.equal(f.calls.length, 1);
  }
  for (const [name, body, options, status] of [
    ["cross-origin", { email }, { headers: { origin: "https://evil.kova.test" } }, 403],
    ["GET", undefined, { method: "GET" }, 405],
    ["caller-selected account", { email, accountId: owner }, {}, 400],
    ["caller-selected password", { email, password: hash }, {}, 400],
    ["caller-selected token", { email, token: "fake" }, {}, 400],
  ])
    await t.test(name, async () => {
      const f = authHttp();
      const r = await f.handleKovaVerificationResend(
        authRequest(body, { path: "/api/auth/verify/resend", ...options }),
      );
      assert.equal(r.status, status);
      assert.equal(f.calls.length, 0);
    });
});

test("resend upgrades the existing staging parameter contract and preserves recipient binding and the four-per-hour database cap", async () => {
  const db = await authDatabase({
    beforeMigration: async (name, target) => {
      if (name.endsWith("_kova_owned_verification_resend_review.sql")) {
        // An earlier separately installed staging revision has this exact ABI.
        // No remotely returned SQL is executed as test source.
        await target.exec(`create function public.kova_auth_resend_verification(
        p_email text,p_verification_digest_hex text,p_expires_at timestamptz,
        p_email_payload jsonb,p_now timestamptz default now()) returns boolean
        language sql as $$select false$$`);
      }
    },
  });
  try {
    await pending(db);
    const before = await snapshot(db);
    await assert.rejects(
      db.query(
        'select public.kova_auth_resend_verification($1,$2,$3,\'{"to":"other@example.invalid","purpose":"auth","label":"kova-auth-verification"}\',$4)',
        [email, digest("wrong-target"), hour, later],
      ),
    );
    assert.deepEqual(await snapshot(db), before);
    for (const [index, at] of [later, "2026-09-21T12:02:02Z", "2026-09-21T12:03:03Z"].entries()) {
      assert.equal((await resend(db, `bounded-${index}`, at)).rows[0].queued, true);
    }
    assert.equal((await resend(db, "beyond-limit", "2026-09-21T12:04:04Z")).rows[0].queued, false);
    assert.equal(
      (await db.query("select count(*)::int n from public.test_email_queue")).rows[0].n,
      4,
    );
    const args = (
      await db.query(
        "select proargnames from pg_proc where oid='public.kova_auth_resend_verification(text,text,timestamptz,jsonb,timestamptz)'::regprocedure",
      )
    ).rows[0].proargnames;
    assert.equal(args[2], "p_expires_at");
  } finally {
    await db.close();
  }
});
