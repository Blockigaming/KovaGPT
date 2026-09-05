import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fundingCheckoutParameters } from "../../src/lib/pricing/developer-funding-policy.mjs";
const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const owner = id(1),
  other = id(2),
  offer = id(3);
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
      create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');
      create function kova_private.auth_user_exists(p uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p)$$;
      revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
      create table account_deletion_fences(user_id uuid primary key);create table banned_users(user_id uuid);create table user_preferences(user_id uuid,settings jsonb);grant all on account_deletion_fences to service_role;grant select on banned_users,user_preferences to service_role;`);
    for (const name of [
      "20260803143000_developer_api_profit_protection.sql",
      "20260905004111_developer_billing_runtime.sql",
      "20260905005610_developer_platform_identity.sql",
      "20260905013000_developer_prepaid_funding.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec(`insert into developer_credit_offers(id,name,environment,stripe_price_id,currency,subtotal_amount,credits_amount,refund_reserve,dispute_reserve,maximum_processor_fee,tax_mode,tax_review_reference,approved_by,approved_at,expires_at,active)
      values('${offer}','Fixture only','sandbox','price_fixture','USD',1000,1000,0,0,100,'reviewed_exempt','test fixture only','${owner}',now(),now()+interval '1 day',true);set role service_role;`);
    const account = (
      await db.query("select manage_developer_workspace($1,'create_account',$2) a", [
        owner,
        { name: "API", currency: "USD" },
      ])
    ).rows[0].a.accountId;
    return { db, account };
  } catch (e) {
    await db.close();
    throw e;
  }
}
async function begin(db, account, key = "one", user = owner) {
  return (
    await db.query("select (begin_developer_funding($1,$2,$3,$4,'sandbox')).*", [
      user,
      account,
      offer,
      key,
    ])
  ).rows[0];
}
async function claim(db, attempt) {
  return (await db.query("select * from claim_developer_funding($1)", [attempt.id])).rows[0];
}
const evidence = (attempt, patch = {}) => ({
  environment: "sandbox",
  currency: "USD",
  sessionId: `cs_${attempt.id.replaceAll("-", "")}`,
  paymentIntentId: "pi_fixture",
  chargeId: `ch_${attempt.id.replaceAll("-", "")}`,
  balanceTransactionId: "txn_fixture",
  subtotal: 1000,
  gross: 1000,
  tax: 0,
  fee: 30,
  net: 970,
  refundedGross: 0,
  reversedGross: 0,
  disputeStatus: "none",
  additionalFees: 0,
  ...patch,
});
async function settle(db, a, patch = {}) {
  const e = evidence(a, patch);
  return (
    await db.query("select complete_developer_funding($1,$2,$3,$4,$5) ok", [
      a.id,
      a.lease_token,
      a.revision,
      { id: e.sessionId, state: "paid" },
      e,
    ])
  ).rows[0].ok;
}
async function queue(db, a, event = "evt_one") {
  return db.query("select queue_developer_funding($1,'sandbox',$2)", [a.id, event]);
}
async function balance(db, account) {
  return (
    await db.query(
      "select available_amount::float8 available,reserved_amount::float8 reserved,funding_debt::float8 debt,suspension_reason reason from developer_credit_accounts where id=$1",
      [account],
    )
  ).rows[0];
}

test("funding admission is owner scoped, disabled without an approved offer, and concurrently idempotent", async () => {
  const { db, account } = await fixture();
  try {
    await assert.rejects(begin(db, account, "foreign", other), /owner_unavailable/);
    const [a, b] = await Promise.all([begin(db, account), begin(db, account)]);
    assert.equal(a.id, b.id);
    assert.equal((await balance(db, account)).available, 0);
    await db.exec("update developer_credit_offers set active=false");
    await assert.rejects(begin(db, account, "retired"), /funding_unavailable/);
    await assert.rejects(
      db.exec("update developer_credit_offers set active=true"),
      /reactivation_forbidden/,
    );
    assert.equal((await begin(db, account)).id, a.id);
  } finally {
    await db.close();
  }
});
test("a payment is credited once and duplicate webhooks do not duplicate ledger entries", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account),
      job = await claim(db, a);
    assert.ok(job);
    assert.equal(await claim(db, a), undefined);
    assert.equal(await settle(db, job), true);
    assert.equal(await settle(db, job), false);
    await queue(db, a);
    await queue(db, a);
    assert.equal(await settle(db, await claim(db, a)), true);
    assert.deepEqual(await balance(db, account), {
      available: 1000,
      reserved: 0,
      debt: 0,
      reason: null,
    });
    assert.equal(
      (await db.query("select count(*)::int n from developer_credit_ledger")).rows[0].n,
      1,
    );
    await assert.rejects(db.exec("delete from developer_credit_ledger"), /immutable/);
  } finally {
    await db.close();
  }
});
test("refund and dispute reversals preserve active holds, record debt and restore only authoritative released liability", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await settle(db, await claim(db, a));
    await db.query(
      "update developer_credit_accounts set available_amount=200,reserved_amount=800 where id=$1",
      [account],
    );
    await queue(db, a, "evt_dispute");
    await settle(db, await claim(db, a), { reversedGross: 1000, disputeStatus: "under_review" });
    assert.deepEqual(await balance(db, account), {
      available: 0,
      reserved: 800,
      debt: 800,
      reason: "funding_reversal",
    });
    await queue(db, a, "evt_won");
    await settle(db, await claim(db, a), { reversedGross: 0, disputeStatus: "won" });
    assert.deepEqual(await balance(db, account), {
      available: 200,
      reserved: 800,
      debt: 0,
      reason: null,
    });
    await queue(db, a, "evt_refund");
    await settle(db, await claim(db, a), { refundedGross: 500, reversedGross: 500 });
    assert.deepEqual(await balance(db, account), {
      available: 0,
      reserved: 800,
      debt: 300,
      reason: "funding_reversal",
    });
    await queue(db, a, "evt_stale");
    await assert.rejects(settle(db, await claim(db, a)), /receipt_stale/);
  } finally {
    await db.close();
  }
});
test("new processor events during a lease survive completion and stale leases cannot publish money", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account),
      old = await claim(db, a);
    await queue(db, a, "evt_midflight");
    assert.equal(await settle(db, old), true);
    const newer = await claim(db, a);
    assert.ok(newer);
    assert.equal(await settle(db, old), false);
    assert.equal(await settle(db, newer), true);
    assert.equal((await balance(db, account)).available, 1000);
  } finally {
    await db.close();
  }
});
test("pending checkout blocks the deletion fence before cleanup; expired checkout releases it", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await assert.rejects(
      db.query("insert into account_deletion_fences values($1)", [owner]),
      /reconciliation_pending/,
    );
    const job = await claim(db, a);
    await db.query("select complete_developer_funding($1,$2,$3,$4,null)", [
      a.id,
      job.lease_token,
      job.revision,
      { id: "cs_expired", state: "expired" },
    ]);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(begin(db, account, "after-delete"), /owner_unavailable/);
  } finally {
    await db.close();
  }
});
test("changed receipt evidence rolls back; actual processor fees beyond the approved ceiling retire the offer and suspend spending", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await settle(db, await claim(db, a));
    await queue(db, a, "evt_conflict");
    const job = await claim(db, a);
    await assert.rejects(settle(db, job, { chargeId: "ch_conflicting" }), /receipt_conflict/);
    assert.equal((await balance(db, account)).available, 1000);
    assert.equal(await settle(db, job, { additionalFees: 100 }), true);
    assert.equal((await balance(db, account)).reason, "funding_collection_cost");
    assert.equal(
      (await db.query("select active from developer_credit_offers")).rows[0].active,
      false,
    );
    assert.equal(
      (await db.query("select processor_total_fee::float8 fee from credit_purchases")).rows[0].fee,
      130,
    );
  } finally {
    await db.close();
  }
});
test("browser roles cannot fund or inspect financial evidence and service has no auth.users select", async () => {
  const { db, account } = await fixture();
  try {
    assert.equal(
      (await db.query("select has_table_privilege('service_role','auth.users','select') ok"))
        .rows[0].ok,
      false,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(begin(db, account), /permission denied/);
    await assert.rejects(db.exec("select * from developer_funding_receipts"), /permission denied/);
  } finally {
    await db.close();
  }
});

test("released provider holds repay debt without consuming remaining reservations, and exports omit processor evidence", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await settle(db, await claim(db, a));
    await db.query(
      "update developer_credit_accounts set available_amount=0,reserved_amount=1000 where id=$1",
      [account],
    );
    await queue(db, a, "evt_refund_debt");
    await settle(db, await claim(db, a), { refundedGross: 500, reversedGross: 500 });
    await db.query(
      "update developer_credit_accounts set available_amount=500,reserved_amount=500 where id=$1",
      [account],
    );
    assert.equal((await db.query("select recover_developer_funding_debt() n")).rows[0].n, 1);
    assert.deepEqual(await balance(db, account), {
      available: 0,
      reserved: 500,
      debt: 0,
      reason: null,
    });
    const rows = (
      await db.query("select * from developer_funding_export_records where owner_id=$1", [owner])
    ).rows;
    assert.deepEqual(rows.map((r) => r.record_type).sort(), [
      "funding_debt",
      "payment_attempt",
      "payment_reversal",
    ]);
    assert.doesNotMatch(
      JSON.stringify(rows),
      /balanceTransactionId|processor_total_fee|checkout_url|lease_token|secret_digest/,
    );
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(
      (await db.query("select count(*)::int n from developer_funding_export_records")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from developer_funding_receipts")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("a signed processor session can recover an unknown old create without a second checkout", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await db.query(
      "update developer_funding_attempts set state='reconciliation_required',created_at=now()-interval '2 days',retry_after=now()+interval '5 minutes' where id=$1",
      [a.id],
    );
    await db.query("select queue_developer_funding($1,'sandbox','evt_recover',$2)", [
      a.id,
      evidence(a).sessionId,
    ]);
    const job = await claim(db, a);
    assert.equal(job.checkout_session_id, evidence(a).sessionId);
    assert.equal(await settle(db, job), true);
    assert.equal((await balance(db, account)).available, 1000);
  } finally {
    await db.close();
  }
});

async function start(db, a) {
  const job = await claim(db, a);
  return (
    await db.query("select (start_developer_checkout($1,$2,$3)).*", [
      a.id,
      job.lease_token,
      fundingCheckoutParameters(job, "https://kovagpt.com"),
    ])
  ).rows[0];
}
async function ageCreate(db, a) {
  await db.query(
    "update developer_funding_attempts set checkout_create_started_at=now()-interval '24 hours',checkout_expires_at=now()-interval '23 hours' where id=$1",
    [a.id],
  );
}
test("paid receipts are periodically reconciled without a webhook and precede newly admitted checkouts", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account);
    await settle(db, await claim(db, a));
    assert.equal(await claim(db, a), undefined);
    await db.query(
      "update developer_funding_attempts set last_checked_at=now()-interval '16 minutes' where id=$1",
      [a.id],
    );
    await begin(db, account, "newer");
    const job = (await db.query("select * from claim_developer_funding()")).rows[0];
    assert.equal(job.id, a.id);
    await db.query("select defer_developer_funding($1,$2)", [a.id, job.lease_token]);
    const state = (
      await db.query("select state,last_error_code from developer_funding_attempts where id=$1", [
        a.id,
      ])
    ).rows[0];
    assert.equal(state.state, "reconciliation_required");
    assert.equal(state.last_error_code, "provider_proof_unavailable");
  } finally {
    await db.close();
  }
});
test("first dispatch rechecks approval, persists exact parameters, and later retry preserves that admitted intent", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account),
      job = await start(db, a),
      params = fundingCheckoutParameters(job, "https://kovagpt.com");
    assert.deepEqual(job.checkout_create_parameters, params);
    assert.ok(job.checkout_create_started_at);
    await db.exec("update developer_credit_offers set active=false");
    const replay = (
      await db.query("select (start_developer_checkout($1,$2,$3)).*", [
        a.id,
        job.lease_token,
        { changed: true },
      ])
    ).rows[0];
    assert.deepEqual(replay.checkout_create_parameters, params);
  } finally {
    await db.close();
  }
});
test("bounded post-window discovery persists its cursor and recovers exactly one session before settlement", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account),
      job = await start(db, a);
    await ageCreate(db, a);
    assert.equal(
      (
        await db.query(
          "select record_developer_checkout_discovery($1,$2,'cs_cursor',$3,false) ok",
          [a.id, job.lease_token, evidence(a).sessionId],
        )
      ).rows[0].ok,
      true,
    );
    await db.query("update developer_funding_attempts set retry_after=null where id=$1", [a.id]);
    const next = await claim(db, a);
    assert.equal(next.checkout_discovery_cursor, "cs_cursor");
    assert.equal(
      (
        await db.query("select record_developer_checkout_discovery($1,$2,null,null,true) ok", [
          a.id,
          next.lease_token,
        ])
      ).rows[0].ok,
      true,
    );
    const recovered = await claim(db, a);
    assert.equal(recovered.checkout_session_id, evidence(a).sessionId);
    assert.equal(await settle(db, recovered), true);
  } finally {
    await db.close();
  }
});
test("an exhaustive empty discovery releases deletion, while two different discovered sessions remain ambiguous", async () => {
  const { db, account } = await fixture();
  try {
    const a = await begin(db, account),
      job = await start(db, a);
    await ageCreate(db, a);
    await db.query("select record_developer_checkout_discovery($1,$2,null,null,true)", [
      a.id,
      job.lease_token,
    ]);
    assert.equal(
      (await db.query("select state from developer_funding_attempts where id=$1", [a.id])).rows[0]
        .state,
      "expired",
    );
    const b = await begin(db, account, "ambiguous"),
      first = await start(db, b);
    await ageCreate(db, b);
    await db.query("select record_developer_checkout_discovery($1,$2,'cs_cursor','cs_one',false)", [
      b.id,
      first.lease_token,
    ]);
    await db.query("update developer_funding_attempts set retry_after=null where id=$1", [b.id]);
    const second = await claim(db, b);
    await assert.rejects(
      db.query("select record_developer_checkout_discovery($1,$2,null,'cs_two',true)", [
        b.id,
        second.lease_token,
      ]),
      /session_ambiguous/,
    );
    assert.equal((await balance(db, account)).available, 0);
  } finally {
    await db.close();
  }
});
