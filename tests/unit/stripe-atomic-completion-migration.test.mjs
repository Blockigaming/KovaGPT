import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const identityMigration =
  "supabase/migrations/20260902023000_stripe_customer_identity_and_completion.sql";
const atomicMigration =
  "supabase/migrations/20260902024000_billing_plan_tier_and_atomic_stripe_events.sql";
const userId = "11111111-1111-4111-8111-111111111111";
const plusPriceId = "price_1UAzhHAEZlsb6DBYWw2oUCeO";

async function createDatabase({ mapping = true } = {}) {
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
      stripe_subscription_id text NOT NULL UNIQUE,
      stripe_customer_id text NOT NULL,
      product_id text NOT NULL,
      price_id text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean DEFAULT false,
      environment text NOT NULL DEFAULT 'sandbox',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_stripe_event_created_at timestamptz,
      last_stripe_event_id text
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
      retryable boolean NOT NULL DEFAULT false
    );
    INSERT INTO auth.users (id) VALUES ('${userId}');
  `);
  await database.exec(await readFile(identityMigration, "utf8"));
  if (mapping) {
    await database.query(
      `INSERT INTO public.stripe_customer_mappings
         (environment, stripe_customer_id, user_id)
       VALUES ('live', 'cus_trusted', $1::uuid)`,
      [userId],
    );
  }
  await database.exec(await readFile(atomicMigration, "utf8"));
  return database;
}

async function complete(
  database,
  { id, created, status, customerId = "cus_trusted", priceId = plusPriceId },
) {
  const result = await database.query(
    `SELECT public.complete_stripe_event(
      _event_id => $1,
      _event_created_at => $2::timestamptz,
      _event_type => 'customer.subscription.updated',
      _environment => 'live',
      _outcome => 'subscription_updated',
      _apply_subscription => true,
      _customer_id => $3,
      _subscription_id => 'sub_atomic',
      _object_id => 'sub_atomic',
      _product_id => 'prod_plus',
      _price_id => $4,
      _status => $5,
      _current_period_start => '2026-09-01T00:00:00Z',
      _current_period_end => '2026-10-01T00:00:00Z',
      _cancel_at_period_end => false
    ) AS result`,
    [id, created, customerId, priceId, status],
  );
  return result.rows[0]?.result;
}

test("a stale delivery is completed but cannot overwrite newer state", async () => {
  const database = await createDatabase();
  try {
    assert.deepEqual(
      await complete(database, {
        id: "evt_new",
        created: "2026-09-02T00:02:00Z",
        status: "active",
      }),
      { duplicate: false, stale: false, subscriptionApplied: true },
    );
    assert.deepEqual(
      await complete(database, {
        id: "evt_old",
        created: "2026-09-02T00:01:00Z",
        status: "canceled",
      }),
      { duplicate: false, stale: true, subscriptionApplied: false },
    );

    const state = await database.query(`
      SELECT status, last_stripe_event_id
      FROM public.subscriptions
      WHERE stripe_subscription_id = 'sub_atomic' AND environment = 'live'
    `);
    assert.deepEqual(state.rows, [{ status: "active", last_stripe_event_id: "evt_new" }]);

    const ledger = await database.query(
      "SELECT count(*)::integer AS count FROM public.processed_stripe_events",
    );
    assert.deepEqual(ledger.rows, [{ count: 2 }]);
  } finally {
    await database.close();
  }
});

test("same-second concurrent delivery permutations converge on the larger event id", async () => {
  for (const order of [
    [
      { id: "evt_a", status: "canceled" },
      { id: "evt_z", status: "active" },
    ],
    [
      { id: "evt_z", status: "active" },
      { id: "evt_a", status: "canceled" },
    ],
  ]) {
    const database = await createDatabase();
    try {
      await Promise.all(
        order.map((event) =>
          complete(database, {
            ...event,
            created: "2026-09-02T00:03:00Z",
          }),
        ),
      );
      const state = await database.query(`
        SELECT status, last_stripe_event_id
        FROM public.subscriptions
        WHERE stripe_subscription_id = 'sub_atomic' AND environment = 'live'
      `);
      assert.deepEqual(state.rows, [{ status: "active", last_stripe_event_id: "evt_z" }]);
    } finally {
      await database.close();
    }
  }
});

test("a duplicate is acknowledged without mutating the authoritative row", async () => {
  const database = await createDatabase();
  try {
    await complete(database, {
      id: "evt_same",
      created: "2026-09-02T00:04:00Z",
      status: "active",
    });
    assert.deepEqual(
      await complete(database, {
        id: "evt_same",
        created: "2026-09-02T00:05:00Z",
        status: "canceled",
      }),
      { duplicate: true, stale: false, subscriptionApplied: false },
    );
    const state = await database.query(`
      SELECT status, last_stripe_event_id FROM public.subscriptions
    `);
    assert.deepEqual(state.rows, [{ status: "active", last_stripe_event_id: "evt_same" }]);
  } finally {
    await database.close();
  }
});

test("a missing mapping rolls back both mutation and completion ledger", async () => {
  const database = await createDatabase({ mapping: false });
  try {
    await assert.rejects(
      () =>
        complete(database, {
          id: "evt_unmapped",
          created: "2026-09-02T00:06:00Z",
          status: "active",
        }),
      /stripe_customer_mapping_missing/u,
    );
    const counts = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.subscriptions) AS subscriptions,
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS events
    `);
    assert.deepEqual(counts.rows, [{ subscriptions: 0, events: 0 }]);
  } finally {
    await database.close();
  }
});
