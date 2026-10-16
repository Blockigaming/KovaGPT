import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import test, { before, after } from "node:test";
import { authDatabase, livePasswordAccount } from "../helpers/kova-auth-database.mjs";
import { authHttp, authRequest, postgresTransport } from "../helpers/kova-auth-http.mjs";
import {
  signKovaCompatibilityJwt,
  generateKovaToken,
} from "../../src/lib/kova-auth-crypto.server.mjs";
import {
  coreLifecyclePrelude,
  privateHelperUsage,
  orderedCoreDependencies,
} from "../../scripts/azure/core-launch-dependencies.mjs";

// Real canonical SQL and HTTP/store/crypto. Only platform schemas, mail delivery,
// rate-limit transport and PostgREST transport are local test seams. No family
// table/RPC, production access, hosted Auth call or recovery volume is available.
const platform = `
  create schema kova_private;
  create schema storage;
  grant usage on schema auth,storage to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key,owner_id uuid,value text);
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to authenticated;
  create policy own_storage on storage.objects for all to authenticated
    using(owner_id=auth.uid()) with check(owner_id=auth.uid());
  create table public.core_owner_fixture(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
  alter table public.core_owner_fixture enable row level security;
  grant select,insert,update,delete on public.core_owner_fixture to authenticated;
  create policy own_row on public.core_owner_fixture for all to authenticated
    using(user_id=auth.uid()) with check(user_id=auth.uid());
  alter role service_role bypassrls;
`;
const migrationSql = (name) => readFile(`supabase/migrations/${name}`, "utf8");
let db, http, principal, cookie, claims, other;
const applied = [...coreLifecyclePrelude];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const scalarRpcs = new Set([
  "kova_auth_create_compatibility_principal",
  "kova_auth_delete_unused_compatibility_principal",
  "kova_auth_revoke_session",
  "kova_auth_finalize_account_deletion",
  "prepare_org_account_deletion",
  "read_account_deletion_state",
]);
const rpcNames = [
  ...scalarRpcs,
  "kova_auth_create_password_account",
  "kova_auth_consume_verification",
  "kova_auth_password_lookup",
  "kova_auth_create_session",
  "kova_auth_resolve_session",
];
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signing = {
  KOVA_AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  KOVA_AUTH_JWT_KEY_ID: "local-core-candidate",
  KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex"),
  KOVA_AUTH_ISSUER: "https://auth.example.invalid/",
};
before(async () => {
  let usageApplied = false;
  db = await authDatabase({
    beforeMigrations:
      platform + (await Promise.all(coreLifecyclePrelude.map(migrationSql))).join("\n"),
    beforeMigration: async (name, connection) => {
      if (!usageApplied && name > privateHelperUsage) {
        await connection.exec(await migrationSql(privateHelperUsage));
        applied.push(privateHelperUsage);
        usageApplied = true;
      }
      applied.push(name);
    },
  });
  http = authHttp({
    env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", KOVA_EMAIL_QUEUE_ENABLED: "true" },
    crypto: { signKovaCompatibilityJwt: (value) => signKovaCompatibilityJwt(value, signing) },
    rpc: async (name, args) => {
      const result = await db.transaction(async (tx) => {
        // Match application service-role execution, not a privileged test owner.
        await tx.exec("set local role service_role");
        return postgresTransport(tx, rpcNames)(name, args);
      });
      return scalarRpcs.has(name) && result.data
        ? { data: Object.values(result.data[0])[0] }
        : result;
    },
  });
});
after(async () => {
  await db?.close();
});

test("canonical dependency order is complete for this isolated core slice; family objects are absent", async () => {
  assert.deepEqual(applied, orderedCoreDependencies(applied));
  assert.equal(new Set(applied).size, applied.length);
  for (const name of ["family_groups", "family_members", "family_invites"])
    assert.equal(await scalar("select to_regclass($1)", [`public.${name}`]), null);
  for (const signature of [
    "public.create_or_repair_family_group(uuid,text)",
    "public.accept_family_invite_atomic(uuid,text)",
  ])
    assert.equal(await scalar("select to_regprocedure($1)", [signature]), null);
  assert.equal(
    await scalar("select has_schema_privilege('authenticated','kova_private','usage')"),
    true,
  );
  assert.equal(
    await scalar(
      "select has_table_privilege('authenticated','kova_private.auth_sessions','select')",
    ),
    false,
  );
});

