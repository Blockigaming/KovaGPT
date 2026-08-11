import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260623155803_689e3fda-4d71-4138-9248-613595517f5f.sql";
const intendedUserId = "381887de-16c6-4120-8fc1-a0f7767c4d54";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );
    CREATE TABLE public.subscriptions (
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      stripe_subscription_id text NOT NULL UNIQUE,
      stripe_customer_id text NOT NULL,
      product_id text NOT NULL,
      price_id text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean DEFAULT false,
      environment text NOT NULL DEFAULT 'sandbox',
      updated_at timestamptz DEFAULT now()
    );
  `);
  return database;
}

async function subscriptionRows(database) {
  const result = await database.query(`
    SELECT user_id::text, stripe_subscription_id, status, environment
    FROM public.subscriptions
    ORDER BY environment
  `);
  return result.rows;
}

test("compensatory subscription migration is a no-op when the intended Auth user is absent", async () => {
  const database = await createDatabase();
  try {
    const migration = await readFile(migrationPath, "utf8");
    await database.exec(migration);
    assert.deepEqual(await subscriptionRows(database), []);
  } finally {
    await database.close();
  }
});

test("compensatory subscription migration inserts and idempotently refreshes both rows when the Auth user exists", async () => {
  const database = await createDatabase();
  try {
    const migration = await readFile(migrationPath, "utf8");
    await database.query("INSERT INTO auth.users (id) VALUES ($1::uuid)", [intendedUserId]);

    await database.exec(migration);
    assert.deepEqual(await subscriptionRows(database), [
      {
        user_id: intendedUserId,
        stripe_subscription_id: "comp_pro_live_381887de",
        status: "active",
        environment: "live",
      },
      {
        user_id: intendedUserId,
        stripe_subscription_id: "comp_pro_sandbox_381887de",
        status: "active",
        environment: "sandbox",
      },
    ]);

    await database.query(
      "UPDATE public.subscriptions SET status = 'canceled', cancel_at_period_end = true",
    );
    await database.exec(migration);

    const refreshed = await database.query(`
      SELECT count(*)::int AS count,
             bool_and(status = 'active') AS active,
             bool_and(cancel_at_period_end = false) AS not_canceling
      FROM public.subscriptions
    `);
    assert.deepEqual(refreshed.rows, [{ count: 2, active: true, not_canceling: true }]);
  } finally {
    await database.close();
  }
});

test("migration never creates or modifies Auth users", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /FROM auth\.users AS intended_user/u);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?auth\.users/iu);
});
