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
const proPriceId = "price_1UAzhRAEZlsb6DBYlafU4mhc";

async function createDatabase({ mapping = true } = {}) {
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
    CREATE FUNCTION public.family_owner_of(_user_id uuid)
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$ SELECT NULL::uuid $$;

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
    INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111');
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

async function beginEvent(
  database,
  {
    id,
    created = "2026-09-02T00:00:00Z",
    type = "customer.subscription.updated",
    subscriptionId = "sub_atomic",
    outcome = "subscription_updated",
  },
) {
  const result = await database.query(
    `SELECT public.begin_stripe_event(
      _event_id => $1,
      _event_created_at => $2::timestamptz,
      _event_type => $3,
      _environment => 'live',
      _outcome => $4,
      _subscription_id => $5,
      _object_id => $5,
      _customer_id => 'cus_trusted',
      _lease_seconds => 15
    ) AS result`,
    [id, created, type, outcome, subscriptionId],
  );
  return result.rows[0]?.result;
}

async function completeEvent(
  database,
  { id, claim, apply = true, status = "active", customerId = "cus_trusted", priceId = plusPriceId },
) {
  const result = await database.query(
    `SELECT public.complete_stripe_event(
      _event_id => $1,
      _environment => 'live',
      _lease_token => $2::uuid,
      _observation_sequence => $3::bigint,
      _apply_subscription => $4,
      _customer_id => $5,
      _product_id => CASE WHEN $4 THEN 'prod_plus' ELSE NULL END,
      _price_id => CASE WHEN $4 THEN $6 ELSE NULL END,
      _status => CASE WHEN $4 THEN $7 ELSE NULL END,
      _current_period_start => CASE
        WHEN $4 THEN '2026-09-01T00:00:00Z'::timestamptz
        ELSE NULL
      END,
      _current_period_end => CASE
        WHEN $4 THEN '2026-10-01T00:00:00Z'::timestamptz
        ELSE NULL
      END,
      _cancel_at_period_end => false
    ) AS result`,
    [id, claim.leaseToken, claim.observationSequence, apply, customerId, priceId, status],
  );
  return result.rows[0]?.result;
}

async function expireLease(database, eventId) {
  await database.query(
    `UPDATE public.stripe_event_processing_claims
     SET lease_expires_at = now() - interval '1 second'
     WHERE event_id = $1`,
    [eventId],
  );
  await database.query(
    `UPDATE public.stripe_subscription_sync_state
     SET active_lease_expires_at = now() - interval '1 second'
     WHERE active_event_id = $1`,
    [eventId],
  );
}

async function claimCheckout(database, { priceId = plusPriceId, trialEligible = true } = {}) {
  const result = await database.query(
    `SELECT public.claim_stripe_checkout_attempt(
      $1::uuid,
      'live',
      $2,
      $3
    ) AS result`,
    [userId, priceId, trialEligible],
  );
  return result.rows[0]?.result;
}

test("billing migration is atomic and safe to re-run", async () => {
  const source = await readFile(atomicMigration, "utf8");
  assert.match(source, /^begin;$/mu);
  assert.match(source, /^commit;\s*$/mu);

  const database = await createDatabase();
  try {
    await database.exec(source);
    const result = await database.query(`
      SELECT
        to_regclass('public.stripe_event_processing_claims') IS NOT NULL AS claims,
        to_regclass('public.stripe_checkout_attempts') IS NOT NULL AS checkout
    `);
    assert.deepEqual(result.rows, [{ claims: true, checkout: true }]);
  } finally {
    await database.close();
  }
});

test("completed-event ledger contains no pending lease rows", async () => {
  const database = await createDatabase();
  try {
    const claim = await beginEvent(database, { id: "evt_claim" });
    assert.equal(claim.duplicate, false);
    assert.equal(claim.busy, false);

    const pending = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS ledger,
        (SELECT count(*)::integer FROM public.stripe_event_processing_claims) AS claims
    `);
    assert.deepEqual(pending.rows, [{ ledger: 0, claims: 1 }]);

    const duplicateInFlight = await beginEvent(database, { id: "evt_claim" });
    assert.equal(duplicateInFlight.busy, true);
    assert.equal(duplicateInFlight.duplicate, false);

    assert.deepEqual(await completeEvent(database, { id: "evt_claim", claim }), {
      duplicate: false,
      orphaned: false,
      subscriptionApplied: true,
    });
    const completed = await beginEvent(database, { id: "evt_claim" });
    assert.equal(completed.duplicate, true);

    const finalCounts = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS ledger,
        (SELECT count(*)::integer FROM public.stripe_event_processing_claims) AS claims
    `);
    assert.deepEqual(finalCounts.rows, [{ ledger: 1, claims: 0 }]);
  } finally {
    await database.close();
  }
});