test("actual signup → safe mail GET → explicit verification → password login works without family or hosted Auth", async () => {
  const body = {
    email: "core-fixture@example.invalid",
    password: "Synthetic-Only-Passphrase-2026",
    displayName: "Fixture",
  };
  assert.equal(
    (await http.handleKovaSignup(authRequest(body, { path: "/api/auth/signup" }))).status,
    202,
  );
  const mail = await scalar("select payload from public.test_email_queue order by id desc limit 1");
  const link = new URL(
    mail.text.match(/https:\/\/kova\.test\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/u)[0],
  );
  assert.equal((await http.handleKovaVerification(new Request(link))).status, 200);
  assert.equal(
    await scalar(
      "select email_verified_at is null from kova_private.auth_accounts where primary_email=$1",
      [body.email],
    ),
    true,
  );
  const confirmation = await http.handleKovaVerification(
    new Request("https://kova.test/api/auth/verify", {
      method: "POST",
      headers: { Origin: "https://kova.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: link.searchParams.get("token") }),
    }),
  );
  assert.equal(confirmation.status, 303);
  assert.equal(confirmation.headers.has("set-cookie"), false);
  assert.equal(
    (await http.handleKovaLogin(authRequest({ ...body, password: "Wrong-Synthetic-Value" })))
      .status,
    401,
  );
  const login = await http.handleKovaLogin(authRequest(body, { path: "/api/auth/login" }));
  assert.equal(login.status, 200);
  const header = login.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    assert.equal(header.includes(flag), true);
  cookie = header.match(/__Host-kova_session=([^;]+)/u)[1];
  principal = await http.resolveKovaRequestPrincipal(
    authRequest(undefined, { method: "GET", token: cookie }),
  );
  assert.equal(Boolean(principal?.accountId && principal?.sessionId), true);
  const tokenReply = await http.handleKovaToken(
    authRequest(undefined, { method: "GET", token: cookie }),
  );
  assert.equal(tokenReply.status, 200);
  const jwt = (await tokenReply.json()).accessToken;
  const [head, payload, signature] = jwt.split(".");
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${head}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.sub, principal.accountId);
  assert.equal(claims.session_id, principal.sessionId);
  assert.equal(await scalar("select count(*)::int from auth.sessions"), 0);
  assert.equal(http.logs.length, 0);
  assert.equal(
    http.calls.some(([name]) => name.includes("family")),
    false,
  );
});

async function asOwner(sql, args = []) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claims',$1,true),set_config('storage.operation','storage.object.list',true)",
      [JSON.stringify(claims)],
    );
    await tx.exec("set local role authenticated");
    return tx.query(sql, args);
  });
}

