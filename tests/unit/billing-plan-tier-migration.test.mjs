import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "supabase/migrations/20260902024000_billing_plan_tier_and_atomic_stripe_events.sql";
const userId = "11111111-1111-4111-8111-111111111111";
const plusPriceId = "price_1UAzhHAEZlsb6DBYWw2oUCeO";
const proPriceId = "price_1UAzhRAEZlsb6DBYlafU4mhc";
const rotatedPlusPriceId = "price_RotatedPlus123";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      stripe_subscription_id text NOT NULL,
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
      event_id text NOT NULL,
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
      PRIMARY KEY (event_id, environment)
    );
    INSERT INTO auth.users (id) VALUES ('${userId}');
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

async function tier(database) {
  const result = await database.query(
    "SELECT public.user_plan_tier($1::uuid) AS tier",
    [userId],
  );
  return result.rows[0]?.tier;
}

async function addSubscription(database, { environment, priceId, status = "active" }) {
  await database.query(
    `INSERT INTO public.subscriptions (
       user_id, stripe_subscription_id, stripe_customer_id, product_id,
       price_id, status, current_period_end, environment
     )
     VALUES (
       $1::uuid,
       'sub_' || gen_random_uuid()::text,
       'cus_' || gen_random_uuid()::text,
       'prod_fixture',
       $2,
       $3,
       now() + interval '30 days',
       $4
     )`,
    [userId, priceId, status, environment],
  );
}

test(
  "opaque live Prices resolve while the same Price in sandbox cannot grant live access",
  async () => {
    const database = await createDatabase();
    try {
      await addSubscription(database, { environment: "sandbox", priceId: proPriceId });
      assert.equal(await tier(database), "free");

      await addSubscription(database, { environment: "live", priceId: plusPriceId });
      assert.equal(await tier(database), "plus");
    } finally {
      await database.close();
    }
  },
);

test("historical and rotated exact Prices may share a lookup key", async () => {
  const database = await createDatabase();
  try {
    await database.query(
      `INSERT INTO public.billing_plan_tiers
         (environment, stripe_price_id, lookup_key, tier)
       VALUES ('live', $1, 'plus_monthly', 'plus')`,
      [rotatedPlusPriceId],
    );
    await addSubscription(database, { environment: "live", priceId: plusPriceId });
    await addSubscription(database, { environment: "live", priceId: rotatedPlusPriceId });
    assert.equal(await tier(database), "plus");
  } finally {
    await database.close();
  }
});

test("unknown, substring-like, and cross-tier ambiguous live rows fail closed", async () => {
  for (const priceId of ["price_opaque_live", "price_pro_live", "plus_monthly_extra"]) {
    const database = await createDatabase();
    try {
      await addSubscription(database, { environment: "live", priceId });
      assert.equal(await tier(database), "free", priceId);
    } finally {
      await database.close();
    }
  }

  const database = await createDatabase();
  try {
    await addSubscription(database, { environment: "live", priceId: plusPriceId });
    await addSubscription(database, { environment: "live", priceId: proPriceId });
    assert.equal(await tier(database), "free");
  } finally {
    await database.close();
  }
});

test("tier mapping is exact and service-role-only", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        has_function_privilege('anon', 'public.user_plan_tier(uuid)', 'EXECUTE') AS anon,
        has_function_privilege(
          'authenticated',
          'public.user_plan_tier(uuid)',
          'EXECUTE'
        ) AS authenticated,
        has_function_privilege(
          'service_role',
          'public.user_plan_tier(uuid)',
          'EXECUTE'
        ) AS service_role
    `);
    assert.deepEqual(privileges.rows, [
      { anon: false, authenticated: false, service_role: true },
    ]);

    const migration = await readFile(migrationPath, "utf8");
    assert.doesNotMatch(migration, /like\s+'%[^']*(?:pro|plus)/iu);
    assert.doesNotMatch(migration, /unique\s*\(environment,\s*lookup_key\)/iu);
    assert.match(migration, /mapping\.stripe_price_id\s*=\s*subscription\.price_id/u);
  } finally {
    await database.close();
  }
});