test("expired crash retry gets a new observation and rejects the stalled handler", async () => {
  const database = await createDatabase();
  try {
    const first = await beginEvent(database, { id: "evt_crash" });
    await expireLease(database, "evt_crash");
    await assert.rejects(
      () => completeEvent(database, { id: "evt_crash", claim: first }),
      /stripe_event_lease_stale/u,
    );
    const retry = await beginEvent(database, { id: "evt_crash" });
    assert.ok(retry.observationSequence > first.observationSequence);
    assert.notEqual(retry.leaseToken, first.leaseToken);

    await assert.rejects(
      () => completeEvent(database, { id: "evt_crash", claim: first }),
      /stripe_event_lease_stale/u,
    );
    assert.deepEqual(
      await completeEvent(database, {
        id: "evt_crash",
        claim: retry,
        status: "active",
      }),
      { duplicate: false, orphaned: false, subscriptionApplied: true },
    );
  } finally {
    await database.close();
  }
});

test("a second event for one subscription defers until the active lease completes", async () => {
  const database = await createDatabase();
  try {
    const first = await beginEvent(database, { id: "evt_first" });
    const deferred = await beginEvent(database, {
      id: "evt_second",
      created: "2026-09-02T00:00:01Z",
    });
    assert.equal(deferred.busy, true);
    assert.equal(deferred.observationSequence, null);

    await completeEvent(database, { id: "evt_first", claim: first });
    const second = await beginEvent(database, {
      id: "evt_second",
      created: "2026-09-02T00:00:01Z",
    });
    assert.equal(second.busy, false);
    assert.ok(second.observationSequence > first.observationSequence);
    await completeEvent(database, {
      id: "evt_second",
      claim: second,
      status: "canceled",
    });

    const state = await database.query(`
      SELECT status, last_stripe_event_id
      FROM public.subscriptions
      WHERE stripe_subscription_id = 'sub_atomic'
    `);
    assert.deepEqual(state.rows, [{ status: "canceled", last_stripe_event_id: "evt_second" }]);
  } finally {
    await database.close();
  }
});

test("event created time and ID are audit metadata, not causal ordering", async () => {
  const database = await createDatabase();
  try {
    const newerTrigger = await beginEvent(database, {
      id: "evt_z",
      created: "2026-09-02T00:02:00Z",
    });
    await completeEvent(database, {
      id: "evt_z",
      claim: newerTrigger,
      status: "active",
    });

    const delayedOlderTrigger = await beginEvent(database, {
      id: "evt_a",
      created: "2026-09-02T00:01:00Z",
    });
    await completeEvent(database, {
      id: "evt_a",
      claim: delayedOlderTrigger,
      status: "canceled",
    });

    const sameSecondSmallerId = await beginEvent(database, {
      id: "evt_0",
      created: "2026-09-02T00:02:00Z",
    });
    await completeEvent(database, {
      id: "evt_0",
      claim: sameSecondSmallerId,
      status: "active",
    });

    const state = await database.query(`
      SELECT
        status,
        last_stripe_event_id,
        last_stripe_event_created_at,
        last_stripe_observation_sequence
      FROM public.subscriptions
      WHERE stripe_subscription_id = 'sub_atomic'
    `);
    assert.equal(state.rows[0].status, "active");
    // The authoritative state follows the newest database observation, while
    // rollback-only audit columns retain their monotonic tuple maximum.
    assert.equal(state.rows[0].last_stripe_event_id, "evt_z");
    assert.equal(
      new Date(state.rows[0].last_stripe_event_created_at).toISOString(),
      "2026-09-02T00:02:00.000Z",
    );
    assert.equal(
      state.rows[0].last_stripe_observation_sequence,
      sameSecondSmallerId.observationSequence,
    );
  } finally {
    await database.close();
  }
});