test("actual signed owner claims enforce cross-account RLS, captured-owner binding and private ACLs", async () => {
  other = await livePasswordAccount(db, { id: randomUUID(), token: generateKovaToken() });
  await db.query("insert into public.core_owner_fixture values($1,$2),($3,$4)", [
    randomUUID(),
    principal.accountId,
    randomUUID(),
    other.account_id,
  ]);
  assert.deepEqual((await asOwner("select user_id from public.core_owner_fixture")).rows, [
    { user_id: principal.accountId },
  ]);
  await assert.rejects(
    asOwner("insert into public.core_owner_fixture values($1,$2)", [
      randomUUID(),
      other.account_id,
    ]),
    /row-level security/u,
  );
  await assert.rejects(
    asOwner("select * from kova_private.auth_credentials"),
    /permission denied/u,
  );
  assert.equal(
    (
      await http.handleKovaToken(
        authRequest(undefined, {
          method: "GET",
          token: cookie,
          headers: { "X-Kova-Owner": other.account_id },
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','public.kova_auth_finalize_account_deletion(uuid,uuid)','execute')",
    ),
    false,
  );
});

test("organization ownership cannot be bypassed; transaction failure leaves no deletion fence", async () => {
  const org = randomUUID();
  await db.query(
    "insert into public.organizations(id,name,created_by,policy_version) values($1,'Fixture',$2,'local-fixture-v1')",
    [org, other.account_id],
  );
  await db.query(
    "insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",
    [org, other.account_id],
  );
  await assert.rejects(
    db.query("select public.prepare_org_account_deletion($1)", [other.account_id]),
    /organization_ownership_transfer_required/u,
  );
  assert.equal(
    await scalar("select count(*)::int from public.account_deletion_fences where user_id=$1", [
      other.account_id,
    ]),
    0,
  );
  const rollback = new Error("local_admission_rollback");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query("select public.prepare_org_account_deletion($1)", [principal.accountId]);
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.equal(
    await scalar("select count(*)::int from public.account_deletion_fences where user_id=$1", [
      principal.accountId,
    ]),
    0,
  );
});

test("real service wrapper → irreversible fence → export cancellation → exact-session finalizer preserves other owner", async () => {
  const org = http.loadModule(
    "@/lib/organization-account-deletion.server",
    "src/lib/organization-account-deletion.server.ts",
  );
  await org.prepareOrganizationAccountDeletion(
    {
      rpc: async (name, args) => {
        const reply = await db.transaction(async (tx) => {
          await tx.exec("set local role service_role");
          return postgresTransport(tx, ["prepare_org_account_deletion"])(name, args);
        });
        return reply.data ? { data: Object.values(reply.data[0])[0] } : reply;
      },
    },
    principal.accountId,
  );
  assert.equal(
    await scalar("select public.cancel_account_export_account_deletion($1)", [principal.accountId]),
    false,
  );
  await assert.rejects(
    db.query("insert into public.account_export_jobs(user_id) values($1)", [principal.accountId]),
    /account_deletion_pending/u,
  );
  await db.query("select public.begin_account_export_account_deletion($1)", [principal.accountId]);
  await assert.rejects(
    http.store.finalizeOwnedAccountDeletion(principal.accountId, other.session_id),
  );
  // A late failure must roll back identity and credential cascades, not clear the fence.
  await db.exec(`create function public.core_refuse_final_delete() returns trigger language plpgsql as $$begin raise exception 'core_local_delete_failure'; end$$;
    create trigger core_refuse_final_delete before delete on auth.users for each row execute function public.core_refuse_final_delete()`);
  await assert.rejects(
    http.store.finalizeOwnedAccountDeletion(principal.accountId, principal.sessionId),
  );
  assert.equal(
    await scalar("select count(*)::int from kova_private.auth_accounts where id=$1", [
      principal.accountId,
    ]),
    1,
  );
  assert.equal(
    await scalar("select count(*)::int from public.account_deletion_fences where user_id=$1", [
      principal.accountId,
    ]),
    1,
  );
  await db.exec(
    "drop trigger core_refuse_final_delete on auth.users; drop function public.core_refuse_final_delete()",
  );
  await http.store.finalizeOwnedAccountDeletion(principal.accountId, principal.sessionId);
  assert.equal(
    await scalar("select public.read_account_deletion_state($1)->>'state'", [principal.accountId]),
    "deleted",
  );
  assert.equal(
    await scalar("select count(*)::int from kova_private.auth_accounts where id=$1", [
      other.account_id,
    ]),
    1,
  );
  assert.equal((await asOwner("select * from public.core_owner_fixture")).rows.length, 0);
  assert.equal(
    (await http.handleKovaSession(authRequest(undefined, { method: "GET", token: cookie }))).status,
    401,
  );
});

test("actual logout revokes still-unexpired owned compatibility authority", async () => {
  const reply = await http.handleKovaLogout(
    authRequest({}, { path: "/api/auth/logout", token: other.token }),
  );
  assert.equal(reply.status, 204);
  assert.equal(await http.store.resolveSession(other.digest), null);
});
