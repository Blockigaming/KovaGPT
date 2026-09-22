import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import {
  authDatabase,
  passwordAccount,
  enableMfa,
  codeDigests,
  digest,
} from "../helpers/kova-auth-database.mjs";
import { authHttp, authRequest, postgresTransport } from "../helpers/kova-auth-http.mjs";
import {
  signKovaCompatibilityJwt,
  generateKovaToken,
} from "../../src/lib/kova-auth-crypto.server.mjs";

const fixtures = `
  create schema storage;
  create schema realtime;
  grant usage on schema auth, storage, realtime to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
  $$;
  create table public.guard_fixture(id uuid primary key default gen_random_uuid(), owner_id uuid, value text);
  create table storage.objects(like public.guard_fixture including all);
  create table storage.buckets(like public.guard_fixture including all);
  create table storage.buckets_vectors(id int);
  alter table storage.buckets_vectors enable row level security;
  create table storage.s3_multipart_uploads(id int);
  alter table storage.s3_multipart_uploads enable row level security;
  create table realtime.messages(like public.guard_fixture including all);
  create table realtime.internal_fixture(id int);
  alter table realtime.internal_fixture enable row level security;
  create table public.integration_providers(id int);
  create table public.guard_rpc_effects(id int);
  create function public.guard_privileged_rpc() returns int language plpgsql security definer as $$
  begin insert into public.guard_rpc_effects values(1); return 1; end
  $$;
  do $$ declare target text; begin
    foreach target in array array['public.guard_fixture','storage.objects','storage.buckets','realtime.messages'] loop
      execute 'alter table ' || target || ' enable row level security';
      execute 'grant select, insert, update, delete on ' || target || ' to anon, authenticated';
      execute 'create policy owner_access on ' || target ||
        ' for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))';
    end loop;
  end $$;
`;
let db;
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signingEnv = {
  KOVA_AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  KOVA_AUTH_JWT_KEY_ID: "isolated-guard-test",
  KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex"),
  KOVA_AUTH_ISSUER: "https://auth.example.invalid/",
};
before(async () => {
  db = await authDatabase({ beforeMigrations: fixtures });
});
after(async () => {
  await db?.close();
});

const time = () => new Date().toISOString();
const expires = () => new Date(Date.now() + 3_600_000).toISOString();
function claimsFor(row, now = Date.now()) {
  const jwt = signKovaCompatibilityJwt(
    {
      accountId: row.account_id,
      sessionId: row.session_id,
      email: row.email,
      emailVerified: row.email_verified,
      assuranceLevel: row.assurance_level,
    },
    signingEnv,
    now,
  );
  return verifiedClaims(jwt);
}
function verifiedClaims(jwt) {
  const [header, payload, signature] = jwt.split(".");
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  return JSON.parse(Buffer.from(payload, "base64url"));
}
async function account() {
  const row = await passwordAccount(db, {
    id: randomUUID(),
    token: generateKovaToken(),
    at: time(),
    expiresAt: expires(),
  });
  return { ...row, claims: claimsFor(row) };
}
async function asCaller(claims, sql, params = [], role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [
      typeof claims === "string" ? claims : JSON.stringify(claims),
    ]);
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}
const active = async (claims) =>
  (await asCaller(claims, "select kova_auth_guard.session_is_active() as ok")).rows[0].ok;
const guardedRpc = (claims) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    await tx.exec("set local role authenticated");
    await tx.query("select kova_auth_guard.check_request()");
    return tx.query("select public.guard_privileged_rpc()");
  });

test("the real token HTTP/store path produces a signed, session-bound Kova marker", async () => {
  const owner = await account();
  const http = authHttp({
    rpc: postgresTransport(db, ["kova_auth_resolve_session"]),
    crypto: {
      signKovaCompatibilityJwt: (principal) => signKovaCompatibilityJwt(principal, signingEnv),
    },
  });
  const response = await http.handleKovaToken(
    authRequest(undefined, { path: "/api/auth/token", method: "GET", token: owner.token }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/u);
  const body = await response.json();
  const claims = verifiedClaims(body.accessToken);
  assert.equal(claims.kova_auth, 1);
  assert.equal(claims.session_id, owner.session_id);
  assert.equal(await active(claims), true);
  const [header, payload, signature] = body.accessToken.split(".");
  const stripped = JSON.parse(Buffer.from(payload, "base64url"));
  delete stripped.kova_auth;
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${Buffer.from(JSON.stringify(stripped)).toString("base64url")}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    false,
  );
  assert.deepEqual(http.logs, []);
});

