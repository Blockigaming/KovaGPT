import assert from "node:assert/strict";
import test from "node:test";

import { invoiceSubscriptionId, processStripeEvent } from "../../src/lib/webhook-reliability.mjs";

const leaseToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class FakeSupabase {
  constructor(steps) {
    this.steps = [...steps];
    this.calls = [];
  }

  rpc(name, args) {
    const step = this.steps.shift();
    assert.ok(step, `unexpected rpc ${name}`);
    assert.equal(step.name, name);
    this.calls.push({ name, args });
    return Promise.resolve(step.result);
  }
}

const subscription = {
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  metadata: { userId: "untrusted_stripe_metadata" },
  items: {
    has_more: false,
    data: [
      {
        price: {
          id: "price_1UAzhHAEZlsb6DBYWw2oUCeO",
          lookup_key: "plus_monthly",
          product: "prod_123",
        },
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
      },
    ],
  },
};

const subscriptionEvent = {
  id: "evt_123",
  created: 1_700_000_100,
  type: "customer.subscription.updated",
  data: { object: { id: "sub_123" } },
};

const successfulSteps = () => [
  {
    name: "begin_stripe_event",
    result: {
      data: {
        duplicate: false,
        busy: false,
        observationSequence: 41,
        leaseToken,
        leaseExpiresAt: "2026-09-02T00:01:30Z",
      },
      error: null,
    },
  },
  {
    name: "complete_stripe_event",
    result: {
      data: {
        duplicate: false,
        orphaned: false,
        subscriptionApplied: true,
      },
      error: null,
    },
  },
];

const processStripe = (supabase, event = subscriptionEvent, overrides = {}) =>
  processStripeEvent({
    supabase,
    event,
    environment: "live",
    resolvePriceId: async (item) => item?.price?.id,
    retrieveSubscription: async (id) => {
      assert.equal(id, "sub_123");
      return subscription;
    },
    billingOutcome: () => "subscription_updated",
    correlationId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  });

test("Stripe claims before GET and atomically completes an authoritative snapshot", async () => {
  const database = new FakeSupabase(successfulSteps());
  let retrieveObservedCalls = 0;
  const result = await processStripe(database, subscriptionEvent, {
    retrieveSubscription: async (id) => {
      assert.equal(id, "sub_123");
      retrieveObservedCalls = database.calls.length;
      return subscription;
    },
  });
  assert.deepEqual(result, { duplicate: false, orphaned: false });
  assert.equal(retrieveObservedCalls, 1);
  assert.equal(database.calls.length, 2);

  const begin = database.calls[0].args;
  assert.equal(begin._subscription_id, "sub_123");
  assert.equal(begin._event_id, "evt_123");
  assert.equal(begin._environment, "live");

  const completion = database.calls[1].args;
  assert.equal(completion._lease_token, leaseToken);
  assert.equal(completion._observation_sequence, 41);
  assert.equal(completion._customer_id, "cus_123");
  assert.equal(completion._price_id, "price_1UAzhHAEZlsb6DBYWw2oUCeO");
  assert.equal(completion._environment, "live");
  assert.equal("user_id" in completion, false);
  assert.equal("_subscription_id" in completion, false);
});

