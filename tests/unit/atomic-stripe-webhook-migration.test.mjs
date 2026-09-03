import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260903193000_atomic_stripe_webhook_processing.sql";
const userId = "11111111-1111-4111-8111-111111111111";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users (id) VALUES ('${userId}');

    CREATE TABLE public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
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
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

function snapshot(overrides = {}) {
  return {
    user_id: userId,
    stripe_subscription_id: "sub_123",
    stripe_customer_id: "cus_123",
    product_id: "prod_123",
    price_id: "plus_monthly",
    status: "active",
    current_period_start: "2026-09-01T00:00:00.000Z",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
    environment: "live",
    ...overrides,
  };
}

async function processEvent(
  database,
  {
    eventId = "evt_100",
    eventType = "customer.subscription.updated",
    createdAt = "2026-09-03T12:00:00.000Z",
    subscription = snapshot(),
  } = {},
) {
  return database.query(
    `SELECT * FROM public.process_stripe_webhook_event(
      $1::text, $2::text, $3::text, $4::timestamptz, $5::uuid, $6::text,
      $7::text, $8::text, $9::text, $10::text, $11::text, $12::jsonb
    )`,
    [
      eventId,
      eventType,
      "live",
      createdAt,
      "22222222-2222-4222-8222-222222222222",
      "sub_123",
      "cus_123",
      subscription?.stripe_subscription_id ?? null,
      null,
      null,
      "subscription_updated",
      subscription === null ? null : JSON.stringify(subscription),
    ],
  );
}

test("the atomic Stripe RPC commits an event and canonical subscription exactly once", async () => {
  const database = await createDatabase();
  try {
    const first = await processEvent(database);
    assert.deepEqual(first.rows, [{ duplicate: false, applied: true }]);

    const duplicate = await processEvent(database);
    assert.deepEqual(duplicate.rows, [{ duplicate: true, applied: false }]);

    const counts = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS events,
        (SELECT count(*)::integer FROM public.subscriptions) AS subscriptions
    `);
    assert.deepEqual(counts.rows, [{ events: 1, subscriptions: 1 }]);
  } finally {
    await database.close();
  }
});

test("an older Stripe delivery is recorded but cannot overwrite newer entitlement state", async () => {
  const database = await createDatabase();
  try {
    await processEvent(database, {
      eventId: "evt_newer",
      createdAt: "2026-09-03T12:02:00.000Z",
      subscription: snapshot({ status: "canceled", cancel_at_period_end: true }),
    });
    const older = await processEvent(database, {
      eventId: "evt_older",
      createdAt: "2026-09-03T12:01:00.000Z",
      subscription: snapshot({ status: "active", cancel_at_period_end: false }),
    });
    assert.deepEqual(older.rows, [{ duplicate: false, applied: false }]);

    const state = await database.query(`
      SELECT status, cancel_at_period_end, last_stripe_event_id
      FROM public.subscriptions
      WHERE stripe_subscription_id = 'sub_123'
    `);
    assert.deepEqual(state.rows, [
      {
        status: "canceled",
        cancel_at_period_end: true,
        last_stripe_event_id: "evt_newer",
      },
    ]);
  } finally {
    await database.close();
  }
});

test("invalid subscription snapshots roll back the processed-event claim", async () => {
  const database = await createDatabase();
  try {
    await assert.rejects(
      () =>
        processEvent(database, {
          eventId: "evt_invalid",
          subscription: snapshot({ user_id: "not-a-uuid" }),
        }),
      /invalid input syntax for type uuid/u,
    );

    const events = await database.query(
      "SELECT event_id FROM public.processed_stripe_events WHERE event_id = 'evt_invalid'",
    );
    assert.deepEqual(events.rows, []);
  } finally {
    await database.close();
  }
});

test("only the service role can execute the atomic Stripe RPC", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        has_function_privilege(
          'anon',
          'public.process_stripe_webhook_event(text,text,text,timestamptz,uuid,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) AS anon_execute,
        has_function_privilege(
          'authenticated',
          'public.process_stripe_webhook_event(text,text,text,timestamptz,uuid,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) AS authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.process_stripe_webhook_event(text,text,text,timestamptz,uuid,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) AS service_execute
    `);
    assert.deepEqual(privileges.rows, [
      { anon_execute: false, authenticated_execute: false, service_execute: true },
    ]);

    const definition = await database.query(`
      SELECT prosecdef, proconfig
      FROM pg_proc
      WHERE oid = 'public.process_stripe_webhook_event(text,text,text,timestamptz,uuid,text,text,text,text,text,text,jsonb)'::regprocedure
    `);
    assert.equal(definition.rows[0].prosecdef, true);
    assert.deepEqual(definition.rows[0].proconfig, ['search_path=""']);
  } finally {
    await database.close();
  }
});
