import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const owner = id(1),
  other = id(2),
  key = id(3),
  limits = { request: 10, daily: 100, monthly: 1000, concurrent: 2 };
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
      create table auth.users(id uuid primary key);create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id)$$;
      revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
      create table account_deletion_fences(user_id uuid);create table banned_users(user_id uuid);create table user_preferences(user_id uuid,settings jsonb);grant select on account_deletion_fences,banned_users,user_preferences to service_role;
      insert into auth.users values('${owner}'),('${other}');`);
    for (const name of [
      "20260803143000_developer_api_profit_protection.sql",
      "20260905004111_developer_billing_runtime.sql",
      "20260905005610_developer_platform_identity.sql",
      "20260905011420_developer_owner_export.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec("set role service_role");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function manage(db, operation, input, user = owner) {
  return (
    await db.query("select manage_developer_workspace($1,$2,$3) result", [user, operation, input])
  ).rows[0].result;
}
async function account(db) {
  return manage(db, "create_account", { name: "API workspace", currency: "USD" });
}
function keyInput(a, extra = {}) {
  return {
    accountId: a.accountId,
    projectId: a.projectId,
    keyId: key,
    name: "Server",
    digest: "a".repeat(64),
    suffix: "abc123",
    scopes: ["chat"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    limits,
    ...extra,
  };
}
test("workspace creation has no funds and key creation stores only digest with bounded scopes", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    assert.equal(
      (await db.query("select available_amount::float8 balance from developer_credit_accounts"))
        .rows[0].balance,
      0,
    );
    assert.equal(
      (await db.query("select secret_digest,credential_owner from developer_billing_keys")).rows[0]
        .credential_owner,
      owner,
    );
    assert.equal(
      (await db.query("select has_table_privilege('service_role','auth.users','select') ok"))
        .rows[0].ok,
      false,
    );
    for (const patch of [
      { projectId: id(8) },
      { scopes: ["admin"] },
      { digest: "plaintext" },
      { expiresAt: new Date(Date.now() + 100 * 86400000).toISOString() },
    ])
      await assert.rejects(
        manage(db, "issue_key", keyInput(a, { ...patch, keyId: crypto.randomUUID() })),
        /key_invalid/,
      );
  } finally {
    await db.close();
  }
});
test("foreign account mutation and missing ownership fail without creating or revoking credentials", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    await assert.rejects(
      manage(db, "revoke_key", { accountId: a.accountId, keyId: key }, other),
      /owner_required/,
    );
    await assert.rejects(
      manage(db, "issue_key", keyInput(a, { keyId: id(9) }), other),
      /owner_required/,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      manage(db, "create_account", { name: "bad", currency: "USD" }),
      /permission denied/,
    );
    await assert.rejects(db.query("select * from developer_billing_keys"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("rotation is atomic, revocation is idempotent and malformed limits roll back a new key", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    await assert.rejects(
      manage(
        db,
        "issue_key",
        keyInput(a, { keyId: id(5), rotateKeyId: key, limits: { ...limits, request: -1 } }),
      ),
      /limits_invalid/,
    );
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      true,
    );
    await manage(db, "issue_key", keyInput(a, { keyId: id(5), rotateKeyId: key }));
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      false,
    );
    assert.equal(
      (await manage(db, "revoke_key", { accountId: a.accountId, keyId: id(5) })).revoked,
      true,
    );
    assert.equal(
      (await manage(db, "revoke_key", { accountId: a.accountId, keyId: id(5) })).revoked,
      true,
    );
  } finally {
    await db.close();
  }
});
test("scope budgets update only owned organization, project or key and deletion fences block edits", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    for (const [scope, scopeId] of [
      ["organization", null],
      ["project", a.projectId],
      ["key", key],
    ])
      await manage(db, "set_limits", { accountId: a.accountId, scope, scopeId, limits });
    assert.equal(
      (await db.query("select count(*)::int n from developer_billing_limits")).rows[0].n,
      3,
    );
    await assert.rejects(
      manage(db, "set_limits", { accountId: a.accountId, scope: "key", scopeId: id(9), limits }),
      /scope_invalid/,
    );
    await db.exec("reset role");
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await db.exec("set role service_role");
    await assert.rejects(
      manage(db, "revoke_key", { accountId: a.accountId, keyId: key }),
      /owner_unavailable/,
    );
  } finally {
    await db.close();
  }
});
test("owner deletion cascades credential hashes while preserving financial account balances", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (await db.query("select count(*)::int n from developer_billing_keys")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from developer_credit_accounts")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("the last dispatch check honors owner deletion fences and current scopes after paid admission", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    for (const [scope, scopeId] of [
      ["organization", null],
      ["project", a.projectId],
    ])
      await manage(db, "set_limits", { accountId: a.accountId, scope, scopeId, limits });
    const version = id(9);
    await db.query("update developer_credit_accounts set available_amount=100 where id=$1", [
      a.accountId,
    ]);
    await db.query(
      "insert into api_pricing_versions(id,version,currency,minimum_request_charge,rounding_increment,allowance_configuration,public_price_configuration,status,approved_by,approved_at,effective_at,expires_at) values($1,1,'USD',1,.001,'{}','{}','approved',$2,now(),now()-interval '1 hour',now()+interval '1 day')",
      [version, owner],
    );
    const q = {
      pricingVersionId: version,
      currency: "USD",
      customerCharge: 5,
      maximumReservedCharge: 5,
      promotionalSubsidy: 0,
      estimatedUpstreamCost: 1,
      riskBufferAmount: 0,
      roundingDifference: 0,
      upstreamBreakdown: { input_tokens: 1 },
    };
    const r = (
      await db.query(
        "select admit_developer_billing($1,'a',$2,'azure_openai','luna','chat',$3,$4,'{}') result",
        [key, "a".repeat(64), version, q],
      )
    ).rows[0].result;
    await db.exec("reset role");
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await db.exec("set role service_role");
    assert.equal(
      (await db.query("select dispatch_developer_billing($1,$2) ok", [r.request_id, r.lease_token]))
        .rows[0].ok,
      false,
    );
    await db.exec("reset role;delete from account_deletion_fences;set role service_role");
    await db.query(
      "update developer_billing_keys set capabilities=array['embeddings'] where id=$1",
      [key],
    );
    assert.equal(
      (await db.query("select dispatch_developer_billing($1,$2) ok", [r.request_id, r.lease_token]))
        .rows[0].ok,
      false,
    );
    await db.query("update developer_billing_keys set capabilities=array['chat'] where id=$1", [
      key,
    ]);
    assert.equal(
      (await db.query("select dispatch_developer_billing($1,$2) ok", [r.request_id, r.lease_token]))
        .rows[0].ok,
      true,
    );
  } finally {
    await db.close();
  }
});

test("owner export includes all own workspace and billing metadata with no credentials or foreign records", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    const foreign = await manage(
      db,
      "create_account",
      { name: "Private foreign workspace", currency: "USD" },
      other,
    );
    await manage(db, "issue_key", keyInput(foreign, { keyId: id(7) }), other);
    await db.query(
      "insert into developer_credit_ledger(account_id,entry_type,amount,balance_after,metadata) values($1,'purchase',4,4,$2)",
      [a.accountId, { private_processor_note: "not exported" }],
    );
    const rows = (
      await db.query(
        "select * from developer_account_export_records where owner_id=$1 order by id",
        [owner],
      )
    ).rows;
    assert.deepEqual(
      new Set(rows.map((row) => row.record_type)),
      new Set(["account", "project", "key_metadata", "spending_limit", "credit_ledger"]),
    );
    const text = JSON.stringify(rows);
    assert.equal(text.includes("a".repeat(64)), false);
    assert.equal(text.includes("secret_digest"), false);
    assert.equal(text.includes("private_processor_note"), false);
    assert.equal(text.includes(foreign.accountId), false);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      db.query("select * from developer_account_export_records"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from developer_account_export_records where owner_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("select count(*)::int n from developer_credit_ledger where account_id=$1", [
          a.accountId,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("a full workspace can rotate one key atomically while new growth and stale rotation are rejected", async () => {
  const db = await fixture();
  try {
    const a = await account(db);
    await manage(db, "issue_key", keyInput(a));
    await db.query(
      "insert into developer_billing_keys(id,account_id,project_id,enabled,expires_at,capabilities,credential_owner) select gen_random_uuid(),$1,$2,true,now()+interval '1 day',array['chat'],$3 from generate_series(1,99)",
      [a.accountId, a.projectId, owner],
    );
    await assert.rejects(manage(db, "issue_key", keyInput(a, { keyId: id(10) })), /key_limit/);
    const results = await Promise.allSettled([
      manage(db, "issue_key", keyInput(a, { keyId: id(11), rotateKeyId: key })),
      manage(db, "issue_key", keyInput(a, { keyId: id(12), rotateKeyId: key })),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(results.find((x) => x.status === "rejected").reason.message, /key_not_found/);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from developer_billing_keys where revoked_at is null",
        )
      ).rows[0].n,
      100,
    );
    assert.equal(
      (await db.query("select enabled from developer_billing_keys where id=$1", [key])).rows[0]
        .enabled,
      false,
    );
  } finally {
    await db.close();
  }
});
