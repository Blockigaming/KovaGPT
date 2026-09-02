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
    if (!this.operation) this.operation = "select";
    this.columns = columns;
    return this;
  }

  insert(value) {
    this.operation = "insert";
    this.value = value;
    return this;
  }

  upsert(value, options) {
    this.operation = "upsert";
    this.value = value;
    this.options = options;
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
    assert.equal(this.table, step.table);
    assert.equal(this.operation, step.operation);
    this.database.calls.push(this);
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
}

const subscription = {
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  metadata: { userId: "untrusted_stripe_metadata" },
  items: {
    data: [
      {
        price: { lookup_key: "plus_monthly", product: "prod_123" },
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
    resolvePriceId: (item) => item?.price?.lookup_key,
    retrieveSubscription: async (id) => {
      assert.equal(id, "sub_123");
      return subscription;
    },
    billingOutcome: () => "subscription_updated",
    correlationId: "11111111-1111-1111-1111-111111111111",
    now: () => "2026-09-01T00:00:00.000Z",
    ...overrides,
  });

const successfulSteps = () => [
  {
    table: "processed_stripe_events",
    operation: "select",
    result: { data: null, error: null },
  },
  {
    table: "stripe_customer_mappings",
    operation: "select",
    result: { data: { user_id: "trusted_database_user" }, error: null },
  },
  {
    table: "subscriptions",
    operation: "select",
    result: { data: null, error: null },
  },
  {
    table: "subscriptions",
    operation: "upsert",
    result: { data: { stripe_subscription_id: "sub_123" }, error: null },
  },
  {
    table: "processed_stripe_events",
    operation: "insert",
    result: { data: { event_id: "evt_123" }, error: null },
  },
];

test("Stripe records completion only after a checked authoritative subscription upsert", async () => {
  const database = new FakeSupabase(successfulSteps());
  assert.deepEqual(await processStripe(database), { duplicate: false });

  assert.deepEqual(
    database.calls.map((call) => `${call.table}.${call.operation}`),
    [
      "processed_stripe_events.select",
      "stripe_customer_mappings.select",
      "subscriptions.select",
      "subscriptions.upsert",
      "processed_stripe_events.insert",
    ],
  );
  const mutation = database.calls.find((call) => call.operation === "upsert");
  assert.equal(mutation.value.user_id, "trusted_database_user");
  assert.equal(mutation.value.stripe_customer_id, "cus_123");
  assert.deepEqual(mutation.options, {
    onConflict: "stripe_subscription_id,environment",
  });
  const completion = database.calls.at(-1).value;
  assert.equal(completion.event_id, "evt_123");
  assert.equal(completion.subscription_id, "sub_123");
});

test("a failed mutation remains retryable because no completion row is inserted", async () => {
  const steps = successfulSteps();
  steps[3].result = {
    data: null,
    error: { code: "08006", message: "connection failed" },
  };
  const database = new FakeSupabase(steps.slice(0, 4));

  await assert.rejects(() => processStripe(database), /subscription_upsert_failed/);
  assert.equal(
    database.calls.some(
      (call) => call.table === "processed_stripe_events" && call.operation === "insert",
    ),
    false,
  );
});

test("concurrent completion insert conflicts are acknowledged only after mutation", async () => {
  const steps = successfulSteps();
  steps[4].result = { data: null, error: { code: "23505" } };
  const database = new FakeSupabase(steps);

  assert.deepEqual(await processStripe(database), { duplicate: true });
  assert.equal(database.calls.at(-2).operation, "upsert");
  assert.equal(database.calls.at(-1).operation, "insert");
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
  const steps = successfulSteps();
  steps[4].result = { data: { event_id: "evt_invoice" }, error: null };
  const database = new FakeSupabase(steps);
  const retrieved = [];
  await processStripe(database, event, {
    retrieveSubscription: async (id) => {
      retrieved.push(id);
      return subscription;
    },
  });
  assert.deepEqual(retrieved, ["sub_123"]);
  assert.equal(database.calls.at(-1).value.invoice_id, "in_123");
});

test("a completion-ledger lookup outage returns a retryable processing error", async () => {
  const database = new FakeSupabase([
    {
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
