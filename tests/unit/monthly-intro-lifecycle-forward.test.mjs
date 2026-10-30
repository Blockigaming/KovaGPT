import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  captureMonthlyLifecycleQualification,
  monthlyLifecyclePreflight,
  unusedMonthlyLifecycleRollback,
} from "../../scripts/release/monthly-intro-lifecycle-guards.mjs";

// Behavioral checks use one embedded backend with synthetic account/provider
// identities. They do not prove native PG17 multi-session lock contention or
// any Stripe purchase, webhook signature, production plan grant or deployment.
const MIGRATION = "supabase/migrations/20261030141704_kova_monthly_intro_lifecycle_forward.sql";
const CANONICAL =
  "supabase/migrations/20260904231213_billing_plan_tier_and_atomic_stripe_events.sql";
const SUMMARY_FORWARD =
  "supabase/migrations/20261029235133_kova_production_subscription_summary_read_only_forward.sql";
// A running suite always exercises one exact SQL payload, even while another
// contributor prepares a later migration revision in this working tree.
const migrationSource = await readFile(MIGRATION, "utf8");
const migrationSha256 = createHash("sha256").update(migrationSource).digest("hex");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const PLUS = "price_1UAzhHAEZlsb6DBYWw2oUCeO";
const PRO = "price_1UEw6FAEZlsb6DBYuksCKOBR";
const OLD_PRO = "price_1UAzhRAEZlsb6DBYlafU4mhc";
const RETURN = "https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}";

