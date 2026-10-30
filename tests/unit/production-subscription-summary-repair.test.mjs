import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const originalMigration =
  "supabase/migrations/20261027230755_kova_production_subscription_summary_read_only.sql";
const forwardMigration =
  "supabase/migrations/20261029235133_kova_production_subscription_summary_read_only_forward.sql";
const owner = "11111111-1111-4111-8111-111111111111";

async function baseline() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.subscriptions (
      id uuid primary key, user_id uuid not null, stripe_subscription_id text not null,
      stripe_customer_id text not null, product_id text not null, price_id text not null,
      status text not null, current_period_start timestamptz,
      current_period_end timestamptz, cancel_at_period_end boolean,
      environment text not null, created_at timestamptz, updated_at timestamptz,
      last_stripe_event_created_at timestamptz, last_stripe_event_id text
    );
    create table public.billing_plan_tiers (
      environment text not null, stripe_price_id text not null,
      lookup_key text not null, tier text not null,
      primary key (environment, stripe_price_id)
    );
    create function public.billing_user_plan_tier(_user_id uuid) returns text
      language sql stable security definer set search_path = public, pg_temp
      as $$
        select coalesce((select mapping.tier from public.subscriptions sub
          join public.billing_plan_tiers mapping
            on mapping.environment = sub.environment
           and mapping.stripe_price_id = sub.price_id
          where sub.user_id = _user_id and sub.environment = 'live'
            and sub.status = 'active' and sub.current_period_end > now()
          limit 1), 'free')
      $$;
    create function public.effective_user_plan_tier(_user_id uuid) returns text
      language sql stable security definer set search_path = public, pg_temp
      as $$ select public.billing_user_plan_tier(_user_id) $$;
  `);
  return db;
}

test("recorded forward migration preserves the reviewed SQL without nested transaction markers", async () => {
  const original = await readFile(originalMigration, "utf8");
  const forward = await readFile(forwardMigration, "utf8");
  assert.equal(forward, original.replace(/^begin;\n/mu, "").replace(/^commit;\n$/mu, ""));
  assert.equal(Buffer.byteLength(forward), 4745);
  assert.equal(
    createHash("sha256").update(forward).digest("hex"),
    "8856b46715d701be07cdccadfc833ef22659ee80ff71459f4f7ad53513af1cd4",
  );
});

for (const migration of [originalMigration, forwardMigration]) {
  const variant = migration === originalMigration ? "original" : "recorded forward";
  test(`${variant}: empty production billing baseline returns verified free without seeding entitlements`, async () => {
    const db = await baseline();
    try {
      await db.exec(await readFile(migration, "utf8"));
      const before = await db.query(`select
      (select count(*) from public.subscriptions)::integer as subscriptions,
      (select count(*) from public.billing_plan_tiers)::integer as mappings`);
      assert.deepEqual(before.rows[0], { subscriptions: 0, mappings: 0 });
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner]);
      const response = await db.query(`select public.current_subscription_summary() as summary`);
      assert.deepEqual(response.rows[0].summary, {
        tier: "free",
        effectiveTier: "free",
        activeSubscriptionCount: 0,
        billingConflict: false,
        inherited: false,
        status: null,
        priceId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialing: false,
      });
      const grants = await db.query(`select
      has_function_privilege('authenticated', 'public.current_subscription_summary()', 'EXECUTE') as own,
      has_function_privilege('anon', 'public.current_subscription_summary()', 'EXECUTE') as anonymous,
      has_function_privilege('authenticated', 'public.user_subscription_summary(uuid)', 'EXECUTE') as arbitrary_owner,
      has_function_privilege('service_role', 'public.user_subscription_summary(uuid)', 'EXECUTE') as server`);
      assert.deepEqual(grants.rows[0], {
        own: true,
        anonymous: false,
        arbitrary_owner: false,
        server: true,
      });
    } finally {
      await db.close();
    }
  });

  test(`${variant}: new subscription or Price mapping blocks this baseline-specific repair`, async () => {
    for (const table of ["subscriptions", "billing_plan_tiers"]) {
      const db = await baseline();
      try {
        if (table === "subscriptions") {
          await db.query(
            `insert into public.subscriptions
          (id,user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,environment)
          values (gen_random_uuid(),$1,'sub_test','cus_test','prod_test','price_test','active','live')`,
            [owner],
          );
        } else {
          await db.exec(`insert into public.billing_plan_tiers values
          ('live','price_test','plus_monthly','plus')`);
        }
        await assert.rejects(
          db.exec(await readFile(migration, "utf8")),
          /billing_summary_baseline_changed/,
        );
        await db.exec("rollback");
        const functionCount = await db.query(`select count(*)::integer as total from pg_proc
        where proname in ('user_subscription_summary','current_subscription_summary')`);
        assert.equal(functionCount.rows[0].total, 0);
      } finally {
        await db.close();
      }
    }
  });

  test(`${variant}: unmapped synthetic live subscription is reported as a billing conflict`, async () => {
    const db = await baseline();
    try {
      await db.exec(await readFile(migration, "utf8"));
      await db.query(
        `insert into public.subscriptions
      (id,user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
       current_period_end,environment,created_at)
      values (gen_random_uuid(),$1,'sub_test','cus_test','prod_test','price_unmapped','active',
              now()+interval '1 month','live',now())`,
        [owner],
      );
      const response = await db.query(
        `select public.user_subscription_summary($1::uuid) as summary`,
        [owner],
      );
      assert.equal(response.rows[0].summary.tier, "free");
      assert.equal(response.rows[0].summary.activeSubscriptionCount, 1);
      assert.equal(response.rows[0].summary.billingConflict, true);
      assert.equal(response.rows[0].summary.priceId, null);
    } finally {
      await db.close();
    }
  });

  test(`${variant}: full-schema replay keeps an existing Price catalog unchanged`, async () => {
    const db = await baseline();
    try {
      await db.exec(`
      insert into public.billing_plan_tiers values ('live','price_existing','plus_monthly','plus');
      create function public.user_subscription_summary(_user_id uuid) returns jsonb
        language sql stable as $$ select '{}'::jsonb $$;
      create function public.current_subscription_summary() returns jsonb
        language sql stable as $$ select '{}'::jsonb $$;
    `);
      await db.exec(await readFile(migration, "utf8"));
      const result = await db.query(
        `select
      (select count(*)::integer from public.billing_plan_tiers) as mappings,
      public.user_subscription_summary($1::uuid) as summary`,
        [owner],
      );
      assert.equal(result.rows[0].mappings, 1);
      assert.equal(result.rows[0].summary.tier, "free");
      assert.equal(result.rows[0].summary.billingConflict, false);
    } finally {
      await db.close();
    }
  });
}