test("completed duplicates and active leases do not fetch Stripe", async () => {
  for (const [claim, expected, errorCode] of [
    [
      {
        duplicate: true,
        busy: false,
        observationSequence: 40,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      { duplicate: true, orphaned: false },
      null,
    ],
    [
      {
        duplicate: false,
        busy: true,
        observationSequence: 40,
        leaseToken: null,
        leaseExpiresAt: "2026-09-02T00:01:30Z",
      },
      null,
      "stripe_event_busy",
    ],
  ]) {
    const database = new FakeSupabase([
      { name: "begin_stripe_event", result: { data: claim, error: null } },
    ]);
    let retrieves = 0;
    const promise = processStripe(database, subscriptionEvent, {
      retrieveSubscription: async () => {
        retrieves += 1;
        return subscription;
      },
    });
    if (errorCode) {
      await assert.rejects(
        () => promise,
        (error) => error.code === errorCode && error.status === 503,
      );
    } else {
      assert.deepEqual(await promise, expected);
    }
    assert.equal(retrieves, 0);
    assert.equal(database.calls.length, 1);
  }
});

test("GET or completion failure remains retryable behind the database lease", async () => {
  const retrieveDatabase = new FakeSupabase(successfulSteps().slice(0, 1));
  await assert.rejects(
    () =>
      processStripe(retrieveDatabase, subscriptionEvent, {
        retrieveSubscription: async () => {
          throw new Error("network");
        },
      }),
    (error) => error.code === "stripe_subscription_retrieve_failed" && error.status === 500,
  );
  assert.equal(retrieveDatabase.calls.length, 1);

  const completionSteps = successfulSteps();
  completionSteps[1].result = {
    data: null,
    error: { code: "08006", message: "connection failed" },
  };
  const completionDatabase = new FakeSupabase(completionSteps);
  await assert.rejects(
    () => processStripe(completionDatabase),
    (error) => error.code === "stripe_event_completion_failed" && error.status === 500,
  );
  assert.equal(completionDatabase.calls.length, 2);
});

test("terminal orphan outcome is propagated without granting identity", async () => {
  const steps = successfulSteps();
  steps[1].result = {
    data: {
      duplicate: false,
      orphaned: true,
      subscriptionApplied: false,
    },
    error: null,
  };
  const database = new FakeSupabase(steps);
  assert.deepEqual(await processStripe(database), {
    duplicate: false,
    orphaned: true,
  });
});

test("Dahlia invoices use parent subscription identity and refresh the snapshot", async () => {
  const invoice = {
    id: "in_123",
    subscription: "sub_legacy_must_not_be_used",
    customer: "cus_123",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: { id: "sub_123" } },
    },
  };
  assert.equal(invoiceSubscriptionId(invoice), "sub_123");
  assert.equal(invoiceSubscriptionId({ subscription: "sub_legacy" }), null);

  const event = {
    id: "evt_invoice",
    created: 1_700_000_200,
    type: "invoice.paid",
    data: { object: invoice },
  };
  const database = new FakeSupabase(successfulSteps());
  await processStripe(database, event);
  assert.equal(database.calls[0].args._invoice_id, "in_123");
  assert.equal(database.calls[0].args._subscription_id, "sub_123");
  assert.equal(database.calls[1].args._apply_subscription, true);
});

test("non-applying subscription-adjacent event still completes its lease", async () => {
  const event = {
    id: "evt_trial_warning",
    created: 1_700_000_300,
    type: "customer.subscription.trial_will_end",
    data: { object: { id: "sub_123", customer: "cus_123" } },
  };
  const steps = successfulSteps();
  steps[1].result.data.subscriptionApplied = false;
  const database = new FakeSupabase(steps);
  let retrieves = 0;
  await processStripe(database, event, {
    retrieveSubscription: async () => {
      retrieves += 1;
      return subscription;
    },
  });
  assert.equal(retrieves, 0);
  assert.equal(database.calls[0].args._subscription_id, "sub_123");
  assert.equal(database.calls[1].args._apply_subscription, false);
});

test("authoritative snapshots reject ambiguous or paginated subscription items", async () => {
  const invalidItems = [
    { data: [], has_more: false },
    {
      data: [
        subscription.items.data[0],
        { ...subscription.items.data[0], price: { ...subscription.items.data[0].price } },
      ],
      has_more: false,
    },
    { data: [subscription.items.data[0]], has_more: true },
    { data: [subscription.items.data[0]] },
  ];

  for (const items of invalidItems) {
    const database = new FakeSupabase(successfulSteps().slice(0, 1));
    await assert.rejects(
      () =>
        processStripe(database, subscriptionEvent, {
          retrieveSubscription: async () => ({ ...subscription, items }),
        }),
      (error) =>
        error.code === "authoritative_subscription_items_ambiguous" && error.status === 500,
    );
    assert.equal(database.calls.length, 1);
  }
});