// This is the inspected production table shape. Existing tier functions below
// are loaded from canonical source, so summary tests exercise actual authorities.
async function fixture({ catalog = true, beforeInstall, installationError } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema kova_private;
      revoke all on schema kova_private from public,anon,authenticated;
      grant usage on schema kova_private to service_role;
      grant usage on schema auth to anon, authenticated, service_role;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${USER}'),('${OTHER}'),('${MEMBER}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.family_links(member_id uuid primary key, owner_id uuid not null);
      create function public.family_owner_of(_user_id uuid) returns uuid
        language sql stable as $$ select owner_id from public.family_links where member_id=_user_id $$;
      create table public.account_deletion_fences (
        user_id uuid primary key references auth.users(id) on delete cascade,
        requested_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.account_deletion_fences enable row level security;
      grant all on public.account_deletion_fences to service_role;
      create table public.billing_plan_tiers(
        environment text not null,
        stripe_price_id text not null,
        lookup_key text not null,
        tier text not null,
        primary key(environment,stripe_price_id)
      );
      alter table public.billing_plan_tiers enable row level security;
      grant select on public.billing_plan_tiers to service_role;
      create table public.subscriptions(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users(id) on delete cascade,
        stripe_subscription_id text not null unique,
        stripe_customer_id text not null,
        product_id text not null,
        price_id text not null,
        status text not null default 'active',
        current_period_start timestamptz,
        current_period_end timestamptz,
        cancel_at_period_end boolean default false,
        environment text not null default 'sandbox',
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        last_stripe_event_created_at timestamptz,
        last_stripe_event_id text
      );
      alter table public.subscriptions enable row level security;
      grant all on public.subscriptions to service_role;
      create table public.processed_stripe_events(
        event_id text primary key, type text not null,environment text not null,
        processed_at timestamptz not null default now(),correlation_id uuid,
        event_created_at timestamptz,object_id text,outcome text not null default 'claimed',
        customer_id text,subscription_id text,invoice_id text,checkout_session_id text,
        retryable boolean not null default false,payload_hash text
      );
      alter table public.processed_stripe_events enable row level security;
      grant all on public.processed_stripe_events to service_role;
    `);
    if (catalog)
      await db.exec(`insert into public.billing_plan_tiers values
        ('live','${PLUS}','plus_monthly','plus'),
        ('live','${PRO}','pro_monthly','pro'),
        ('live','${OLD_PRO}','pro_monthly','pro');`);
    const canonical = await readFile(CANONICAL, "utf8");
    const summarySource = await readFile(SUMMARY_FORWARD, "utf8");
    for (const name of [
      "billing_user_plan_tier",
      "effective_user_plan_tier",
      "user_subscription_summary",
    ]) {
      const match = (name === "user_subscription_summary" ? summarySource : canonical).match(
        new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "u"),
      );
      assert.ok(match, `canonical ${name} body is available`);
      await db.exec(match[0]);
      await db.exec(`revoke all on function public.${name}(uuid) from public,anon,authenticated;
        grant execute on function public.${name}(uuid) to service_role;`);
    }
    const canonicalBefore = await db.query(`select p.proname,pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('billing_user_plan_tier','effective_user_plan_tier','user_subscription_summary') order by p.proname`);
    const expected = {
      billing_user_plan_tier: "bb50b84f148c06a5368c30165b79b210bffac56f404c6cb5f17ba2d69aaa71da",
      effective_user_plan_tier: "06d6ace39ab1be536b136a9e76c9cf05cf4ecf410a3d11fdd19bb5eb36eede18",
      user_subscription_summary: "630fbfcb5a21fd303da4b42c6738fe5f20cb14e4492b238124ba33a727fdec63",
    };
    for (const row of canonicalBefore.rows) {
      assert.equal(
        createHash("sha256").update(row.definition).digest("hex"),
        expected[row.proname],
        `${row.proname} fixture matches the actual production function definition`,
      );
    }
    if (beforeInstall) await beforeInstall(db);
    assert.ok(migrationSource.trim(), "the lifecycle migration must have a real implementation");
    if (installationError) {
      await assert.rejects(db.exec(migrationSource), installationError);
      await db.exec("rollback;set role service_role");
      return db;
    }
    await db.exec(migrationSource);
    const canonicalAfter = await db.query(`select p.proname,pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('billing_user_plan_tier','effective_user_plan_tier','user_subscription_summary') order by p.proname`);
    assert.deepEqual(
      canonicalAfter.rows,
      canonicalBefore.rows,
      "installation preserves all canonical tier and summary authorities exactly",
    );
    await db.exec("set role service_role");
    return db;
  } catch (error) {
    await db.close();
    if (error?.code) {
      // PGlite attaches the complete SQL string to an error. Keep the useful
      // database location without dumping the whole migration for every test.
      throw new Error(
        `${error.code}: ${error.message}${error.position ? ` at SQL position ${error.position}` : ""}${error.where ? ` (${error.where})` : ""}`,
      );
    }
    throw error;
  }
}

async function rpc(db, name, args = []) {
  assert.match(
    name,
    /^(kova_policy_[a-z_]+|kova_monthly_subscription_summary|billing_user_plan_tier|effective_user_plan_tier)$/u,
  );
  const sql = `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as value`;
  return (await db.query(sql, args)).rows[0].value;
}
async function admin(db, execute) {
  await db.exec("reset role");
  try {
    return await execute();
  } finally {
    await db.exec("set role service_role");
  }
}
async function authCount(db, user = USER) {
  return admin(
    db,
    async () =>
      (await db.query("select count(*)::int as n from auth.users where id=$1", [user])).rows[0].n,
  );
}
async function qualifyUnused(db) {
  return admin(db, () =>
    captureMonthlyLifecycleQualification((sql, params) => db.query(sql, params)),
  );
}
async function expectRollbackRejected(db, qualification, error) {
  const sql = await unusedMonthlyLifecycleRollback(qualification);
  await admin(db, async () => {
    await assert.rejects(db.exec(sql), error);
    await db.exec("rollback");
  });
}
async function mapped(db, user = USER, customer = "cus_One", environment = "live") {
  const claim = await rpc(db, "kova_policy_claim_customer", [user, environment]);
  const completed = await rpc(db, "kova_policy_complete_customer", [
    user,
    environment,
    claim.requestId,
    customer,
  ]);
  assert.equal(completed, customer);
  return customer;
}
async function checkout(
  db,
  { user = USER, environment = "live", price = PLUS, coupon = "intro50", returnUrl = RETURN } = {},
) {
  return rpc(db, "kova_policy_claim_checkout", [user, environment, price, coupon, returnUrl]);
}
async function attach(db, claim, session = "cs_One", user = USER) {
  return rpc(db, "kova_policy_attach_checkout", [
    user,
    claim.environment,
    claim.claimId,
    session,
    claim.expiresAt,
  ]);
}
async function settle(db, claim, outcome = "completed", session = "cs_One", user = USER) {
  return rpc(db, "kova_policy_settle_checkout", [
    user,
    claim.environment,
    claim.claimId,
    session,
    outcome,
  ]);
}
function event({
  id = "evt_One",
  type = "customer.subscription.created",
  customer = "cus_One",
  subscription = "sub_One",
  price = PLUS,
  status = "active",
  createdAt,
  kind = "subscription",
  ...overrides
} = {}) {
  const created = createdAt ?? new Date(Date.now() - 60_000).toISOString();
  const projection =
    kind === "subscription"
      ? {
          kind,
          stripeSubscriptionId: subscription,
          customerId: customer,
          productId: price === PLUS ? "prod_VB1Crlvg4utbCe" : "prod_VB1Cbp01TZ8hOI",
          priceId: price,
          status,
          periodStart: new Date(Date.now() - 3_600_000).toISOString(),
          periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
          cancelAtPeriodEnd: false,
        }
      : kind === "subscription_deleted"
        ? {
            kind,
            stripeSubscriptionId: subscription,
            customerId: customer,
            status: "canceled",
          }
        : kind === "invoice_status"
          ? {
              kind,
              stripeSubscriptionId: subscription,
              customerId: customer,
              status,
            }
          : null;
  return {
    eventId: id,
    type,
    createdAt: created,
    correlationId: null,
    objectId: kind === "invoice_status" ? "in_One" : subscription,
    customerId: customer,
    subscriptionId: subscription,
    invoiceId: kind === "invoice_status" ? "in_One" : null,
    checkoutSessionId: null,
    outcome: kind === "invoice_status" ? "payment_confirmed" : "subscription_updated",
    projection,
    ...overrides,
  };
}
async function apply(db, value, environment = "live") {
  return rpc(db, "kova_policy_apply_legacy_event", [environment, value]);
}

test("readiness requires the actual installed lifecycle and verified exact-price registry", async (t) => {
  const db = await fixture();
  try {
    t.diagnostic(`migration SHA-256=${migrationSha256}`);
    t.diagnostic(
      `embedded PostgreSQL=${(await db.query("show server_version_num")).rows[0].server_version_num}; native concurrency remains separate`,
    );
    const ready = await rpc(db, "kova_policy_readiness");
    assert.equal(ready.schemaVersion, "monthly-intro-v1");
    assert.equal(ready.recoveryHours, 720);
    assert.equal(ready.ready, true);
    await admin(db, () => db.exec("delete from public.billing_plan_tiers"));
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, false);
  } finally {
    await db.close();
  }
});

test("queued customer claim replays converge on one durable request and one mapping", async () => {
  const db = await fixture();
  try {
    // PGlite serializes a single connection; this is replay coverage, not a
    // claim of independent PostgreSQL sessions contending on advisory locks.
    const results = await Promise.allSettled([
      rpc(db, "kova_policy_claim_customer", [USER, "live"]),
      rpc(db, "kova_policy_claim_customer", [USER, "live"]),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const [a, b] = results.map((result) => result.value);
    assert.equal(a.state, "pending");
    assert.equal(a.requestId, b.requestId);
    assert.equal(a.requestedAt, b.requestedAt);
    assert.equal(
      await rpc(db, "kova_policy_complete_customer", [USER, "live", a.requestId, "cus_One"]),
      "cus_One",
    );
    assert.equal(
      await rpc(db, "kova_policy_complete_customer", [USER, "live", a.requestId, "cus_One"]),
      "cus_One",
    );
    const current = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    assert.equal(current.state, "mapped");
    assert.equal(current.customerId, "cus_One");
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [USER, "live", a.requestId, "cus_Other"]),
    );
  } finally {
    await db.close();
  }
});

test("customer identity cannot be reassigned across accounts or completed under another request or environment", async () => {
  const db = await fixture();
  try {
    const a = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    const b = await rpc(db, "kova_policy_claim_customer", [OTHER, "live"]);
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [USER, "live", b.requestId, "cus_One"]),
    );
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [USER, "sandbox", a.requestId, "cus_One"]),
    );
    await rpc(db, "kova_policy_complete_customer", [USER, "live", a.requestId, "cus_One"]);
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [OTHER, "live", b.requestId, "cus_One"]),
    );
    await assert.rejects(rpc(db, "kova_policy_claim_customer", [USER, "production"]));
  } finally {
    await db.close();
  }
});

test("checkout replay retains one claim; changed immutable inputs cannot replace an unknown outcome", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const results = await Promise.allSettled([checkout(db), checkout(db)]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const [a, b] = results.map((result) => result.value);
    assert.equal(a.claimId, b.claimId);
    assert.equal(a.idempotencyKey, `kova-checkout:${a.claimId}`);
    assert.equal(a.introEligible, true);
    assert.equal(a.couponId, "intro50");
    assert.equal(a.customerId, "cus_One");
    assert.equal(a.priceId, PLUS);
    assert.equal(a.returnUrl, RETURN);
    assert.equal(a.environment, "live");
    await assert.rejects(checkout(db, { price: PRO }));
    await assert.rejects(checkout(db, { coupon: "different" }));
    await assert.rejects(checkout(db, { returnUrl: "https://attacker.invalid/" }));
    await assert.rejects(checkout(db, { price: OLD_PRO }));
    await assert.rejects(checkout(db, { price: "price_Unverified" }));
    assert.equal((await checkout(db)).claimId, a.claimId);
  } finally {
    await db.close();
  }
});

test("checkout session binding, owner and terminal outcome are immutable and environment scoped", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const claim = await checkout(db);
    await assert.rejects(attach(db, claim, "cs_One", OTHER));
    await assert.rejects(
      rpc(db, "kova_policy_attach_checkout", [
        USER,
        "sandbox",
        claim.claimId,
        "cs_One",
        claim.expiresAt,
      ]),
    );
    await attach(db, claim);
    await attach(db, claim);
    await assert.rejects(attach(db, claim, "cs_Two"));
    await assert.rejects(settle(db, claim, "completed", "cs_Two"));
    await settle(db, claim);
    await settle(db, claim);
    await assert.rejects(settle(db, claim, "expired"));
  } finally {
    await db.close();
  }
});

test("completed introductory checkout consumes eligibility exactly once without granting a paid tier", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const first = await checkout(db);
    await attach(db, first);
    await settle(db, first);
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
    const second = await checkout(db);
    assert.notEqual(second.claimId, first.claimId);
    assert.equal(second.introEligible, false);
    assert.equal(second.couponId, null);
  } finally {
    await db.close();
  }
});

test("verified expired checkout releases its claim while keeping unused intro eligibility", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const first = await checkout(db);
    await attach(db, first);
    await settle(db, first, "expired");
    const second = await checkout(db);
    assert.notEqual(second.claimId, first.claimId);
    assert.equal(second.introEligible, true);
    assert.equal(second.couponId, "intro50");
  } finally {
    await db.close();
  }
});

test("verified subscription events establish exact-price entitlement and replay does not create another row", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const value = event();
    const applied = await apply(db, value);
    assert.equal(applied.duplicate, false);
    assert.equal(applied.outcome, "applied");
    const duplicate = await apply(db, value);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.outcome, "already_processed");
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "plus");
    const rows = (await db.query("select count(*)::int as n from public.subscriptions")).rows;
    assert.equal(rows[0].n, 1);
    await assert.rejects(apply(db, { ...value, customerId: "cus_Altered" }));
  } finally {
    await db.close();
  }
});

test("stale webhook cannot restore an older subscription after newer state", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ id: "evt_New", status: "unpaid", createdAt: "2026-10-30T12:00:00Z" }));
    const stale = await apply(
      db,
      event({ id: "evt_Old", status: "active", createdAt: "2026-10-30T11:00:00Z" }),
    );
    assert.equal(stale.outcome, "stale_ignored");
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
    assert.equal(
      (await db.query("select status from public.subscriptions")).rows[0].status,
      "unpaid",
    );
  } finally {
    await db.close();
  }
});

test("unmapped customer events cannot select an owner through supplied metadata", async () => {
  const db = await fixture();
  try {
    let result;
    try {
      result = await apply(db, event({ userId: USER, metadata: { userId: USER } }));
    } catch {
      /* Strict rejection of unnormalized metadata is also safe. */
    }
    if (result) assert.ok(result.outcome === "orphaned" || result.outcome === "observed");
    assert.equal(
      (await db.query("select count(*)::int as n from public.subscriptions")).rows[0].n,
      0,
    );
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("unverified price and subscription-to-customer conflicts cannot create paid access", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await assert.rejects(apply(db, event({ price: "price_Unknown" })));
    await apply(db, event());
    await mapped(db, OTHER, "cus_Two");
    await assert.rejects(apply(db, event({ id: "evt_Reassigned", customer: "cus_Two" })));
    assert.equal(await rpc(db, "billing_user_plan_tier", [OTHER]), "free");
    assert.equal(
      (await db.query("select user_id from public.subscriptions")).rows[0].user_id,
      USER,
    );
  } finally {
    await db.close();
  }
});

test("historical Pro price remains recognizable while new checkout refuses it", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ price: OLD_PRO }));
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "pro");
    assert.equal(
      (await db.query("select price_id from public.subscriptions")).rows[0].price_id,
      OLD_PRO,
    );
    await assert.rejects(checkout(db, { price: OLD_PRO }));
  } finally {
    await db.close();
  }
});

test("monthly summary preserves canonical personal and family-owner resolution", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ price: PRO }));
    await admin(db, () =>
      db.query("insert into public.family_links values($1,$2)", [MEMBER, USER]),
    );
    const own = await rpc(db, "kova_monthly_subscription_summary", [USER, PLUS, PRO]);
    const inherited = await rpc(db, "kova_monthly_subscription_summary", [MEMBER, PLUS, PRO]);
    assert.equal(own.tier, "pro");
    assert.equal(own.effectiveTier, "pro");
    assert.equal(inherited.tier, "free");
    assert.equal(inherited.effectiveTier, "pro");
    assert.equal(inherited.inherited, true);
    await assert.rejects(rpc(db, "kova_monthly_subscription_summary", [USER, PRO, PLUS]));
  } finally {
    await db.close();
  }
});

test("account deletion is recoverable for exactly thirty days and does not delete billing or private rows at scheduling", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const before = await rpc(db, "kova_policy_account_status", [USER]);
    assert.equal(before.state, "active");
    const scheduled = await rpc(db, "kova_policy_schedule_deletion", [USER]);
    assert.equal(scheduled.state, "scheduled");
    assert.equal(
      Date.parse(scheduled.recoverUntil) - Date.parse(scheduled.scheduledAt),
      30 * 86400_000,
    );
    const repeat = await rpc(db, "kova_policy_schedule_deletion", [USER]);
    assert.equal(repeat.scheduledAt, scheduled.scheduledAt);
    assert.deepEqual(await rpc(db, "kova_policy_due_deletions", [2]), []);
    await assert.rejects(rpc(db, "kova_policy_begin_finalization", [USER]));
    await assert.rejects(checkout(db));
    const recovered = await rpc(db, "kova_policy_recover_deletion", [USER]);
    assert.equal(recovered.state, "active");
    assert.equal(recovered.scheduledAt, null);
    const customer = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    assert.equal(customer.customerId, "cus_One");
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("browser roles cannot call privileged billing routines or read their private state", async () => {
  const db = await fixture();
  try {
    const routines = await admin(db, () =>
      db.query(`select p.oid::regprocedure::text as signature,
      has_function_privilege('anon',p.oid,'execute') as anon_execute,
      has_function_privilege('authenticated',p.oid,'execute') as user_execute,
      has_function_privilege('service_role',p.oid,'execute') as server_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'kova_policy_%' or p.proname='kova_monthly_subscription_summary')`),
    );
    assert.ok(routines.rows.length >= 19);
    for (const row of routines.rows) {
      assert.equal(row.anon_execute, false, `${row.signature} denies anon`);
      assert.equal(row.user_execute, false, `${row.signature} denies browser users`);
      assert.equal(row.server_execute, true, `${row.signature} admits server`);
    }
    const tables = await admin(db, () =>
      db.query(`select c.relname,c.relrowsecurity,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'select') as user_read
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname like 'kova_policy_%'`),
    );
    assert.ok(tables.rows.length > 0);
    for (const row of tables.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} enables RLS`);
      assert.equal(row.anon_read, false, `${row.relname} denies anon`);
      assert.equal(row.user_read, false, `${row.relname} denies browser users`);
    }
  } finally {
    await db.close();
  }
});

