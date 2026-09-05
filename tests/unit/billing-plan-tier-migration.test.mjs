import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "supabase/migrations/20260904231213_billing_plan_tier_and_atomic_stripe_events.sql";
const userId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const plusPriceId = "price_1UAzhHAEZlsb6DBYWw2oUCeO";
const proPriceId = "price_1UAzhRAEZlsb6DBYlafU4mhc";
const rotatedPlusPriceId = "price_RotatedPlus123";

async function createDatabase({ beforeMigration } = {}) {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.test_session (user_id uuid);
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$ SELECT user_id FROM auth.test_session LIMIT 1 $$;

    CREATE TABLE public.family_links (
      member_id uuid PRIMARY KEY,
      owner_id uuid NOT NULL
    );
    CREATE FUNCTION public.family_owner_of(_user_id uuid)
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT owner_id
      FROM public.family_links
      WHERE member_id = _user_id
    $$;

    CREATE TABLE public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      stripe_subscription_id text NOT NULL UNIQUE,
      stripe_customer_id text NOT NULL,
      product_id text NOT NULL,
      price_id text NOT NULL,
      status text NOT NULL,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean NOT NULL DEFAULT false,
      environment text NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_stripe_event_created_at timestamptz,
      last_stripe_event_id text,
      UNIQUE (stripe_subscription_id, environment)
    );
    CREATE TABLE public.stripe_customer_mappings (
      environment text NOT NULL,
      stripe_customer_id text NOT NULL,
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      PRIMARY KEY (environment, stripe_customer_id),
      UNIQUE (environment, user_id)
    );
    CREATE TABLE public.processed_stripe_events (
      event_id text PRIMARY KEY,
      type text NOT NULL,
      environment text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      event_created_at timestamptz,
      correlation_id uuid,
      object_id text,
      customer_id text,
      subscription_id text,
      invoice_id text,
      checkout_session_id text,
      outcome text NOT NULL DEFAULT 'claimed',
      retryable boolean NOT NULL DEFAULT false,
      UNIQUE (event_id, environment)
    );
    INSERT INTO auth.users (id) VALUES
      ('11111111-1111-4111-8111-111111111111'),
      ('22222222-2222-4222-8222-222222222222'),
      ('33333333-3333-4333-8333-333333333333');
  `);
  if (beforeMigration) await beforeMigration(database);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

async function tier(database, targetUserId = userId, effective = false) {
  const functionName = effective ? "effective_user_plan_tier" : "billing_user_plan_tier";
  const result = await database.query(`SELECT public.${functionName}($1::uuid) AS tier`, [
    targetUserId,
  ]);
  return result.rows[0]?.tier;
}

async function summary(database, targetUserId = userId) {
  const result = await database.query(
    "SELECT public.user_subscription_summary($1::uuid) AS summary",
    [targetUserId],
  );
  return result.rows[0]?.summary;
}

async function addSubscription(
  database,
  {
    environment = "live",
    priceId = plusPriceId,
    status = "active",
    targetUserId = userId,
    subscriptionId,
  } = {},
) {
  await database.query(
    `INSERT INTO public.subscriptions (
       user_id, stripe_subscription_id, stripe_customer_id, product_id,
       price_id, status, current_period_end, environment
     )
     VALUES (
       $1::uuid,
       $2,
       'cus_' || gen_random_uuid()::text,
       'prod_fixture',
       $3,
       $4,
       now() + interval '30 days',
       $5
     )`,
    [targetUserId, subscriptionId ?? `sub_${crypto.randomUUID()}`, priceId, status, environment],
  );
}

test("opaque live Prices resolve while sandbox and unknown IDs fail closed", async () => {
  const database = await createDatabase();
  try {
    await addSubscription(database, { environment: "sandbox", priceId: proPriceId });
    assert.equal(await tier(database), "free");

    await addSubscription(database, {
      environment: "live",
      priceId: plusPriceId,
      subscriptionId: "sub_live_plus",
    });
    assert.equal(await tier(database), "plus");

    await database.query("DELETE FROM public.subscriptions WHERE environment = 'live'");
    await addSubscription(database, {
      environment: "live",
      priceId: "price_opaque_live",
      subscriptionId: "sub_unknown",
    });
    assert.equal(await tier(database), "free");
    const unresolved = await summary(database);
    assert.equal(unresolved.billingConflict, true);
    assert.equal(unresolved.activeSubscriptionCount, 1);
  } finally {
    await database.close();
  }
});

test("two exact historical Prices may share one lookup key without ambiguity", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      `INSERT INTO public.billing_plan_tiers
         (environment, stripe_price_id, lookup_key, tier)
       VALUES ('live', $1, 'plus_monthly', 'plus')`,
      [rotatedPlusPriceId],
    );
    const mappings = await database.query(
      `SELECT count(*)::integer AS count
       FROM public.billing_plan_tiers
       WHERE environment = 'live' AND lookup_key = 'plus_monthly'`,
    );
    assert.deepEqual(mappings.rows, [{ count: 2 }]);

    await addSubscription(database, {
      priceId: plusPriceId,
      subscriptionId: "sub_original",
    });
    assert.equal(await tier(database), "plus");

    await database.query("DELETE FROM public.subscriptions");
    await addSubscription(database, {
      priceId: rotatedPlusPriceId,
      subscriptionId: "sub_rotated",
    });
    assert.equal(await tier(database), "plus");
  } finally {
    await database.close();
  }
});

test("multiple active subscriptions retain paid access when every row maps to Plus", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      `INSERT INTO public.billing_plan_tiers
         (environment, stripe_price_id, lookup_key, tier)
       VALUES ('live', $1, 'plus_monthly', 'plus')`,
      [rotatedPlusPriceId],
    );
    await addSubscription(database, {
      priceId: plusPriceId,
      subscriptionId: "sub_plus_a",
    });
    await addSubscription(database, {
      priceId: rotatedPlusPriceId,
      subscriptionId: "sub_plus_b",
    });
    assert.equal(await tier(database), "plus");
    const result = await summary(database);
    assert.equal(result.tier, "plus");
    assert.equal(result.billingConflict, true);
    assert.equal(result.activeSubscriptionCount, 2);
  } finally {
    await database.close();
  }
});

test("cross-tier ambiguity fails closed", async () => {
  const database = await createDatabase();
  try {
    await addSubscription(database, {
      priceId: plusPriceId,
      subscriptionId: "sub_plus",
    });
    await addSubscription(database, {
      priceId: proPriceId,
      subscriptionId: "sub_pro",
    });
    assert.equal(await tier(database), "free");
    assert.equal((await summary(database)).billingConflict, true);
  } finally {
    await database.close();
  }
});

test("legacy lookup-key rows are backfilled and rollback writes are normalized", async () => {
  const database = await createDatabase({
    beforeMigration: async (db) => {
      await db.query(
        `INSERT INTO public.subscriptions (
           user_id, stripe_subscription_id, stripe_customer_id, product_id,
           price_id, status, current_period_end, environment
         ) VALUES (
           $1::uuid, 'sub_legacy', 'cus_legacy', 'prod_plus',
           'plus_monthly', 'active', now() + interval '30 days', 'live'
         )`,
        [userId],
      );
    },
  });
  try {
    const legacy = await database.query(
      "SELECT price_id FROM public.subscriptions WHERE stripe_subscription_id = 'sub_legacy'",
    );
    assert.deepEqual(legacy.rows, [{ price_id: plusPriceId }]);
    assert.equal(await tier(database), "plus");

    await database.query("DELETE FROM public.subscriptions");
    await addSubscription(database, {
      priceId: "plus_monthly",
      subscriptionId: "sub_rollback_writer",
    });
    const rollbackWrite = await database.query(
      "SELECT price_id FROM public.subscriptions WHERE stripe_subscription_id = 'sub_rollback_writer'",
    );
    assert.deepEqual(rollbackWrite.rows, [{ price_id: plusPriceId }]);
    assert.equal(await tier(database), "plus");
  } finally {
    await database.close();
  }
});

test("family member summary returns own and effective tiers from one resolver", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      "INSERT INTO public.family_links (member_id, owner_id) VALUES ($1::uuid, $2::uuid)",
      [memberId, ownerId],
    );
    await addSubscription(database, {
      targetUserId: ownerId,
      priceId: proPriceId,
      subscriptionId: "sub_owner_pro",
    });
    assert.equal(await tier(database, memberId), "free");
    assert.equal(await tier(database, memberId, true), "pro");

    await database.query("INSERT INTO auth.test_session (user_id) VALUES ($1::uuid)", [memberId]);
    const current = await database.query("SELECT public.current_subscription_summary() AS summary");
    assert.equal(current.rows[0].summary.tier, "free");
    assert.equal(current.rows[0].summary.effectiveTier, "pro");
    assert.equal(current.rows[0].summary.inherited, true);

    await addSubscription(database, {
      targetUserId: memberId,
      priceId: "price_unregistered_member",
      subscriptionId: "sub_member_unknown",
    });
    assert.equal(await tier(database, memberId, true), "free");
    const conflicted = await summary(database, memberId);
    assert.equal(conflicted.billingConflict, true);
    assert.equal(conflicted.inherited, false);
    assert.equal(conflicted.effectiveTier, "free");
  } finally {
    await database.close();
  }
});

test("an inherited upgrade never hides the member's own billed subscription", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      "INSERT INTO public.family_links (member_id, owner_id) VALUES ($1::uuid, $2::uuid)",
      [memberId, ownerId],
    );
    await addSubscription(database, {
      targetUserId: ownerId,
      priceId: proPriceId,
      subscriptionId: "sub_owner_pro_upgrade",
    });
    await addSubscription(database, {
      targetUserId: memberId,
      priceId: plusPriceId,
      subscriptionId: "sub_member_plus",
    });
    const result = await summary(database, memberId);
    assert.equal(result.tier, "plus");
    assert.equal(result.effectiveTier, "pro");
    assert.equal(result.activeSubscriptionCount, 1);
    assert.equal(result.inherited, false);
    assert.equal(result.billingConflict, false);
  } finally {
    await database.close();
  }
});

test("arbitrary-user resolvers remain service-role-only", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        has_function_privilege('anon', 'public.user_plan_tier(uuid)', 'EXECUTE') AS anon,
        has_function_privilege(
          'authenticated',
          'public.user_plan_tier(uuid)',
          'EXECUTE'
        ) AS authenticated_compatibility,
        has_function_privilege(
          'authenticated',
          'public.billing_user_plan_tier(uuid)',
          'EXECUTE'
        ) AS authenticated_core,
        has_function_privilege(
          'service_role',
          'public.billing_user_plan_tier(uuid)',
          'EXECUTE'
        ) AS service_role_core,
        has_function_privilege(
          'authenticated',
          'public.current_subscription_summary()',
          'EXECUTE'
        ) AS current_summary
    `);
    assert.deepEqual(privileges.rows, [
      {
        anon: false,
        authenticated_compatibility: true,
        authenticated_core: false,
        service_role_core: true,
        current_summary: true,
      },
    ]);

    await addSubscription(database, {
      priceId: plusPriceId,
      subscriptionId: "sub_compatibility",
    });
    await database.query("INSERT INTO auth.test_session (user_id) VALUES ($1::uuid)", [userId]);
    const compatibility = await database.query(
      "SELECT public.user_plan_tier($1::uuid) AS own, public.user_plan_tier($2::uuid) AS other",
      [userId, ownerId],
    );
    assert.deepEqual(compatibility.rows, [{ own: "plus", other: "free" }]);

    const migration = await readFile(migrationPath, "utf8");
    assert.doesNotMatch(migration, /unique\s*\(environment,\s*lookup_key\)/iu);
    assert.match(migration, /mapping\.stripe_price_id\s*=\s*subscription\.price_id/u);
  } finally {
    await database.close();
  }
});

test("missing billing periods do not grant direct or inherited paid access", async () => {
  const database = await createDatabase();
  try {
    await addSubscription(database, { priceId: plusPriceId, subscriptionId: "sub_missing_period" });
    await database.query(
      "UPDATE public.subscriptions SET current_period_end=NULL WHERE user_id=$1",
      [userId],
    );
    assert.equal(await tier(database), "free");
    assert.equal((await summary(database)).tier, "free");
  } finally {
    await database.close();
  }
});