for (const table of [
  "public.guard_fixture",
  "storage.objects",
  "storage.buckets",
  "realtime.messages",
]) {
  test(`${table}: owner RLS is preserved and a revoked JWT cannot read or write`, async () => {
    const owner = await account(),
      other = await account();
    const id = randomUUID();
    await asCaller(
      owner.claims,
      `insert into ${table}(id,owner_id,value) values($1,$2,'private')`,
      [id, owner.account_id],
    );
    assert.equal(
      (await asCaller(owner.claims, `select * from ${table} where id=$1`, [id])).rows.length,
      1,
    );
    assert.equal(
      (await asCaller(other.claims, `select * from ${table} where id=$1`, [id])).rows.length,
      0,
    );
    await assert.rejects(
      asCaller(other.claims, `insert into ${table}(owner_id) values($1)`, [owner.account_id]),
      /row-level security/u,
    );
    await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
    assert.equal(
      (await asCaller(owner.claims, `select * from ${table} where id=$1`, [id])).rows.length,
      0,
    );
    assert.equal(
      (
        await asCaller(
          owner.claims,
          `update ${table} set value='changed' where id=$1 returning id`,
          [id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await asCaller(owner.claims, `delete from ${table} where id=$1 returning id`, [id])).rows
        .length,
      0,
    );
    await assert.rejects(
      asCaller(owner.claims, `insert into ${table}(owner_id) values($1)`, [owner.account_id]),
      /row-level security/u,
    );
    assert.equal(
      (await db.query(`select value from ${table} where id=$1`, [id])).rows[0].value,
      "private",
    );
  });
}

test("pre-request denial prevents a SECURITY DEFINER RPC from executing", async () => {
  const owner = await account();
  const beforeCount = (await db.query("select count(*)::int as n from public.guard_rpc_effects"))
    .rows[0].n;
  await guardedRpc(owner.claims);
  await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
  await assert.rejects(
    guardedRpc(owner.claims),
    (e) => e.code === "PT401" && e.message === "Invalid or expired session.",
  );
  assert.equal(
    (await db.query("select count(*)::int as n from public.guard_rpc_effects")).rows[0].n,
    beforeCount + 1,
  );
});

test("ordinary cookie rotation rejects the previous JWT before its five-minute expiry", async () => {
  const owner = await account();
  const next = (
    await db.query("select * from public.kova_auth_rotate_session($1,$2,$3)", [
      owner.digest,
      digest(generateKovaToken()),
      expires(),
    ])
  ).rows[0];
  assert.ok(owner.claims.exp > Date.now() / 1000);
  assert.equal(await active(owner.claims), false);
  assert.equal(await active(claimsFor(next)), true);
});

test("sign out other devices invalidates sibling JWTs without invalidating the current device", async () => {
  const owner = await account();
  const sibling = (
    await db.query("select * from public.kova_auth_create_session($1,$2,$3,$4,'aal1',$5)", [
      owner.account_id,
      owner.credential.id,
      owner.credential.revision,
      digest(generateKovaToken()),
      expires(),
    ])
  ).rows[0];
  const siblingClaims = claimsFor(sibling);
  assert.equal(await active(siblingClaims), true);
  await db.query("select public.kova_auth_revoke_other_sessions($1)", [owner.digest]);
  assert.equal(await active(siblingClaims), false);
  assert.equal(await active(owner.claims), true);
});

test("MFA activation, recovery-code regeneration and MFA removal each invalidate old JWTs", async () => {
  const owner = await account();
  const mfa = await enableMfa(db, owner.token, generateKovaToken(), time(), expires());
  const mfaClaims = claimsFor(mfa);
  assert.equal(await active(owner.claims), false);
  assert.equal(await active(mfaClaims), true);
  const replacement = generateKovaToken();
  const regenerated = (
    await db.query("select * from public.kova_auth_regenerate_mfa_recovery_codes($1,$2,$3,$4)", [
      mfa.digest,
      codeDigests(randomUUID()),
      digest(replacement),
      expires(),
    ])
  ).rows[0];
  const regeneratedClaims = claimsFor(regenerated);
  assert.equal(await active(mfaClaims), false);
  assert.equal(await active(regeneratedClaims), true);
  const removed = (
    await db.query("select * from public.kova_auth_remove_totp_with_session($1,$2,$3,$4)", [
      digest(replacement),
      mfa.factorId,
      digest(generateKovaToken()),
      expires(),
    ])
  ).rows[0];
  assert.equal(await active(regeneratedClaims), false);
  assert.equal(await active(claimsFor(removed)), true);
});

test("password changes retire the previous JWT and preserve the rotated session", async () => {
  const owner = await account();
  const hash = `scrypt-v1$32768$8$1$${"c".repeat(22)}$${"d".repeat(43)}`;
  const next = (
    await db.query("select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6)", [
      owner.digest,
      owner.credential.id,
      owner.credential.revision,
      hash,
      digest(generateKovaToken()),
      expires(),
    ])
  ).rows[0];
  assert.equal(await active(owner.claims), false);
  assert.equal(await active(claimsFor(next)), true);
});

for (const [name, sql] of [
  [
    "suspension",
    "update kova_private.auth_accounts set suspended_until=now()+interval '1 hour' where id=$1",
  ],
  ["deletion", "update kova_private.auth_accounts set deleted_at=now() where id=$1"],
  ["unverified email", "update kova_private.auth_accounts set email_verified_at=null where id=$1"],
  [
    "changed email",
    "update kova_private.auth_accounts set primary_email='changed-'||id||'@example.invalid' where id=$1",
  ],
  [
    "epoch mismatch",
    "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
  ],
  ["new MFA requirement", "update kova_private.auth_accounts set mfa_required=true where id=$1"],
  [
    "legacy MFA requirement",
    "insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),$1,'verified')",
  ],
]) {
  test(`current account ${name} invalidates a still-unexpired Kova JWT`, async () => {
    const owner = await account();
    assert.equal(await active(owner.claims), true);
    await db.query(sql, [owner.account_id]);
    assert.equal(await active(owner.claims), false);
  });
}

test("session expiry, removal and subject/session mismatch fail without revealing why", async () => {
  const owner = await account(),
    other = await account();
  assert.equal(await active({ ...owner.claims, sub: other.account_id }), false);
  await db.query(
    "update kova_private.auth_sessions set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",
    [owner.session_id],
  );
  assert.equal(await active(owner.claims), false);
  await db.query("delete from kova_private.auth_sessions where id=$1", [owner.session_id]);
  assert.equal(await active(owner.claims), false);
  await assert.rejects(
    guardedRpc(owner.claims),
    (e) => e.code === "PT401" && e.message === "Invalid or expired session.",
  );
});

test("malformed and incomplete Kova claims fail closed, including null/unknown marker versions", async () => {
  const owner = await account();
  const claims = owner.claims;
  const cases = [
    "{",
    "null",
    "[]",
    "1",
    "x".repeat(16385),
    ...[null, false, 0, 2, "1", {}].map((kova_auth) => ({ ...claims, kova_auth })),
    ...["sub", "session_id", "role", "aud", "email_verified", "email", "aal", "iat", "exp"].map(
      (key) => {
        const c = { ...claims };
        delete c[key];
        return c;
      },
    ),
    { ...claims, session_id: "not-a-uuid" },
    { ...claims, role: "service_role" },
    { ...claims, aal: "aal2" },
    { ...claims, email_verified: "true" },
    { ...claims, exp: claims.iat + 301 },
    { ...claims, exp: claims.iat - 1 },
    { ...claims, iat: claims.iat + 30 },
    { ...claims, iat: "123" },
    { ...claims, exp: 1e200 },
  ];
  for (const value of cases)
    assert.equal(await active(value), false, JSON.stringify(value).slice(0, 80));
});

test("unmarked hosted/anonymous/service claims retain existing authority and RLS rules", async () => {
  const owner = await account();
  for (const claims of [
    { role: "anon" },
    { role: "service_role" },
    { role: "authenticated", sub: owner.account_id },
    {
      role: "authenticated",
      sub: owner.account_id,
      user_metadata: { kova_auth: 1, session_id: randomUUID() },
    },
  ]) {
    assert.equal(await active(claims), true);
  }
  assert.equal(
    (await asCaller({ role: "anon" }, "select * from public.guard_fixture", [], "anon")).rows
      .length,
    0,
  );
});

test("guard privileges expose no private auth data or caller-supplied account checks", async () => {
  const rows = (
    await db.query(`select p.proname,p.pronargs,p.prosecdef,p.proconfig,
    has_function_privilege('authenticated',p.oid,'execute') as caller_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0) as public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kova_auth_guard' order by p.proname`)
  ).rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.pronargs, 0);
    assert.equal(row.caller_execute, true);
    assert.equal(row.public_execute, false);
    assert.deepEqual(row.proconfig, ['search_path=""']);
    assert.equal(row.prosecdef, row.proname === "session_is_active");
  }
  const permissions = (
    await db.query(`select has_schema_privilege('authenticated','kova_private','usage') as schema_access,
    has_table_privilege('authenticated','kova_private.auth_sessions','select') as table_access,
    has_function_privilege('authenticated','public.kova_auth_resolve_session(text,timestamptz)','execute') as rpc_access`)
  ).rows[0];
  assert.deepEqual(permissions, { schema_access: false, table_access: false, rpc_access: false });
  await assert.rejects(
    asCaller({}, "select * from kova_private.auth_sessions"),
    /permission denied/u,
  );
});