test("server lifecycle works without broad Auth table access and preserves that restriction", async () => {
  const db = await fixture();
  try {
    const authPrivileges = async () =>
      (
        await db.query(`select
        has_table_privilege('service_role','auth.users','select') as can_read,
        has_table_privilege('service_role','auth.users','update') as can_update`)
      ).rows[0];
    assert.deepEqual(await authPrivileges(), { can_read: false, can_update: false });
    await assert.rejects(db.query("select id from auth.users"), /permission denied/u);
    await mapped(db);
    assert.equal((await rpc(db, "kova_policy_account_status", [USER])).state, "active");
    assert.deepEqual(await authPrivileges(), { can_read: false, can_update: false });
    const helpers = await admin(db, () =>
      db.query(`select p.proname,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',p.oid,'execute') as user_execute,
        has_function_privilege('service_role',p.oid,'execute') as server_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='kova_private' and p.proname like 'kova_policy_%'`),
    );
    assert.equal(helpers.rows.length, 4);
    for (const row of helpers.rows) {
      assert.equal(row.anon_execute, false, `${row.proname} denies anon`);
      assert.equal(row.user_execute, false, `${row.proname} denies browser users`);
      assert.equal(row.server_execute, true, `${row.proname} admits server`);
      assert.deepEqual(row.proconfig, ['search_path=""']);
    }
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("unknown remote customer outcome remains one durable identity after the provider idempotency window", async () => {
  const db = await fixture();
  try {
    const first = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    await admin(db, () =>
      db.query(
        `update public.kova_policy_customer_bindings
      set requested_at=now()-interval '2 days' where user_id=$1 and environment='live'`,
        [USER],
      ),
    );
    const aged = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    assert.equal(aged.requestId, first.requestId);
    assert.equal(aged.state, "pending");
    assert.ok(Date.now() - Date.parse(aged.requestedAt) > 24 * 3600_000);
    assert.equal(
      (await db.query("select count(*)::int as n from public.kova_policy_customer_bindings"))
        .rows[0].n,
      1,
    );
    await rpc(db, "kova_policy_complete_customer", [USER, "live", aged.requestId, "cus_One"]);
    assert.equal(
      (await rpc(db, "kova_policy_claim_customer", [USER, "live"])).customerId,
      "cus_One",
    );
  } finally {
    await db.close();
  }
});

test("unknown checkout outcome cannot expire itself or regain intro eligibility merely by aging", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const first = await checkout(db);
    await admin(db, () =>
      db.query(
        `update public.kova_policy_checkout_claims
      set requested_at=now()-interval '2 days',expires_at=now()-interval '47 hours'
      where id=$1`,
        [first.claimId],
      ),
    );
    let returned;
    try {
      returned = await checkout(db);
    } catch {
      /* Refusal is safe; replacement is not. */
    }
    if (returned) assert.equal(returned.claimId, first.claimId);
    const rows = (
      await db.query("select id,state from public.kova_policy_checkout_claims where user_id=$1", [
        USER,
      ])
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.claimId);
    assert.equal(rows[0].state, "pending");
    const pending = await rpc(db, "kova_policy_pending_checkout", [USER]);
    assert.equal(pending.claimId, first.claimId);
  } finally {
    await db.close();
  }
});

test("equal-time webhook disagreement never invents an event-ID ordering that restores paid access", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const stamp = "2026-10-30T12:00:00Z";
    await apply(db, event({ id: "evt_A", status: "unpaid", createdAt: stamp }));
    try {
      const result = await apply(db, event({ id: "evt_Z", status: "active", createdAt: stamp }));
      assert.ok(["stale_ignored", "observed"].includes(result.outcome));
    } catch {
      /* A conflict requires authoritative reconciliation; no grant is safe. */
    }
    assert.equal(
      (await db.query("select status from public.subscriptions")).rows[0].status,
      "unpaid",
    );
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("invoice events cannot create subscriptions or cross a persisted customer ownership binding", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ type: "invoice.paid", kind: "invoice_status" }));
    assert.equal(
      (await db.query("select count(*)::int as n from public.subscriptions")).rows[0].n,
      0,
    );
    await apply(db, event({ id: "evt_Sub", createdAt: "2026-10-30T12:00:00Z" }));
    await mapped(db, OTHER, "cus_Two");
    await assert.rejects(
      apply(
        db,
        event({
          id: "evt_InvoiceOther",
          type: "invoice.paid",
          kind: "invoice_status",
          customer: "cus_Two",
          createdAt: "2026-10-30T13:00:00Z",
        }),
      ),
    );
    assert.equal(
      (await db.query("select stripe_customer_id from public.subscriptions")).rows[0]
        .stripe_customer_id,
      "cus_One",
    );
  } finally {
    await db.close();
  }
});