test("missing mapping retries and converges after a fresh observation", async () => {
  const database = await createDatabase({ mapping: false });
  try {
    const first = await beginEvent(database, { id: "evt_unmapped" });
    await assert.rejects(
      () => completeEvent(database, { id: "evt_unmapped", claim: first }),
      /stripe_customer_mapping_missing/u,
    );
    const failed = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS ledger,
        (SELECT count(*)::integer FROM public.stripe_event_processing_claims) AS claims
    `);
    assert.deepEqual(failed.rows, [{ ledger: 0, claims: 1 }]);

    await database.query(
      `INSERT INTO public.stripe_customer_mappings
         (environment, stripe_customer_id, user_id)
       VALUES ('live', 'cus_trusted', $1::uuid)`,
      [userId],
    );
    await expireLease(database, "evt_unmapped");
    const retry = await beginEvent(database, { id: "evt_unmapped" });
    assert.ok(retry.observationSequence > first.observationSequence);
    await completeEvent(database, { id: "evt_unmapped", claim: retry });
    const applied = await database.query(
      "SELECT status FROM public.subscriptions WHERE stripe_subscription_id = 'sub_atomic'",
    );
    assert.deepEqual(applied.rows, [{ status: "active" }]);
  } finally {
    await database.close();
  }
});

test("account deletion makes a later lifecycle webhook terminal and orphaned", async () => {
  const database = await createDatabase();
  try {
    await database.query("DELETE FROM auth.users WHERE id = $1::uuid", [userId]);
    const mapping = await database.query(
      "SELECT user_id FROM public.stripe_customer_mappings WHERE stripe_customer_id = 'cus_trusted'",
    );
    assert.deepEqual(mapping.rows, [{ user_id: null }]);

    const claim = await beginEvent(database, {
      id: "evt_deleted_user",
      type: "customer.subscription.deleted",
      outcome: "subscription_deleted",
    });
    assert.deepEqual(
      await completeEvent(database, {
        id: "evt_deleted_user",
        claim,
        status: "canceled",
      }),
      { duplicate: false, orphaned: true, subscriptionApplied: false },
    );
    const ledger = await database.query(
      `SELECT outcome, processing_status, retryable
       FROM public.processed_stripe_events
       WHERE event_id = 'evt_deleted_user'`,
    );
    assert.deepEqual(ledger.rows, [
      {
        outcome: "orphaned_customer",
        processing_status: "completed",
        retryable: false,
      },
    ]);
    const claims = await database.query(
      "SELECT count(*)::integer AS count FROM public.stripe_event_processing_claims",
    );
    assert.deepEqual(claims.rows, [{ count: 0 }]);
  } finally {
    await database.close();
  }
});

test("non-applying events clear a matching subscription lease immediately", async () => {
  const database = await createDatabase();
  try {
    const ignored = await beginEvent(database, {
      id: "evt_trial_warning",
      type: "customer.subscription.trial_will_end",
      outcome: "observed",
    });
    assert.deepEqual(
      await completeEvent(database, {
        id: "evt_trial_warning",
        claim: ignored,
        apply: false,
      }),
      { duplicate: false, orphaned: false, subscriptionApplied: false },
    );

    const lifecycle = await beginEvent(database, {
      id: "evt_after_warning",
      created: "2026-09-02T00:00:01Z",
    });
    assert.equal(lifecycle.busy, false);
  } finally {
    await database.close();
  }
});

test("unregistered live Price cannot complete or grant entitlement", async () => {
  const database = await createDatabase();
  try {
    const claim = await beginEvent(database, { id: "evt_unknown_price" });
    await assert.rejects(
      () =>
        completeEvent(database, {
          id: "evt_unknown_price",
          claim,
          priceId: "price_unknown_live",
        }),
      /stripe_price_not_registered/u,
    );
    const counts = await database.query(`
      SELECT
        (SELECT count(*)::integer FROM public.subscriptions) AS subscriptions,
        (SELECT count(*)::integer FROM public.processed_stripe_events) AS ledger,
        (SELECT count(*)::integer FROM public.stripe_event_processing_claims) AS claims
    `);
    assert.deepEqual(counts.rows, [{ subscriptions: 0, ledger: 0, claims: 1 }]);
  } finally {
    await database.close();
  }
});

test("concurrent Checkout claims converge and freeze trial parameters", async () => {
  const database = await createDatabase();
  try {
    const [first, second] = await Promise.all([
      claimCheckout(database, { trialEligible: true }),
      claimCheckout(database, { trialEligible: false }),
    ]);
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.sessionExpiresAt, second.sessionExpiresAt);
    assert.equal(first.trialEligible, true);
    assert.equal(second.trialEligible, true);

    await assert.rejects(
      () => claimCheckout(database, { priceId: proPriceId, trialEligible: false }),
      /stripe_checkout_attempt_open/u,
    );

    await database.query(
      `
      UPDATE public.stripe_checkout_attempts
      SET session_expires_at = now() - interval '1 second'
      WHERE user_id = $1::uuid AND environment = 'live'
    `,
      [userId],
    );
    const rotated = await claimCheckout(database, {
      priceId: proPriceId,
      trialEligible: false,
    });
    assert.notEqual(rotated.idempotencyKey, first.idempotencyKey);
    assert.equal(rotated.trialEligible, false);
  } finally {
    await database.close();
  }
});

test("every nonterminal or unknown subscription status blocks Checkout", async () => {
  const blockingCases = [
    { status: "trialing", periodEnd: "now() + interval '30 days'" },
    { status: "active", periodEnd: "now() + interval '30 days'" },
    { status: "past_due", periodEnd: "now() + interval '30 days'" },
    { status: "incomplete", periodEnd: "now() + interval '30 days'" },
    { status: "unpaid", periodEnd: "now() + interval '30 days'" },
    { status: "paused", periodEnd: "now() + interval '30 days'" },
    { status: "future_status", periodEnd: "now() + interval '30 days'" },
    { status: "canceled", periodEnd: "now() + interval '30 days'" },
    { status: "canceled", periodEnd: "NULL" },
  ];
  for (const [index, entry] of blockingCases.entries()) {
    const database = await createDatabase();
    try {
      await database.query(
        `INSERT INTO public.subscriptions (
          user_id, stripe_subscription_id, stripe_customer_id, product_id,
          price_id, status, current_period_end, cancel_at_period_end, environment
        ) VALUES (
          $1::uuid, $2, 'cus_trusted', 'prod_plus',
          $3, $4, ${entry.periodEnd}, true, 'live'
        )`,
        [userId, `sub_blocking_${index}`, plusPriceId, entry.status],
      );
      await assert.rejects(
        () => claimCheckout(database),
        /stripe_active_subscription_exists/u,
        `${entry.status} must block a new Checkout attempt`,
      );
    } finally {
      await database.close();
    }
  }
});

test("only terminal subscription rows permit a new Checkout attempt", async () => {
  for (const entry of [
    { status: "incomplete_expired", periodEnd: "NULL" },
    { status: "canceled", periodEnd: "now() - interval '1 second'" },
  ]) {
    const database = await createDatabase();
    try {
      await database.query(
        `INSERT INTO public.subscriptions (
          user_id, stripe_subscription_id, stripe_customer_id, product_id,
          price_id, status, current_period_end, cancel_at_period_end, environment
        ) VALUES (
          $1::uuid, 'sub_terminal', 'cus_trusted', 'prod_plus',
          $2, $3, ${entry.periodEnd}, false, 'live'
        )`,
        [userId, plusPriceId, entry.status],
      );
      const attempt = await claimCheckout(database);
      assert.equal(attempt.trialEligible, true);
      assert.equal(typeof attempt.idempotencyKey, "string");
    } finally {
      await database.close();
    }
  }
});
