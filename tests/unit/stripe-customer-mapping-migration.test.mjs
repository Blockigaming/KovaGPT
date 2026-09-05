import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "supabase/migrations/20260904231210_stripe_customer_identity_and_completion.sql";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.subscriptions (
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      stripe_subscription_id text NOT NULL UNIQUE,
      stripe_customer_id text NOT NULL,
      environment text NOT NULL DEFAULT 'sandbox'
    );
    CREATE TABLE public.processed_stripe_events (
      event_id text PRIMARY KEY,
      type text NOT NULL,
      environment text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return database;
}

test("migration backfills real Customer ids and preserves rollback uniqueness", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO auth.users (id) VALUES
        ('11111111-1111-1111-1111-111111111111'),
        ('22222222-2222-2222-2222-222222222222');
      INSERT INTO public.subscriptions
        (user_id, stripe_subscription_id, stripe_customer_id, environment)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'sub_live_1', 'cus_live1', 'live'),
        ('11111111-1111-1111-1111-111111111111', 'sub_live_2', 'cus_live1', 'live'),
        ('11111111-1111-1111-1111-111111111111', 'sub_test_1', 'cus_test1', 'sandbox'),
        ('22222222-2222-2222-2222-222222222222', 'comp_pro_live', 'comp_cust_pro_live', 'live');
    `);
    await database.exec(await readFile(migrationPath, "utf8"));

    const mappings = await database.query(`
      SELECT environment, stripe_customer_id, user_id::text
      FROM public.stripe_customer_mappings
      ORDER BY environment, stripe_customer_id
    `);
    assert.deepEqual(mappings.rows, [
      {
        environment: "live",
        stripe_customer_id: "cus_live1",
        user_id: "11111111-1111-1111-1111-111111111111",
      },
      {
        environment: "sandbox",
        stripe_customer_id: "cus_test1",
        user_id: "11111111-1111-1111-1111-111111111111",
      },
    ]);

    await assert.rejects(
      () =>
        database.exec(`
          INSERT INTO public.processed_stripe_events (event_id, type, environment)
          VALUES ('evt_same', 'test', 'live'), ('evt_same', 'test', 'sandbox');
        `),
      /duplicate key|unique constraint/iu,
    );
    await assert.rejects(
      () =>
        database.exec(`
          INSERT INTO public.subscriptions
            (user_id, stripe_subscription_id, stripe_customer_id, environment)
          VALUES
            ('22222222-2222-2222-2222-222222222222', 'sub_shared', 'cus_second', 'live'),
            ('22222222-2222-2222-2222-222222222222', 'sub_shared', 'cus_second', 'sandbox');
        `),
      /duplicate key|unique constraint/iu,
    );

    await database.exec("DELETE FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111'");
    const detached = await database.query(`
      SELECT bool_and(user_id IS NULL) AS detached
      FROM public.stripe_customer_mappings
      WHERE stripe_customer_id IN ('cus_live1', 'cus_test1')
    `);
    assert.deepEqual(detached.rows, [{ detached: true }]);
  } finally {
    await database.close();
  }
});

test("migration aborts rather than guessing when one user has two Customers", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      INSERT INTO auth.users (id)
      VALUES ('33333333-3333-3333-3333-333333333333');
      INSERT INTO public.subscriptions
        (user_id, stripe_subscription_id, stripe_customer_id, environment)
      VALUES
        ('33333333-3333-3333-3333-333333333333', 'sub_a', 'cus_a', 'live'),
        ('33333333-3333-3333-3333-333333333333', 'sub_b', 'cus_b', 'live');
    `);
    const migration = await readFile(migrationPath, "utf8");
    await assert.rejects(() => database.exec(migration), /stripe_customer_backfill_user_conflict/u);
  } finally {
    await database.close();
  }
});

test("first Checkout reservation and account deletion are serialized by a durable fence", async () => {
  const database = await createDatabase();
  const user = "11111111-1111-4111-8111-111111111111";
  try {
    await database.exec(await readFile(migrationPath, "utf8"));
    await database.query("INSERT INTO auth.users(id) VALUES ($1)", [user]);
    const claim = await database.query(
      "SELECT public.claim_stripe_customer_creation($1,'live') AS request",
      [user],
    );
    await database.query("INSERT INTO public.account_deletion_fences(user_id) VALUES ($1)", [user]);
    await assert.rejects(
      database.query("SELECT public.prepare_stripe_account_deletion($1)", [user]),
      /stripe_customer_creation_pending/u,
    );
    await assert.rejects(
      database.query("SELECT public.claim_stripe_customer_creation($1,'sandbox')", [user]),
      /account_deletion_pending/u,
    );
    await assert.rejects(
      database.query("DELETE FROM auth.users WHERE id=$1", [user]),
      /stripe_customer_creation_pending/u,
    );
    await database.query("DELETE FROM public.account_deletion_fences WHERE user_id=$1", [user]);
    const requestId = claim.rows[0].request.requestId;
    await database.query(
      "SELECT public.complete_stripe_customer_creation($1,'live',$2,'cus_Settled')",
      [user, requestId],
    );
    await database.query("INSERT INTO public.account_deletion_fences(user_id) VALUES ($1)", [user]);
    const ready = await database.query(
      "SELECT public.prepare_stripe_account_deletion($1) AS mappings",
      [user],
    );
    assert.deepEqual(ready.rows[0].mappings, [
      { environment: "live", stripe_customer_id: "cus_Settled" },
    ]);
  } finally {
    await database.close();
  }
});