async function ageDeletion(db, user = USER) {
  return admin(db, () =>
    db.query(
      `update public.kova_policy_accounts
    set scheduled_at=now()-interval '31 days',recover_until=now()-interval '1 day'
    where user_id=$1`,
      [user],
    ),
  );
}

test("unresolved customer and checkout effects prevent account finalization after thirty days", async () => {
  const db = await fixture();
  try {
    const customer = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await ageDeletion(db);
    await assert.rejects(rpc(db, "kova_policy_begin_finalization", [USER]));
    // Resolve through an explicitly recovered account, never by force-releasing
    // an aged network outcome. Move its recovery window back only as test setup.
    await admin(db, () =>
      db.query(
        `update public.kova_policy_accounts
      set scheduled_at=now()-interval '1 day',recover_until=now()+interval '29 days'
      where user_id=$1`,
        [USER],
      ),
    );
    await rpc(db, "kova_policy_recover_deletion", [USER]);
    await rpc(db, "kova_policy_complete_customer", [USER, "live", customer.requestId, "cus_One"]);
    await checkout(db);
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await ageDeletion(db);
    await assert.rejects(rpc(db, "kova_policy_begin_finalization", [USER]));
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("finalization leases bind the owner and attempt; remote customer retirement is required before Auth removal", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await ageDeletion(db);
    assert.deepEqual(await rpc(db, "kova_policy_due_deletions", [1]), [USER]);
    const claim = await rpc(db, "kova_policy_begin_finalization", [USER]);
    assert.equal(claim.state, "finalizing");
    assert.match(claim.attemptId, /^[a-f0-9-]{36}$/u);
    assert.ok(Date.parse(claim.leaseUntil) > Date.now());
    assert.equal(claim.customers.length, 1);
    assert.equal(claim.customers[0].customerId, "cus_One");
    assert.equal(claim.customers[0].retiredAt, null);
    await assert.rejects(rpc(db, "kova_policy_recover_deletion", [USER]));
    await assert.rejects(rpc(db, "kova_policy_claim_customer", [USER, "live"]));
    await assert.rejects(checkout(db));
    await assert.rejects(rpc(db, "kova_policy_renew_finalization", [OTHER, claim.attemptId]));
    await assert.rejects(rpc(db, "kova_policy_renew_finalization", [USER, OTHER]));
    await assert.rejects(
      rpc(db, "kova_policy_ack_customer_retired", [USER, "sandbox", "cus_One", claim.attemptId]),
    );
    await assert.rejects(rpc(db, "kova_policy_confirm_finalization", [USER, claim.attemptId]));
    await assert.rejects(admin(db, () => db.query("delete from auth.users where id=$1", [USER])));
    assert.equal(
      await rpc(db, "kova_policy_ack_customer_retired", [USER, "live", "cus_One", claim.attemptId]),
      true,
    );
    assert.equal(
      await rpc(db, "kova_policy_ack_customer_retired", [USER, "live", "cus_One", claim.attemptId]),
      true,
    );
    assert.equal(await rpc(db, "kova_policy_confirm_finalization", [USER, claim.attemptId]), true);
    await admin(db, () => db.query("delete from auth.users where id=$1", [USER]));
    assert.equal(await authCount(db), 0);
  } finally {
    await db.close();
  }
});

test("expired finalization attempt cannot authorize later cleanup; a fresh claim fences the previous attempt", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await ageDeletion(db);
    const first = await rpc(db, "kova_policy_begin_finalization", [USER]);
    await admin(db, () =>
      db.query(
        "update public.kova_policy_accounts set lease_until=now()-interval '1 minute' where user_id=$1",
        [USER],
      ),
    );
    await assert.rejects(rpc(db, "kova_policy_renew_finalization", [USER, first.attemptId]));
    await assert.rejects(
      rpc(db, "kova_policy_ack_customer_retired", [USER, "live", "cus_One", first.attemptId]),
    );
    const second = await rpc(db, "kova_policy_begin_finalization", [USER]);
    assert.notEqual(second.attemptId, first.attemptId);
    await assert.rejects(rpc(db, "kova_policy_confirm_finalization", [USER, first.attemptId]));
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("retired customer tombstones and deleted account UUIDs cannot regain paid access from delayed webhooks", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event());
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await ageDeletion(db);
    const claim = await rpc(db, "kova_policy_begin_finalization", [USER]);
    await rpc(db, "kova_policy_ack_customer_retired", [USER, "live", "cus_One", claim.attemptId]);
    await rpc(db, "kova_policy_confirm_finalization", [USER, claim.attemptId]);
    await admin(db, () => db.query("delete from auth.users where id=$1", [USER]));
    const late = await apply(db, event({ id: "evt_Late", createdAt: new Date().toISOString() }));
    assert.equal(late.outcome, "orphaned");
    assert.equal(
      (await db.query("select count(*)::int as n from public.subscriptions")).rows[0].n,
      0,
    );
    await admin(db, () => db.query("insert into auth.users(id) values($1)", [USER]));
    await assert.rejects(rpc(db, "kova_policy_claim_customer", [USER, "live"]));
    const otherClaim = await rpc(db, "kova_policy_claim_customer", [OTHER, "live"]);
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [OTHER, "live", otherClaim.requestId, "cus_One"]),
    );
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("readiness refuses an exposed privileged routine and a missing canonical tier authority", async () => {
  const db = await fixture();
  try {
    await admin(db, () =>
      db.exec("grant execute on function public.kova_policy_claim_customer(uuid,text) to anon"),
    );
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, false);
    await admin(db, () =>
      db.exec("revoke execute on function public.kova_policy_claim_customer(uuid,text) from anon"),
    );
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, true);
    await admin(db, () =>
      db.exec(
        "alter function public.effective_user_plan_tier(uuid) rename to missing_effective_tier",
      ),
    );
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, false);
  } finally {
    await db.close();
  }
});

test("checkout refuses an unattested customer, sandbox live-price mismatch and changed session expiry", async () => {
  const db = await fixture();
  try {
    await assert.rejects(checkout(db));
    await mapped(db);
    await mapped(db, USER, "cus_Sandbox", "sandbox");
    await assert.rejects(checkout(db, { environment: "sandbox" }));
    const claim = await checkout(db);
    await assert.rejects(
      rpc(db, "kova_policy_attach_checkout", [
        USER,
        "live",
        claim.claimId,
        "cs_One",
        new Date(Date.parse(claim.expiresAt) + 60_000).toISOString(),
      ]),
    );
    assert.equal(
      (await rpc(db, "kova_policy_checkout_status", [USER, "live", claim.claimId])).sessionId,
      null,
    );
    await attach(db, claim);
  } finally {
    await db.close();
  }
});