test("all scoped RLS policies are restrictive and unrelated/no-RLS/private tables stay unchanged", async () => {
  const policies = (
    await db.query(`select n.nspname,c.relname,p.polpermissive,p.polcmd,p.polwithcheck is not null as has_check,
    pg_get_expr(p.polqual,p.polrelid) as expression from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace where p.polname='kova_owned_session_guard' order by n.nspname`)
  ).rows;
  assert.equal(policies.length, 4);
  for (const p of policies) {
    assert.equal(p.polpermissive, false);
    assert.equal(p.polcmd, "*");
    assert.equal(p.has_check, true);
  }
  const unchanged = (
    await db.query(`select
    (select relrowsecurity from pg_class where oid='public.integration_providers'::regclass) as unrelated_rls,
    (select count(*)::int from pg_policy where polrelid='realtime.internal_fixture'::regclass) as realtime_internal_policies,
    (select count(*)::int from pg_policy where polrelid in ('storage.buckets_vectors'::regclass,'storage.s3_multipart_uploads'::regclass)) as storage_internal_policies,
    (select count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='kova_private') as private_policies`)
  ).rows[0];
  assert.deepEqual(unchanged, {
    unrelated_rls: false,
    realtime_internal_policies: 0,
    storage_internal_policies: 0,
    private_policies: 0,
  });
  const hook = (
    await db.query(`select setting from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting where r.rolname='authenticator'
    and s.setdatabase=(select oid from pg_database where datname=current_database())
    and setting like 'pgrst.db_pre_request=%'`)
  ).rows;
  assert.deepEqual(hook, [{ setting: "pgrst.db_pre_request=kova_auth_guard.check_request" }]);
});

