import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const [owner, account, organization, project, key, version] = [1, 2, 3, 4, 5, 6].map(id);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to service_role;
  create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
  create table app_notifications(id uuid primary key default gen_random_uuid(),owner_id uuid references auth.users(id),type text,title text,safe_preview text,action_url text,source_entity text,delivery_state text);grant all on app_notifications to service_role;`);
  await db.exec(
    await readFile(
      "supabase/migrations/20260803143000_developer_api_profit_protection.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/migrations/20260905004111_developer_billing_runtime.sql", "utf8"),
  );
  await db.exec(`insert into developer_credit_accounts(id,organization_id,currency,available_amount) values('${account}','${organization}','USD',100);
 insert into api_pricing_versions(id,version,currency,minimum_request_charge,rounding_increment,allowance_configuration,public_price_configuration,status,approved_by,approved_at,effective_at,expires_at)
 values('${version}',1,'USD',1,.0001,'{}','{}','approved','${owner}',now(),now()-interval '1 hour',now()+interval '1 day');
 insert into developer_billing_keys(id,account_id,project_id,enabled,expires_at,capabilities) values('${key}','${account}','${project}',true,now()+interval '1 day',array['chat']);
 insert into developer_billing_limits values('${account}','organization','${organization}',30,100,100,3),('${account}','project','${project}',30,100,100,3),('${account}','key','${key}',30,100,100,3);
 set role service_role;`);
  return db;
}
async function admit(db, name = "request", charge = 20, hash = "a".repeat(64)) {
  const quote = {
    pricingVersionId: version,
    currency: "USD",
    customerCharge: charge,
    maximumReservedCharge: charge,
    promotionalSubsidy: 0,
    estimatedUpstreamCost: 4,
    riskBufferAmount: 1,
    roundingDifference: 0,
    upstreamBreakdown: { input_tokens: 4 },
  };
  return (
    await db.query(
      "select admit_developer_billing($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) result",
      [key, name, hash, "azure_openai", "luna", "chat", version, JSON.stringify(quote), "{}"],
    )
  ).rows[0].result;
}
async function dispatch(db, r) {
  return (
    await db.query("select dispatch_developer_billing($1,$2) ok", [r.request_id, r.lease_token])
  ).rows[0].ok;
}
async function finish(db, r, outcome = "settled", charge = 10, cost = 4) {
  return (
    await db.query("select finish_developer_billing($1,$2,$3,$4::jsonb) ok", [
      r.request_id,
      r.lease_token,
      outcome,
      JSON.stringify({
        finalCustomerCharge: charge,
        actualTotalVariableCost: cost,
        finalUpstreamCost: cost,
        usage: { input_tokens: 10 },
        providerResponseId: "resp_test",
      }),
    ])
  ).rows[0].ok;
}
async function balance(db) {
  return (
    await db.query(
      "select available_amount::float8 available,reserved_amount::float8 reserved from developer_credit_accounts",
    )
  ).rows[0];
}

test("duplicate concurrent admission reserves once; changed payload conflicts without another debit", async () => {
  const db = await fixture();
  try {
    const results = await Promise.all([admit(db), admit(db)]);
    assert.deepEqual(
      results.map((x) => x.decision),
      ["admitted", "duplicate"],
    );
    assert.deepEqual(await balance(db), { available: 80, reserved: 20 });
    await assert.rejects(admit(db, "request", 20, "b".repeat(64)), /idempotency_conflict/);
    assert.equal(await dispatch(db, results[0]), true);
    assert.equal(await dispatch(db, results[0]), false);
  } finally {
    await db.close();
  }
});
test("all three scope budgets prevent concurrent overspend and require explicit limits", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `update developer_billing_limits set concurrent_limit=1 where scope_type='organization'`,
    );
    const attempts = await Promise.allSettled([admit(db, "a"), admit(db, "b")]);
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(attempts.find((x) => x.status === "rejected").reason.message, /budget_exceeded/);
    const r = attempts.find((x) => x.status === "fulfilled").value;
    await finish(db, r, "released");
    await db.exec(`delete from developer_billing_limits where scope_type='project'`);
    await assert.rejects(admit(db, "missing"), /limits_unconfigured/);
    assert.deepEqual(await balance(db), { available: 100, reserved: 0 });
  } finally {
    await db.close();
  }
});
test("settlement conserves balances, returns unused hold, and is terminal/idempotent", async () => {
  const db = await fixture();
  try {
    const r = await admit(db);
    assert.equal(await finish(db, r, "settled"), false);
    await dispatch(db, r);
    await Promise.all([finish(db, r), finish(db, r)]);
    assert.deepEqual(await balance(db), { available: 90, reserved: 0 });
    const ledger = await db.query(
      "select entry_type,amount::float8 amount from developer_credit_ledger order by created_at,id",
    );
    assert.equal(ledger.rows.length, 3);
    assert.equal(
      ledger.rows.reduce((sum, row) => sum + row.amount, 0),
      -10,
    );
    await finish(db, r, "released");
    assert.deepEqual(await balance(db), { available: 90, reserved: 0 });
    await assert.rejects(db.query("delete from developer_credit_ledger"), /immutable/);
  } finally {
    await db.close();
  }
});
test("after-dispatch failure never refunds; expiry recovers only undispatched holds", async () => {
  const db = await fixture();
  try {
    const reserved = await admit(db, "reserved"),
      sent = await admit(db, "sent");
    await dispatch(db, sent);
    assert.equal(await finish(db, sent, "released"), false);
    await db.exec(`update developer_api_requests set lease_expires_at=now()-interval '1 minute'`);
    assert.equal((await db.query("select recover_developer_billing(100) count")).rows[0].count, 2);
    assert.deepEqual(await balance(db), { available: 80, reserved: 20 });
    assert.equal(
      (
        await db.query("select settlement_state from developer_api_requests where id=$1", [
          sent.request_id,
        ])
      ).rows[0].settlement_state,
      "reconciliation_required",
    );
    assert.equal(await dispatch(db, reserved), false);
    await finish(db, sent);
    assert.deepEqual(await balance(db), { available: 90, reserved: 0 });
  } finally {
    await db.close();
  }
});
test("removing a key capability after admission blocks dispatch and releases its hold", async () => {
  const db = await fixture();
  try {
    const pending = await admit(db);
    await db.exec("update developer_billing_keys set capabilities=array['embeddings']");
    assert.equal(await dispatch(db, pending), false);
    assert.equal(await finish(db, pending, "released"), true);
    assert.deepEqual(await balance(db), { available: 100, reserved: 0 });
    assert.equal(
      (await db.query("select dispatched_at from developer_api_requests")).rows[0].dispatched_at,
      null,
    );
  } finally {
    await db.close();
  }
});
test("expired prices, emergency controls and revoked keys block dispatch; margin failure blocks future model calls and delivers once", async () => {
  const db = await fixture();
  try {
    const r = await admit(db);
    await db.exec(`update developer_billing_keys set revoked_at=now()`);
    assert.equal(await dispatch(db, r), false);
    await finish(db, r, "released");
    await db.exec(
      `update developer_billing_keys set revoked_at=null;update api_pricing_versions set expires_at=now()-interval '1 minute'`,
    );
    await assert.rejects(admit(db, "expired"), /pricing_unavailable/);
    await db.exec(`update api_pricing_versions set expires_at=now()+interval '1 day'`);
    const next = await admit(db, "margin");
    await dispatch(db, next);
    await finish(db, next, "settled", 10, 9);
    await assert.rejects(admit(db, "blocked"), /emergency_block/);
    const delivered = await db.query("select deliver_developer_billing_alerts($1::uuid[],100) n", [
      [owner],
    ]);
    assert.equal(delivered.rows[0].n, 1);
    assert.equal(
      (await db.query("select deliver_developer_billing_alerts($1::uuid[],100) n", [[owner]]))
        .rows[0].n,
      0,
    );
    assert.equal((await db.query("select count(*)::int n from app_notifications")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
test("client roles cannot read or mutate ledger contracts and service needs no auth.users select", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (await db.query("select has_table_privilege('service_role','auth.users','select') ok"))
        .rows[0].ok,
      false,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(admit(db), /permission denied/);
    await assert.rejects(db.query("select * from developer_billing_keys"), /permission denied/);
    await assert.rejects(db.query("select recover_developer_billing(100)"), /permission denied/);
  } finally {
    await db.close();
  }
});

test("multiple provider calls cannot bypass the complete outer-request budget", async () => {
  const db = await fixture();
  try {
    const first = await admit(db, "group:0", 20);
    await assert.rejects(admit(db, "group:1", 20), /budget_exceeded/);
    await dispatch(db, first);
    await finish(db, first, "settled", 10, 4);
    const second = await admit(db, "group:1", 20);
    assert.equal(second.decision, "admitted");
    await assert.rejects(admit(db, "group:2", 1), /budget_exceeded/);
  } finally {
    await db.close();
  }
});