test("first policy webhook cannot regress a previously persisted canonical subscription observation", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await admin(db, () =>
      db.query(
        `insert into public.subscriptions
      (user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
       current_period_start,current_period_end,environment,last_stripe_event_created_at,last_stripe_event_id)
      values($1,'sub_One','cus_One','prod_VB1Crlvg4utbCe',$2,'unpaid',
       now()-interval '1 day',now()+interval '1 day','live','2026-10-30T12:00:00Z','evt_CanonicalNew')`,
        [USER, PLUS],
      ),
    );
    let result;
    try {
      result = await apply(
        db,
        event({ id: "evt_FirstPolicyOld", createdAt: "2026-10-30T11:00:00Z" }),
      );
    } catch {
      /* A reconciliation hold is safe; applying an older state is not. */
    }
    if (result) assert.ok(["stale_ignored", "observed"].includes(result.outcome));
    const row = (await db.query("select status,last_stripe_event_id from public.subscriptions"))
      .rows[0];
    assert.equal(row.status, "unpaid");
    assert.equal(row.last_stripe_event_id, "evt_CanonicalNew");
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("a legacy writer advancing beyond policy history cannot be regressed by an intermediate policy webhook", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ id: "evt_PolicyBaseline", createdAt: "2026-10-30T10:00:00Z" }));
    await admin(db, () =>
      db.query(`update public.subscriptions set status='unpaid',
        last_stripe_event_created_at='2026-10-30T12:00:00Z',last_stripe_event_id='evt_LegacyWriterNew'
        where stripe_subscription_id='sub_One'`),
    );
    let result;
    try {
      result = await apply(
        db,
        event({ id: "evt_IntermediatePolicy", createdAt: "2026-10-30T11:00:00Z" }),
      );
    } catch {
      // A reconciliation hold is safe; stale policy history cannot grant access.
    }
    if (result) assert.ok(["stale_ignored", "observed"].includes(result.outcome));
    const persisted = (
      await db.query(`select status,last_stripe_event_id
      from public.subscriptions where stripe_subscription_id='sub_One'`)
    ).rows[0];
    assert.deepEqual(persisted, { status: "unpaid", last_stripe_event_id: "evt_LegacyWriterNew" });
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("portal customer lookup remains account/environment scoped and is fenced when deletion is scheduled", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await mapped(db, OTHER, "cus_Other");
    await mapped(db, USER, "cus_Sandbox", "sandbox");
    assert.deepEqual(await rpc(db, "kova_policy_customer_for_portal", [USER, "live"]), {
      customerId: "cus_One",
    });
    assert.deepEqual(await rpc(db, "kova_policy_customer_for_portal", [USER, "sandbox"]), {
      customerId: "cus_Sandbox",
    });
    assert.deepEqual(await rpc(db, "kova_policy_customer_for_portal", [OTHER, "live"]), {
      customerId: "cus_Other",
    });
    assert.deepEqual(await rpc(db, "kova_policy_customer_for_portal", [MEMBER, "live"]), {
      customerId: null,
    });
    await assert.rejects(rpc(db, "kova_policy_customer_for_portal", [USER, "production"]));
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    await assert.rejects(rpc(db, "kova_policy_customer_for_portal", [USER, "live"]));
    await rpc(db, "kova_policy_recover_deletion", [USER]);
    assert.equal(
      (await rpc(db, "kova_policy_customer_for_portal", [USER, "live"])).customerId,
      "cus_One",
    );
  } finally {
    await db.close();
  }
});

test("recovery uses exactly 720 elapsed hours across DST and closes before a bounded finalizer selects the account", async () => {
  const db = await fixture();
  try {
    await db.exec("set time zone 'America/New_York'");
    const scheduled = await rpc(db, "kova_policy_schedule_deletion", [USER]);
    assert.equal(
      Date.parse(scheduled.recoverUntil) - Date.parse(scheduled.scheduledAt),
      720 * 3600000,
    );
    for (const limit of [null, 0, 3])
      await assert.rejects(rpc(db, "kova_policy_due_deletions", [limit]));
    await admin(db, () =>
      db.query(
        `update public.kova_policy_accounts
      set scheduled_at=now()-interval '720 hours',recover_until=now() where user_id=$1`,
        [USER],
      ),
    );
    await assert.rejects(rpc(db, "kova_policy_recover_deletion", [USER]));
    assert.deepEqual(await rpc(db, "kova_policy_due_deletions", [1]), [USER]);
    assert.equal((await rpc(db, "kova_policy_begin_finalization", [USER])).state, "finalizing");
    assert.deepEqual(await rpc(db, "kova_policy_due_deletions", [1]), []);
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("webhook retry with a fresh request correlation remains the same processed provider event", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    const original = event({ correlationId: OTHER });
    await apply(db, original);
    const retry = await apply(db, { ...original, correlationId: MEMBER });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.outcome, "already_processed");
    assert.equal(
      (await db.query("select count(*)::int as n from public.subscriptions")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from public.kova_policy_event_receipts")).rows[0]
        .n,
      1,
    );
  } finally {
    await db.close();
  }
});

for (const terminal of ["canceled", "incomplete_expired"]) {
  test(`a later active event cannot resurrect a previously persisted terminal ${terminal} subscription`, async () => {
    const db = await fixture();
    try {
      await mapped(db);
      await admin(db, () =>
        db.query(
          `insert into public.subscriptions
        (user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
         current_period_start,current_period_end,environment,last_stripe_event_created_at,last_stripe_event_id)
        values($1,'sub_One','cus_One','prod_VB1Crlvg4utbCe',$2,$3,
         now()-interval '2 days',now()-interval '1 day','live','2026-10-30T12:00:00Z','evt_Terminal')`,
          [USER, PLUS, terminal],
        ),
      );
      let result;
      try {
        result = await apply(
          db,
          event({ id: "evt_UnexpectedActive", createdAt: "2026-10-30T13:00:00Z" }),
        );
      } catch {
        /* A held conflict must be reconciled; it cannot grant access. */
      }
      if (result) assert.ok(["stale_ignored", "observed"].includes(result.outcome));
      const row = (await db.query("select status,last_stripe_event_id from public.subscriptions"))
        .rows[0];
      assert.equal(row.status, terminal);
      assert.equal(row.last_stripe_event_id, "evt_Terminal");
      assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
    } finally {
      await db.close();
    }
  });
}

test("scheduling deletion does not prevent reconciliation of a previously issued customer creation claim", async () => {
  const db = await fixture();
  try {
    const pending = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    await rpc(db, "kova_policy_schedule_deletion", [USER]);
    assert.equal(
      await rpc(db, "kova_policy_complete_customer", [USER, "live", pending.requestId, "cus_One"]),
      "cus_One",
    );
    assert.equal(
      await rpc(db, "kova_policy_complete_customer", [USER, "live", pending.requestId, "cus_One"]),
      "cus_One",
    );
    await assert.rejects(rpc(db, "kova_policy_claim_customer", [USER, "sandbox"]));
    await assert.rejects(
      rpc(db, "kova_policy_complete_customer", [USER, "live", OTHER, "cus_Another"]),
    );
    assert.equal((await rpc(db, "kova_policy_account_status", [USER])).state, "scheduled");
    await rpc(db, "kova_policy_recover_deletion", [USER]);
    assert.equal(
      (await rpc(db, "kova_policy_claim_customer", [USER, "live"])).customerId,
      "cus_One",
    );
  } finally {
    await db.close();
  }
});

test("an expired local subscription does not permanently block checkout after authoritative provider reconciliation", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await admin(db, () =>
      db.query(
        `insert into public.subscriptions
      (user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
       current_period_start,current_period_end,environment)
      values($1,'sub_ExpiredLocal','cus_One','prod_VB1Crlvg4utbCe',$2,'active',
       now()-interval '2 days',now()-interval '1 day','live')`,
        [USER, PLUS],
      ),
    );
    const claim = await checkout(db);
    assert.equal(claim.state, "pending");
    assert.equal(claim.customerId, "cus_One");
    // The DB permission is not evidence that a provider subscription scan ran.
    // Actual Stripe calls remain covered by the separate application adapter.
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
  } finally {
    await db.close();
  }
});

test("a paid invoice lacking current subscription evidence cannot restore an unpaid subscription's access", async () => {
  const db = await fixture();
  try {
    await mapped(db);
    await apply(db, event({ status: "unpaid", createdAt: "2026-10-30T12:00:00Z" }));
    try {
      await apply(
        db,
        event({
          id: "evt_OldInvoicePaidLate",
          type: "invoice.paid",
          kind: "invoice_status",
          status: "active",
          createdAt: "2026-10-30T13:00:00Z",
        }),
      );
    } catch {
      /* Require authoritative subscription evidence before granting. */
    }
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
    assert.equal(
      (await db.query("select status from public.subscriptions")).rows[0].status,
      "unpaid",
    );
  } finally {
    await db.close();
  }
});

test("readiness does not claim an operational backend after required server table privileges are revoked", async () => {
  const db = await fixture();
  try {
    await admin(db, () =>
      db.exec("revoke update on public.kova_policy_checkout_claims from service_role"),
    );
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, false);
  } finally {
    await db.close();
  }
});

