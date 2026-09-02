import assert from "node:assert/strict";
import test from "node:test";

import { invoiceSubscriptionId, processStripeEvent } from "../../src/lib/webhook-reliability.mjs";

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = null;
    this.filters = [];
  }

  select(columns) {
    this.operation = "select";
    this.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() {
    return this;
  }

  then(resolve, reject) {
    const step = this.database.steps.shift();
    assert.ok(step, `unexpected ${this.table}.${this.operation}`);
    assert.equal(step.kind, "query");
    assert.equal(this.table, step.table);
    assert.equal(this.operation, step.operation);
    this.database.calls.push({ kind: "query", query: this });
    return Promise.resolve(step.result).then(resolve, reject);
  }
}

class FakeSupabase {
  constructor(steps) {
    this.steps = [...steps];
    this.calls = [];
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  rpc(name, args) {
    const step = this.steps.shift();
    assert.ok(step, `unexpected rpc ${name}`);
    assert.equal(step.kind, "rpc");
    assert.equal(name, step.name);
    this.calls.push({ kind: "rpc", name, args });
    return Promise.resolve(step.result);
  }
}

const subscription = {
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  metadata: { userId: "untrusted_stripe_metadata" },
  items: {
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

const processStripe = (supabase, event = subscriptionEvent, overrides = {}) =>
  processStripeEvent({
    supabase,
    event,
    environment: "live",
    resolvePriceId: (item) => item?.price?.id,
    retrieveSubscription: async (id) => {
      assert.equal(id, "sub_123");
      return subscription;
    },
    billingOutcome: () => "subscription_updated",
    correlationId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  });

const successfulSteps = () => [
  {
    kind: "query",
    table: "processed_stripe_events",
    operation: "select",
    result: { data: null, error: null },
  },
  {
    kind: "rpc",
    name: "complete_stripe_event",
    result: {
      data: { duplicate: false, stale: false, subscriptionApplied: true },
      error: null,
    },
  },
];

test("Stripe uses one atomic RPC and never trusts subscription metadata identity", async () => {
  const database = new FakeSupabase(successfulSteps());
  assert.deepEqual(await processStripe(database), { duplicate: false, stale: false });

  assert.equal(database.calls.length, 2);
  assert.equal(database.calls[1].name, "complete_stripe_event");
  const mutation = database.calls[1].args;
  assert.equal(mutation._customer_id, "cus_123");
  assert.equal(mutation._subscription_id, "sub_123");
  assert.equal(mutation._price_id, "price_1UAzhHAEZlsb6DBYWw2oUCeO");
  assert.equal(mutation._environment, "live");
  assert.equal(mutation._event_id, "evt_123");
  assert.equal("user_id" in mutation, false);
});

test("an RPC failure stays retryable and has no separate completion write", async () => {
  const steps = successfulSteps();
  steps[1].result = { data: null, error: { code: "08006", message: "connection failed" } };
  const database = new FakeSupabase(steps);
  await assert.rejects(
    () => processStripe(database),
    (error) => error.code === "stripe_event_completion_failed" && error.status === 500,
  );
  assert.equal(database.calls.length, 2);
});

test("a concurrent duplicate result is propagated", async () => {
  const steps = successfulSteps();
  steps[1].result = {
    data: { duplicate: true, stale: false, subscriptionApplied: false },
    error: null,
  };
  const database = new FakeSupabase(steps);
  assert.deepEqual(await processStripe(database), { duplicate: true, stale: false });
});

test("Dahlia invoices resolve only parent.subscription_details.subscription", async () => {
  const invoice = {
    id: "in_123",
    subscription: "sub_legacy_must_not_be_used",
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
  assert.equal(database.calls[1].args._invoice_id, "in_123");
  assert.equal(database.calls[1].args._subscription_id, "sub_123");
});

test("a completion-ledger lookup outage returns a retryable processing error", async () => {
  const database = new FakeSupabase([
    {
      kind: "query",
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: { code: "08006", message: "unavailable" } },
    },
  ]);
  await assert.rejects(
    () => processStripe(database),
    (error) => error.code === "stripe_event_lookup_failed" && error.status === 500,
  );
});
