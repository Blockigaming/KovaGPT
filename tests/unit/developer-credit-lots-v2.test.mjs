import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444";
const attempt = "55555555-5555-4555-8555-555555555555";
const purchase = "66666666-6666-4666-8666-666666666666";
const a = "2024-02-29T12:00:00.000Z";
const b = "2025-02-28T12:00:00.000Z";
const now = "2024-11-15T12:00:00.000Z";

async function fixture({ paid = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema kova_private;
      create table auth.users(id uuid primary key);
      create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id)$$;
      revoke all on function kova_private.auth_user_exists(uuid) from public;
      grant usage on schema auth,kova_private to service_role;
      grant execute on function kova_private.auth_user_exists(uuid) to service_role;
      create table public.account_deletion_fences(user_id uuid);
      create table public.banned_users(user_id uuid);
      create table public.developer_credit_accounts(id uuid primary key, currency text, suspended_at timestamptz);
      create table public.developer_account_owners(account_id uuid primary key,owner_id uuid,name text,created_at timestamptz default now());
      create table public.developer_credit_sharing_preferences(owner_id uuid primary key,allow_consumer_usage boolean not null default false);
      create table public.subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,environment text,status text,price_id text,current_period_start timestamptz,current_period_end timestamptz,stripe_subscription_id text,stripe_customer_id text);
      create table public.processed_stripe_events(event_id text primary key,environment text,type text,processing_status text,retryable boolean,invoice_id text,customer_id text,subscription_id text,event_created_at timestamptz);
      create table public.billing_plan_tiers(environment text,stripe_price_id text,tier text,lookup_key text);
      create function public.billing_user_plan_tier(p_owner uuid) returns text language sql stable as $$select case when exists(select 1 from public.subscriptions where user_id=p_owner and status='active') then 'pro' else 'free' end$$;
      create table public.credit_purchases(id uuid primary key,account_id uuid,credits_granted numeric);
      create table public.developer_funding_attempts(id uuid primary key,account_id uuid,state text);
      create table public.developer_funding_receipts(attempt_id uuid primary key,purchase_id uuid,charge_id text,reversal_amount numeric);
      grant select on public.account_deletion_fences,public.banned_users,public.developer_credit_accounts,public.developer_account_owners,
        public.developer_credit_sharing_preferences,public.subscriptions,public.billing_plan_tiers,public.credit_purchases,
        public.developer_funding_attempts,public.developer_funding_receipts,public.processed_stripe_events to service_role;
      insert into auth.users values('${owner}'),('${other}');
      insert into public.developer_credit_accounts values('${account}','USD',null),('${foreign}','USD',null);
      insert into public.developer_account_owners(account_id,owner_id,name) values('${account}','${owner}','Own'),('${foreign}','${other}','Other');
      insert into public.billing_plan_tiers values('live','price_fixture','pro','pro_monthly');
      insert into public.subscriptions(user_id,environment,status,price_id,current_period_start,current_period_end,stripe_subscription_id,stripe_customer_id)
        values('${owner}','live','active','price_fixture','2024-11-01T00:00:00Z','2024-12-01T00:00:00Z','sub_fixture','cus_fixture');
      insert into public.processed_stripe_events values('evt_first','live','invoice.paid','completed',false,'in_first','cus_fixture','sub_fixture','2024-11-01T00:01:00Z');
      insert into public.processed_stripe_events values('evt_second','live','invoice.paid','completed',false,'in_second','cus_fixture','sub_fixture','2024-12-01T00:01:00Z');
      insert into public.credit_purchases values('${purchase}','${account}',100);
      insert into public.developer_funding_attempts values('${attempt}','${account}','paid');
      insert into public.developer_funding_receipts values('${attempt}','${purchase}','ch_fixture',0);
    `);
    await db.exec(await readFile("supabase/pending/developer_credit_lots_v2.sql", "utf8"));
    await db.query("insert into developer_credit_lot_accounts_v2(account_id) values($1)", [
      account,
    ]);
    await db.exec("set role service_role");
    if (paid) await recordInvoice(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
const value = async (db, sql, args) => (await db.query(sql, args)).rows[0].result;
const recordInvoice = (
  db,
  event = "evt_first",
  invoice = "in_first",
  start = "2024-11-01T00:00:00Z",
  end = "2024-12-01T00:00:00Z",
  customer = "cus_fixture",
  price = "price_fixture",
) =>
  value(
    db,
    "select developer_record_paid_pro_invoice_v2($1,$2,$3,'sub_fixture',$4,$5,$6,$5,8000) result",
    [event, invoice, customer, price, start, end],
  );
const refresh = (db, at = now) =>
  value(db, "select developer_refresh_pro_v2($1,$2) result", [owner, at]);
const record = (db, time = a) =>
  value(db, "select developer_record_purchase_v2($1,'ch_fixture',$2) result", [attempt, time]);
const reserve = (db, key, surface, amount, at = now, who = owner, target = account) =>
  value(db, "select developer_reserve_lots_v2($1,$2,$3,$4,$5,$6) result", [
    who,
    target,
    key,
    surface,
    amount,
    at,
  ]);
const finish = (db, hold, outcome, amount, at = now) =>
  value(db, "select developer_finish_lots_v2($1,$2,$3,$4) result", [hold, outcome, amount, at]);
const privileged = async (db, sql, args = []) => {
  await db.exec("reset role");
  try {
    return await db.query(sql, args);
  } finally {
    await db.exec("set role service_role");
  }
};
const balance = (db, id) =>
  value(db, "select available_amount::float8 result from developer_credit_lots_v2 where id=$1", [
    id,
  ]);

test("one Pro grant per non-overlapping paid period; downgrade expires unused value; renewal does not roll over", async () => {
  const db = await fixture();
  try {
    const id = await refresh(db);
    assert.equal(await refresh(db), id);
    assert.equal(await balance(db, id), 8000);
    await privileged(db, "update subscriptions set status='past_due' where user_id=$1", [owner]);
    assert.equal(await refresh(db), null);
    assert.equal(await balance(db, id), 0);
    await privileged(db, "update subscriptions set status='active' where user_id=$1", [owner]);
    assert.equal(await refresh(db), id);
    assert.equal(await balance(db, id), 0);
    await privileged(
      db,
      "update subscriptions set current_period_start='2024-12-01T00:00:00Z',current_period_end='2025-01-01T00:00:00Z' where user_id=$1",
      [owner],
    );
    assert.equal(await refresh(db, "2024-12-02T12:00:00.000Z"), null);
    await recordInvoice(
      db,
      "evt_second",
      "in_second",
      "2024-12-01T00:00:00Z",
      "2025-01-01T00:00:00Z",
    );
    const next = await refresh(db, "2024-12-02T12:00:00.000Z");
    assert.notEqual(next, id);
    assert.equal(await balance(db, next), 8000);
    assert.equal(await balance(db, id), 0);
    assert.equal(
      await value(
        db,
        "select count(*)::int result from developer_credit_lots_v2 where kind='included_pro'",
        [],
      ),
      2,
    );
  } finally {
    await db.close();
  }
});

test("consumer opt-in excludes included credits; foreign and duplicate conflicting holds are rejected", async () => {
  const db = await fixture();
  try {
    const included = await refresh(db);
    // Seed a test-only lot at a historical clock so the live purchase recorder's
    // actual clock never affects the deterministic reservation test.
    const lot = await value(
      db,
      "insert into developer_credit_lots_v2(account_id,kind,source_key,owner_id,issued_at,expires_at,issued_amount,available_amount) values($1,'purchased','test-lot',$2,$3,$4,100,100) returning id result",
      [account, owner, a, b],
    );
    await assert.rejects(reserve(db, "consumer-1", "consumer", 20), /sharing_disabled/);
    await privileged(db, "insert into developer_credit_sharing_preferences values($1,true)", [
      owner,
    ]);
    const r = await reserve(db, "consumer-1", "consumer", 20);
    assert.equal(await balance(db, included), 8000);
    assert.equal(await balance(db, lot), 80);
    assert.equal((await reserve(db, "consumer-1", "consumer", 20)).decision, "duplicate");
    await assert.rejects(reserve(db, "consumer-1", "consumer", 21), /request_conflict/);
    await assert.rejects(reserve(db, "foreign", "api", 1, now, other, account), /owner_required/);
    await assert.rejects(reserve(db, "too-big", "consumer", 81), /credit_insufficient/);
    assert.equal(await balance(db, lot), 80);
    await privileged(
      db,
      "update developer_credit_sharing_preferences set allow_consumer_usage=false where owner_id=$1",
      [owner],
    );
    await assert.rejects(reserve(db, "consumer-2", "consumer", 1), /sharing_disabled/);
    assert.equal(await finish(db, r.holdId, "released", 0), true);
    assert.equal(await balance(db, lot), 100);
  } finally {
    await db.close();
  }
});

test("API holds use included value first, release unused original lots, and do not restore expired value", async () => {
  const db = await fixture();
  try {
    const included = await refresh(db);
    const lot = await value(
      db,
      "insert into developer_credit_lots_v2(account_id,kind,source_key,owner_id,issued_at,expires_at,issued_amount,available_amount) values($1,'purchased','test-lot',$2,$3,$4,100,100) returning id result",
      [account, owner, a, b],
    );
    const r = await reserve(db, "api-1", "api", 8050);
    assert.equal(await balance(db, included), 0);
    assert.equal(await balance(db, lot), 50);
    assert.equal(await value(db, "select developer_dispatch_lots_v2($1) result", [r.holdId]), true);
    assert.equal(await finish(db, r.holdId, "released", 0), false);
    assert.equal(await finish(db, r.holdId, "settled", 7900, "2024-12-02T00:00:00.000Z"), true);
    assert.equal(await finish(db, r.holdId, "settled", 7900, "2024-12-02T00:00:00.000Z"), true);
    assert.equal(await finish(db, r.holdId, "settled", 7899, "2024-12-02T00:00:00.000Z"), false);
    assert.equal(await balance(db, included), 0);
    assert.equal(await balance(db, lot), 100);
    assert.equal(
      await value(
        db,
        "select expired_amount::float8 result from developer_credit_lots_v2 where id=$1",
        [included],
      ),
      100,
    );
    await value(db, "select developer_credit_expire_v2($1,$2) result", [account, b]);
    assert.equal(await balance(db, lot), 0);
  } finally {
    await db.close();
  }
});

test("verified receipts are unique, calendar-year expiry does not reset, reversals touch only their original lot", async () => {
  const db = await fixture();
  try {
    const lot = await record(db);
    assert.equal(await record(db), lot);
    assert.equal(
      new Date(
        await value(db, "select expires_at result from developer_credit_lots_v2 where id=$1", [
          lot,
        ]),
      ).toISOString(),
      b,
    );
    await assert.rejects(record(db, "2024-03-01T12:00:00.000Z"), /receipt_conflict/);
    assert.equal(await balance(db, lot), 0);
    await privileged(
      db,
      "update developer_funding_receipts set reversal_amount=30 where attempt_id=$1",
      [attempt],
    );
    assert.equal(await record(db), lot);
    assert.equal(
      await value(
        db,
        "select reversed_amount::float8 result from developer_credit_lots_v2 where id=$1",
        [lot],
      ),
      30,
    );
    await privileged(
      db,
      "update developer_funding_receipts set reversal_amount=0 where attempt_id=$1",
      [attempt],
    );
    await record(db);
    assert.equal(await balance(db, lot), 0);
    assert.equal(
      await value(
        db,
        "select expired_amount::float8 result from developer_credit_lots_v2 where id=$1",
        [lot],
      ),
      100,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(db.query("select * from developer_credit_lots_v2"), /permission denied/);
    await assert.rejects(
      db.query("select developer_refresh_pro_v2($1,$2)", [owner, now]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("active status without matching payment cannot mint included credits", async () => {
  const db = await fixture({ paid: false });
  try {
    assert.equal(await refresh(db), null);
    await assert.rejects(recordInvoice(db, "evt_missing"), /event_required/);
    await assert.rejects(
      recordInvoice(db, "evt_first", "in_first", undefined, undefined, "cus_foreign"),
      /event_required/,
    );
    assert.equal(await recordInvoice(db), true);
    assert.equal(await recordInvoice(db), true);
    const lot = await refresh(db);
    assert.equal(await balance(db, lot), 8000);
    await privileged(db, "update developer_paid_pro_invoices_v2 set revoked_at=now()");
    assert.equal(await refresh(db), null);
    assert.equal(await balance(db, lot), 0);
  } finally {
    await db.close();
  }
});