for (const [name, mutation, expected] of [
  [
    "changed canonical authority body",
    "create or replace function public.effective_user_plan_tier(_user_id uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$ select 'free'::text $$",
    /monthly_policy_tier_authority_drift/u,
  ],
  [
    "changed canonical authority search path",
    "alter function public.effective_user_plan_tier(uuid) set search_path=pg_catalog",
    /monthly_policy_tier_authority_drift/u,
  ],
  [
    "an unexpected billing column",
    "alter table public.subscriptions add column unreviewed text",
    /monthly_policy_required_table_drift/u,
  ],
  [
    "revoked server update privilege",
    "revoke update on public.subscriptions from service_role",
    /monthly_policy_required_table_privilege_drift/u,
  ],
  [
    "disabled billing row security",
    "alter table public.subscriptions disable row level security",
    /monthly_policy_required_table_drift/u,
  ],
  [
    "a missing subscription identity key",
    "alter table public.subscriptions drop constraint subscriptions_stripe_subscription_id_key",
    /monthly_policy_required_key_drift/u,
  ],
  [
    "browser execute on a paid-tier authority",
    "grant execute on function public.billing_user_plan_tier(uuid) to anon",
    /monthly_policy_tier_authority_drift/u,
  ],
  [
    "missing existing private-schema usage",
    "revoke usage on schema kova_private from service_role",
    /monthly_policy_private_schema_access_missing/u,
  ],
]) {
  test(`installation rejects ${name} atomically before installing lifecycle objects`, async () => {
    const db = await fixture({
      beforeInstall: (connection) => connection.exec(mutation),
      installationError: expected,
    });
    try {
      assert.equal(
        (
          await db.query(`select count(*)::int as n from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname like 'kova_policy_%'`)
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(`select count(*)::int as n from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','kova_private') and p.proname like 'kova_policy_%'`)
        ).rows[0].n,
        0,
      );
      assert.equal(await authCount(db), 1);
    } finally {
      await db.close();
    }
  });
}

test("installation preserves existing billing/event/fence rows and creates no customer or paid-plan grant", async () => {
  let before;
  const snapshot = `select jsonb_build_object(
    'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
    'events',(select jsonb_agg(to_jsonb(e) order by e.event_id) from public.processed_stripe_events e),
    'fences',(select jsonb_agg(to_jsonb(f) order by f.user_id) from public.account_deletion_fences f)
  ) as value`;
  const db = await fixture({
    beforeInstall: async (connection) => {
      await connection.query(
        `insert into public.subscriptions
        (user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
          current_period_start,current_period_end,environment)
        values($1,'sub_Existing','cus_Existing','prod_VB1Cbp01TZ8hOI',$2,'active',
          now()-interval '1 day',now()+interval '1 day','live')`,
        [USER, PRO],
      );
      await connection.query(`insert into public.processed_stripe_events(event_id,type,environment)
        values('evt_Existing','customer.subscription.updated','live')`);
      await connection.query("insert into public.account_deletion_fences(user_id) values($1)", [
        OTHER,
      ]);
      before = (await connection.query(snapshot)).rows[0].value;
    },
  });
  try {
    assert.deepEqual((await db.query(snapshot)).rows[0].value, before);
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "pro");
    assert.equal(await rpc(db, "billing_user_plan_tier", [MEMBER]), "free");
    assert.equal(
      (await db.query("select count(*)::int as n from public.kova_policy_accounts")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from public.kova_policy_customer_bindings"))
        .rows[0].n,
      0,
    );
    await assert.rejects(rpc(db, "kova_policy_claim_customer", [OTHER, "live"]));
    assert.deepEqual((await db.query(snapshot)).rows[0].value, before);
  } finally {
    await db.close();
  }
});

test("an exact unused installation qualifies and its guarded rollback preserves legacy authorities and supports reinstall", async () => {
  const db = await fixture();
  try {
    const qualification = await qualifyUnused(db);
    assert.equal(Object.isFrozen(qualification), true);
    assert.equal(qualification.sourceSha256, migrationSha256);
    assert.equal(qualification.used, false);
    assert.match(qualification.baselineSha256, /^[a-f0-9]{64}$/u);
    assert.match(qualification.catalogSha256, /^[a-f0-9]{64}$/u);
    const rollback = await unusedMonthlyLifecycleRollback(qualification);
    await admin(db, () => db.exec(rollback));
    assert.equal(
      (await db.query("select to_regclass('public.kova_policy_accounts') as value")).rows[0].value,
      null,
    );
    assert.equal(await authCount(db), 1);
    assert.equal(await rpc(db, "billing_user_plan_tier", [USER]), "free");
    await admin(db, () => db.exec(migrationSource));
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, true);
    assert.equal((await qualifyUnused(db)).baselineSha256, qualification.baselineSha256);
  } finally {
    await db.close();
  }
});

test("a durable customer claim prevents qualification and stops a previously prepared unused rollback", async () => {
  const db = await fixture();
  try {
    const qualification = await qualifyUnused(db);
    const claim = await rpc(db, "kova_policy_claim_customer", [USER, "live"]);
    await assert.rejects(qualifyUnused(db), /monthly_lifecycle_installation_used/u);
    await expectRollbackRejected(db, qualification, /monthly_lifecycle_installation_used/u);
    assert.equal(
      (await rpc(db, "kova_policy_claim_customer", [USER, "live"])).requestId,
      claim.requestId,
    );
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("unused rollback refuses changed lifecycle objects and changed existing catalog without removing either", async () => {
  const db = await fixture();
  try {
    const qualification = await qualifyUnused(db);
    await admin(db, () =>
      db.exec("revoke update on public.kova_policy_accounts from service_role"),
    );
    await expectRollbackRejected(db, qualification, /monthly_lifecycle_object_catalog_changed/u);
    assert.equal(
      (await db.query("select to_regclass('public.kova_policy_accounts') is not null as value"))
        .rows[0].value,
      true,
    );
    await admin(db, () => db.exec("grant update on public.kova_policy_accounts to service_role"));
    const restored = await qualifyUnused(db);
    await admin(db, () =>
      db.exec("alter table public.subscriptions add column independently_changed text"),
    );
    await expectRollbackRejected(db, restored, /monthly_lifecycle_existing_catalog_changed/u);
    assert.equal(
      (
        await db.query(`select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='subscriptions' and column_name='independently_changed'`)
      ).rows[0].n,
      1,
    );
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("rollback source binding rejects forged, used or unqualified records before generating SQL", async () => {
  const db = await fixture();
  try {
    const qualification = await qualifyUnused(db);
    for (const forged of [
      null,
      { ...qualification, sourceSha256: "0".repeat(64) },
      { ...qualification, used: true },
      { ...qualification, baselineSha256: "invalid" },
      { ...qualification, catalogSha256: "');drop table auth.users;--" },
    ])
      await assert.rejects(
        unusedMonthlyLifecycleRollback(forged),
        /monthly_lifecycle_rollback_qualification_invalid/u,
      );
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

test("fresh preflight is read only, source bound and rejects a lifecycle already installed", async () => {
  const preflight = await monthlyLifecyclePreflight();
  assert.equal(preflight.sourceSha256, migrationSha256);
  assert.match(preflight.sql, /begin read only;/u);
  assert.match(preflight.sql, /rollback;\s*$/u);
  const db = await fixture();
  try {
    await admin(db, async () => {
      await assert.rejects(
        db.exec(preflight.sql),
        /monthly_policy_partial_installation_requires_review/u,
      );
      await db.exec("rollback");
    });
    assert.equal((await rpc(db, "kova_policy_readiness")).ready, true);
    assert.equal(await authCount(db), 1);
  } finally {
    await db.close();
  }
});

// Optional native contention qualification. Nothing connects unless the
// operator explicitly supplies all three settings below. The target must be a
// dedicated local PG17 cluster, with existing anon/authenticated/service_role
// roles, data_directory=/tmp/kova-monthly-native-pg17-<16+ hex>/data, and an empty
// postgres database. This harness creates a random template0 database and only
// drops that newly created database. It never creates or changes cluster roles.
// KOVA_MONTHLY_NATIVE_ENABLE=disposable-loopback-pg17
// KOVA_MONTHLY_NATIVE_PG17_URL=postgresql://postgres:<local password>@127.0.0.1:<port>/postgres
// KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID=<independently checked pg_control_system ID>
const { spawn: spawnNativePsql, spawnSync: inspectNativePsql } = await import("node:child_process");
const { randomBytes: nativeRandomBytes } = await import("node:crypto");
const nativeKeys = [
  "KOVA_MONTHLY_NATIVE_ENABLE",
  "KOVA_MONTHLY_NATIVE_PG17_URL",
  "KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID",
];
const nativeRequested = nativeKeys.some((key) => process.env[key] !== undefined);
const nativeOptions = {
  timeout: 45000,
  skip: nativeRequested
    ? false
    : "NOT RUN: native PG17 contention requires an explicit disposable loopback target",
};

function nativeSettings(environment) {
  const refuse = () => {
    throw new Error("native_pg17_disposable_loopback_target_required");
  };
  if (environment.KOVA_MONTHLY_NATIVE_ENABLE !== "disposable-loopback-pg17") refuse();
  let url;
  try {
    url = new URL(environment.KOVA_MONTHLY_NATIVE_PG17_URL);
  } catch {
    refuse();
  }
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  const query = [...url.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "::1"].includes(host) ||
    url.username !== "postgres" ||
    url.pathname !== "/postgres" ||
    url.hash ||
    !/^\d+$/u.test(url.port) ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65535 ||
    (query.length !== 0 &&
      !(query.length === 1 && query[0][0] === "sslmode" && query[0][1] === "disable")) ||
    !/^\d{10,24}$/u.test(environment.KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID ?? "")
  )
    refuse();
  let password;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    refuse();
  }
  if (password.includes("\0")) refuse();
  return {
    host,
    port: url.port,
    password,
    systemId: environment.KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID,
  };
}

function nativeSession(settings, database, applicationName, signal) {
  assert.match(database, /^(postgres|kova_monthly_native_[a-f0-9]{20})$/u);
  const environment = Object.fromEntries(
    ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  Object.assign(environment, {
    PGHOST: settings.host,
    PGHOSTADDR: settings.host,
    PGPORT: settings.port,
    PGUSER: "postgres",
    PGPASSWORD: settings.password,
    PGDATABASE: database,
    PGPASSFILE: "/dev/null",
    PGSSLMODE: "disable",
    PGGSSENCMODE: "disable",
    PGCONNECT_TIMEOUT: "3",
    PGAPPNAME: applicationName,
    PGOPTIONS:
      "-c statement_timeout=5000 -c lock_timeout=4000 -c TimeZone=UTC -c standard_conforming_strings=on",
  });
  // The URL/password never enter argv, psql interpolation or failure messages.
  const child = spawnNativePsql(
    "psql",
    [
      "-X",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--set",
      "VERBOSITY=sqlstate",
    ],
    { env: environment, stdio: ["pipe", "pipe", "pipe"], ...(signal ? { signal } : {}) },
  );
  let buffer = "";
  let pending = null;
  let failure = null;
  let ended = false;
  let outputBytes = 0;
  let diagnosticBytes = 0;
  const fail = (code) => {
    failure ??= new Error(code);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(failure);
      pending = null;
    }
  };
  child.on("error", () => fail("native_pg17_psql_unavailable"));
  child.on("close", () => {
    ended = true;
    fail("native_pg17_session_closed_before_result");
  });
  child.stdin.on("error", () => fail("native_pg17_session_input_failed"));
  child.stderr.on("data", (chunk) => {
    diagnosticBytes += chunk.length;
    if (diagnosticBytes > 65536) {
      fail("native_pg17_diagnostic_bound_exceeded");
      child.kill("SIGKILL");
    }
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > 2 * 1024 * 1024) {
      fail("native_pg17_output_bound_exceeded");
      child.kill("SIGKILL");
      return;
    }
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      if (!pending) {
        fail("native_pg17_unexpected_result");
        child.kill("SIGKILL");
        return;
      }
      const operation = pending;
      pending = null;
      clearTimeout(operation.timer);
      try {
        operation.resolve(JSON.parse(line));
      } catch {
        fail("native_pg17_non_json_result");
        operation.reject(failure);
      }
    }
  });
  return {
    request(sql) {
      if (failure) return Promise.reject(failure);
      assert.equal(pending, null, "one request per independent psql session");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail("native_pg17_request_deadline_exceeded");
          child.kill("SIGKILL");
        }, 7500);
        pending = { resolve, reject, timer };
        child.stdin.write(`${sql}\n`);
      });
    },
    async close() {
      if (ended) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end("\\q\n");
      });
    },
  };
}