test("migration refuses to overwrite an unrelated existing PostgREST request hook", async () => {
  await assert.rejects(
    authDatabase({
      beforeMigrations:
        "alter role authenticator set pgrst.db_pre_request = 'public.existing_guard'",
    }),
    /kova_auth_existing_request_guard/u,
  );
});

test("the aggregate release proof rejects later unguarded tables and weakened policy expressions", async () => {
  const sql = await readFile(
    new URL("../../scripts/release/kova-auth-revocation-proof.sql", import.meta.url),
    "utf8",
  );
  const proof = async () => (await db.query(sql)).rows[0];
  const original = await proof();
  assert.equal(Number(original.scoped_rls_tables), 4);
  for (const [name, value] of Object.entries(original)) {
    if (name !== "scoped_rls_tables") assert.equal(Number(value), 0, name);
  }
  try {
    await db.exec(
      "create table public.new_unguarded_fixture(id int); alter table public.new_unguarded_fixture enable row level security",
    );
    assert.equal(Number((await proof()).unguarded_rls_tables), 1);
    await db.exec(
      `alter policy kova_owned_session_guard on public.guard_fixture using (kova_auth_guard.session_is_active() or true)`,
    );
    assert.equal(Number((await proof()).unguarded_rls_tables), 2);
  } finally {
    await db.exec(
      "drop table public.new_unguarded_fixture; alter policy kova_owned_session_guard on public.guard_fixture using ((select kova_auth_guard.session_is_active()))",
    );
  }
  assert.deepEqual(await proof(), original);
  const rollback = new Error("rollback deliberate guard tampering");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec(`create or replace function kova_auth_guard.session_is_active() returns boolean
      language plpgsql stable security definer set search_path='' as $$ begin return true; end $$`);
      assert.equal(Number((await tx.query(sql)).rows[0].invalid_guard_functions), 1);
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.deepEqual(await proof(), original);
});