async function nativeCommand(settings, database, sql, label = "operator", signal) {
  const session = nativeSession(settings, database, label, signal);
  try {
    return await session.request(sql);
  } finally {
    await session.close();
  }
}
const nativeJson = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const nativeRpc = (expression) =>
  `select jsonb_build_object('backend',pg_backend_pid(),'value',${expression});`;
function nativePending(session, sql) {
  const operation = session.request(sql);
  // A barrier failure must still reach finally and clean up the disposable DB.
  // The original promise remains awaited on the successful contention path.
  operation.catch(() => {});
  return operation;
}

async function nativeFixture(testContext, action) {
  const settings = nativeSettings(process.env);
  const client = inspectNativePsql("psql", ["--version"], {
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 4096,
    env: { PATH: process.env.PATH, LANG: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(
    client.status === 0 && /^psql \(PostgreSQL\) 17\.\d+[^\r\n]*\r?\n?$/u.test(client.stdout),
    "native_pg17_client_required",
  );
  const identity = await nativeCommand(
    settings,
    "postgres",
    `select jsonb_build_object(
    'version',current_setting('server_version_num')::int,'user',current_user,
    'systemId',(select system_identifier::text from pg_control_system()),
    'dataDirectory',current_setting('data_directory'),'address',inet_server_addr()::text,
    'port',inet_server_port(),'superuser',(select rolsuper from pg_roles where rolname=current_user),
    'roles',(select count(*)=3 and bool_and(not rolsuper and (rolname<>'service_role' or rolbypassrls))
      from pg_roles where rolname in ('anon','authenticated','service_role')),
    'empty',not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('auth','public')) and not exists(select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public'))
  );`,
    "identity",
    testContext.signal,
  );
  assert.ok(identity.version >= 170000 && identity.version < 180000, "native PG17 is mandatory");
  assert.equal(identity.user, "postgres");
  assert.equal(identity.superuser, true);
  assert.equal(identity.systemId, settings.systemId, "independently pinned local cluster");
  assert.match(identity.dataDirectory, /^\/tmp\/kova-monthly-native-pg17-[a-f0-9]{16,64}\/data$/u);
  assert.equal(identity.address, settings.host);
  assert.equal(identity.port, Number(settings.port));
  assert.equal(identity.roles, true, "pre-existing synthetic roles; this test cannot create roles");
  assert.equal(identity.empty, true, "operator database has no Auth/application objects");
  const database = `kova_monthly_native_${nativeRandomBytes(10).toString("hex")}`;
  const sessions = [];
  let created = false;
  try {
    await nativeCommand(
      settings,
      "postgres",
      `create database ${database} with template template0;
      select jsonb_build_object('created',true);`,
      "create",
      testContext.signal,
    );
    created = true;
    const blank = await nativeCommand(
      settings,
      database,
      `select jsonb_build_object('empty',
      not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('auth','public')) and not exists(select 1 from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public')));`,
      "blank",
      testContext.signal,
    );
    assert.equal(blank.empty, true, "fresh template0 target must have no application objects");
    // Reuse the exact synthetic table setup from the frozen embedded fixture.
    // Strip only the three global CREATE ROLE statements; never alter roles.
    const captured = fixture.toString().match(/await db\.exec\(`([\s\S]*?)`\);/u);
    assert.ok(captured, "reviewed fixture setup is available");
    let removed = 0;
    let setup = captured[1].replace(
      /\s*create role (?:anon|authenticated|service_role)(?: bypassrls)?;/gu,
      () => {
        removed += 1;
        return "";
      },
    );
    assert.equal(removed, 3);
    setup = setup.replace(
      /\$\{(USER|OTHER|MEMBER)\}/gu,
      (_, key) => ({ USER, OTHER, MEMBER })[key],
    );
    assert.doesNotMatch(setup, /\$\{|\b(?:create|alter|drop)\s+role\b/iu);
    setup += `\ninsert into public.billing_plan_tiers values
      ('live','${PLUS}','plus_monthly','plus'),('live','${PRO}','pro_monthly','pro'),
      ('live','${OLD_PRO}','pro_monthly','pro');\n`;
    const canonical = await readFile(CANONICAL, "utf8");
    const summarySource = await readFile(SUMMARY_FORWARD, "utf8");
    for (const name of [
      "billing_user_plan_tier",
      "effective_user_plan_tier",
      "user_subscription_summary",
    ]) {
      const match = (name === "user_subscription_summary" ? summarySource : canonical).match(
        new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "u"),
      );
      assert.ok(match);
      setup += `${match[0]}\nrevoke all on function public.${name}(uuid) from public,anon,authenticated;
        grant execute on function public.${name}(uuid) to service_role;\n`;
    }
    await nativeCommand(
      settings,
      database,
      `${setup}\n${migrationSource}\nselect jsonb_build_object('installed',true);`,
      "install",
      testContext.signal,
    );
    const context = {
      database,
      async command(sql) {
        return nativeCommand(settings, database, sql, "operator", testContext.signal);
      },
      async session(label) {
        const applicationName = `${database}_${label}`;
        const connection = nativeSession(settings, database, applicationName, testContext.signal);
        sessions.push(connection);
        const identity = await connection.request(
          "set role service_role;select jsonb_build_object('backend',pg_backend_pid());",
        );
        return { ...connection, applicationName, backend: identity.backend };
      },
      async waitForLock(applicationName) {
        assert.match(applicationName, /^kova_monthly_native_[a-f0-9]{20}_[a-z]+$/u);
        await nativeCommand(
          settings,
          database,
          `do $$ declare deadline timestamptz:=clock_timestamp()+interval '2 seconds';
          begin loop
            if exists(select 1 from pg_stat_activity where datname=current_database()
              and application_name='${applicationName}' and wait_event_type='Lock') then return;end if;
            if clock_timestamp()>deadline then raise exception 'native_contention_not_observed';end if;
            perform pg_sleep(0.02);
          end loop;end;$$;select jsonb_build_object('waiting',true);`,
          "barrier",
          testContext.signal,
        );
      },
      async mapCustomer() {
        await this.command(`set role service_role;do $$ declare claim jsonb;begin
          claim:=public.kova_policy_claim_customer('${USER}','live');
          perform public.kova_policy_complete_customer('${USER}','live',(claim->>'requestId')::uuid,'cus_One');
          end;$$;select jsonb_build_object('mapped',true);`);
      },
    };
    await action(context);
    testContext.diagnostic(
      `NATIVE CONTENTION VERIFIED: PG${identity.version}; two independent psql backends; disposable database ${database}`,
    );
  } finally {
    await Promise.allSettled(sessions.map((session) => session.close()));
    if (created)
      await nativeCommand(
        settings,
        "postgres",
        `drop database ${database} with (force);
        select jsonb_build_object('removed',true);`,
      );
  }
}

test("native target guard rejects production-like, incomplete and unpinned configuration before starting psql", () => {
  const local = {
    KOVA_MONTHLY_NATIVE_ENABLE: "disposable-loopback-pg17",
    KOVA_MONTHLY_NATIVE_PG17_URL: "postgresql://postgres:synthetic@127.0.0.1:55432/postgres",
    KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID: "1234567890123456789",
  };
  assert.equal(nativeSettings(local).host, "127.0.0.1");
  for (const invalid of [
    {},
    { ...local, KOVA_MONTHLY_NATIVE_ENABLE: undefined },
    { ...local, KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID: undefined },
    {
      ...local,
      KOVA_MONTHLY_NATIVE_PG17_URL: "postgresql://postgres:synthetic@db.example.com:5432/postgres",
    },
    {
      ...local,
      KOVA_MONTHLY_NATIVE_PG17_URL: "postgresql://postgres:synthetic@127.0.0.1:55432/production",
    },
    {
      ...local,
      KOVA_MONTHLY_NATIVE_PG17_URL: `${local.KOVA_MONTHLY_NATIVE_PG17_URL}?host=db.example.com`,
    },
    {
      ...local,
      KOVA_MONTHLY_NATIVE_PG17_URL: `${local.KOVA_MONTHLY_NATIVE_PG17_URL}?options=-csearch_path=public`,
    },
  ])
    assert.throws(
      () => nativeSettings(invalid),
      /native_pg17_disposable_loopback_target_required/u,
    );
});

test(
  "native PG17 independent checkout claims contend and converge on one durable Session identity",
  nativeOptions,
  async (t) => {
    await nativeFixture(t, async (context) => {
      await context.mapCustomer();
      const a = await context.session("a");
      const b = await context.session("b");
      assert.notEqual(a.backend, b.backend);
      const expression = `public.kova_policy_claim_checkout('${USER}','live','${PLUS}','intro50','${RETURN}')`;
      const first = await a.request(`begin;${nativeRpc(expression)}`);
      const pending = nativePending(b, nativeRpc(expression));
      await context.waitForLock(b.applicationName);
      await a.request("commit;select jsonb_build_object('committed',true);");
      const second = await pending;
      assert.equal(first.value.claimId, second.value.claimId);
      assert.equal(first.value.idempotencyKey, second.value.idempotencyKey);
      assert.equal(first.value.introEligible, true);
      const count = await context.command(
        "select jsonb_build_object('claims',(select count(*) from public.kova_policy_checkout_claims));",
      );
      assert.equal(count.claims, 1);
    });
  },
);

test(
  "native PG17 duplicate and out-of-order webhook projections serialize without resurrecting access",
  nativeOptions,
  async (t) => {
    await nativeFixture(t, async (context) => {
      await context.mapCustomer();
      const a = await context.session("a");
      const b = await context.session("b");
      assert.notEqual(a.backend, b.backend);
      const original = event({ createdAt: "2026-10-30T10:00:00Z" });
      const expression = (value) =>
        `public.kova_policy_apply_legacy_event('live',${nativeJson(value)})`;
      await a.request(`begin;${nativeRpc(expression(original))}`);
      const duplicate = nativePending(b, nativeRpc(expression(original)));
      await context.waitForLock(b.applicationName);
      await a.request("commit;select jsonb_build_object('committed',true);");
      assert.equal((await duplicate).value.duplicate, true);
      const newer = event({ id: "evt_Newer", status: "unpaid", createdAt: "2026-10-30T12:00:00Z" });
      const older = event({ id: "evt_Older", createdAt: "2026-10-30T11:00:00Z" });
      await a.request(`begin;${nativeRpc(expression(newer))}`);
      const stale = nativePending(b, nativeRpc(expression(older)));
      await context.waitForLock(b.applicationName);
      await a.request("commit;select jsonb_build_object('committed',true);");
      assert.equal((await stale).value.outcome, "stale_ignored");
      const state = await context.command(`set role service_role;select jsonb_build_object(
      'tier',public.billing_user_plan_tier('${USER}'),
      'subscriptions',(select count(*) from public.subscriptions),
      'events',(select count(*) from public.kova_policy_event_receipts));`);
      assert.deepEqual(state, { tier: "free", subscriptions: 1, events: 3 });
    });
  },
);

test(
  "native PG17 customer creation, scheduling and finalization share one account fence without losing an in-flight claim",
  nativeOptions,
  async (t) => {
    await nativeFixture(t, async (context) => {
      const a = await context.session("a");
      const b = await context.session("b");
      assert.notEqual(a.backend, b.backend);
      const claimed = await a.request(
        `begin;${nativeRpc(`public.kova_policy_claim_customer('${USER}','live')`)}`,
      );
      const scheduling = nativePending(
        b,
        nativeRpc(`public.kova_policy_schedule_deletion('${USER}')`),
      );
      await context.waitForLock(b.applicationName);
      await a.request("commit;select jsonb_build_object('committed',true);");
      assert.equal((await scheduling).value.state, "scheduled");
      await context.command(`update public.kova_policy_accounts set scheduled_at=now()-interval '721 hours',
      recover_until=now()-interval '1 hour' where user_id='${USER}';select jsonb_build_object('aged',true);`);
      const completed = await a.request(
        `begin;${nativeRpc(`public.kova_policy_complete_customer('${USER}','live','${claimed.value.requestId}','cus_One')`)}`,
      );
      assert.equal(completed.value, "cus_One");
      const finalizing = nativePending(
        b,
        nativeRpc(`public.kova_policy_begin_finalization('${USER}')`),
      );
      await context.waitForLock(b.applicationName);
      await a.request("commit;select jsonb_build_object('committed',true);");
      const result = (await finalizing).value;
      assert.equal(result.state, "finalizing");
      assert.equal(result.customers.length, 1);
      assert.equal(result.customers[0].customerId, "cus_One");
      assert.equal(result.customers[0].retiredAt, null);
      const preserved =
        await context.command(`select jsonb_build_object('users',(select count(*) from auth.users),
      'fence',(select count(*) from public.account_deletion_fences where user_id='${USER}'));`);
      assert.deepEqual(preserved, { users: 3, fence: 1 });
    });
  },
);
