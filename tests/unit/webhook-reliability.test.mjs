import assert from "node:assert/strict";
import test from "node:test";
import { processGitHubDelivery, processStripeEvent } from "../../src/lib/webhook-reliability.mjs";

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = null;
    this.value = null;
    this.options = null;
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

  update(value) {
    this.operation = "update";
    this.value = value;
    return this;
  }

  delete() {
    this.operation = "delete";
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
    this.database.calls.push({
      table: this.table,
      operation: this.operation,
      value: this.value,
      options: this.options,
      filters: this.filters,
    });
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

  async rpc(name, args) {
    const step = this.steps.shift();
    assert.ok(step, `unexpected rpc ${name}`);
    assert.equal(step.rpc, name);
    this.calls.push({ rpc: name, args });
    return step.result;
  }

  done() {
    assert.deepEqual(this.steps, []);
  }
}

const stripeEvent = (type = "customer.subscription.updated") => ({
  id: "evt_123",
  type,
  created: 1_700_000_100,
  data: {
    object: {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      metadata: { userId: "11111111-1111-4111-8111-111111111111" },
      items: {
        data: [
          {
            price: { lookup_key: "plus_monthly", product: "prod_123" },
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
          },
        ],
      },
    },
  },
});

const processStripe = (supabase, event = stripeEvent(), retrieveSubscription) =>
  processStripeEvent({
    supabase,
    event,
    environment: "live",
    resolvePriceId: (item) => item?.price?.lookup_key,
    retrieveSubscription: retrieveSubscription ?? (async () => event.data.object),
    correlationId: "22222222-2222-4222-8222-222222222222",
  });

test("Stripe database failures are retryable and cannot acknowledge or claim an event", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      rpc: "process_stripe_webhook_event",
      result: { data: null, error: { code: "08006", message: "connection failed" } },
    },
  ]);

  await assert.rejects(
    () => processStripe(database),
    (error) => error.code === "stripe_event_transaction_failed" && error.status === 500,
  );
  assert.deepEqual(
    database.calls.map((call) => call.rpc ?? `${call.table}.${call.operation}`),
    ["processed_stripe_events.select", "process_stripe_webhook_event"],
  );
  database.done();
});

test("a subscription update received before create passes a complete canonical snapshot atomically", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      rpc: "process_stripe_webhook_event",
      result: { data: [{ duplicate: false, applied: true }], error: null },
    },
  ]);

  assert.deepEqual(await processStripe(database), { duplicate: false, applied: true });
  const mutation = database.calls.find((call) => call.rpc === "process_stripe_webhook_event");
  assert.equal(mutation.args.p_subscription.user_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(mutation.args.p_subscription.price_id, "plus_monthly");
  assert.equal(mutation.args.p_subscription.environment, "live");
  assert.equal(mutation.args.p_event_id, "evt_123");
  assert.equal(mutation.args.p_subscription_id, "sub_123");
  assert.equal(mutation.args.p_correlation_id, "22222222-2222-4222-8222-222222222222");
  database.done();
});

test("missing Stripe subscription metadata is retryable and never marks the event processed", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
  ]);
  const event = stripeEvent();
  delete event.data.object.metadata.userId;

  await assert.rejects(
    () => processStripe(database, event),
    (error) => error.code === "subscription_metadata_incomplete" && error.status === 422,
  );
  assert.equal(
    database.calls.some((call) => call.operation === "insert"),
    false,
  );
  database.done();
});

test("a duplicate Stripe event short-circuits before retrieval or mutation", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: { event_id: "evt_123" }, error: null },
    },
  ]);
  let retrievals = 0;

  assert.deepEqual(
    await processStripe(database, stripeEvent(), async () => {
      retrievals += 1;
      throw new Error("must not retrieve");
    }),
    { duplicate: true, applied: false },
  );
  assert.equal(retrievals, 0);
  assert.equal(
    database.calls.some((call) => call.rpc),
    false,
  );
  database.done();
});

test("invoice events resolve new Stripe parent subscription references and reconcile canonical state", async () => {
  const event = stripeEvent("invoice.paid");
  event.data.object = {
    id: "in_123",
    customer: "cus_123",
    parent: { subscription_details: { subscription: "sub_123" } },
  };
  const canonical = stripeEvent().data.object;
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      rpc: "process_stripe_webhook_event",
      result: { data: [{ duplicate: false, applied: true }], error: null },
    },
  ]);
  let retrievedId;

  assert.deepEqual(
    await processStripe(database, event, async (subscriptionId) => {
      retrievedId = subscriptionId;
      return canonical;
    }),
    { duplicate: false, applied: true },
  );
  assert.equal(retrievedId, "sub_123");
  const rpc = database.calls.find((call) => call.rpc === "process_stripe_webhook_event");
  assert.equal(rpc.args.p_subscription_id, "sub_123");
  assert.equal(rpc.args.p_invoice_id, "in_123");
  assert.equal(rpc.args.p_outcome, "payment_confirmed");
  database.done();
});

test("malformed Stripe transaction responses fail closed", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      rpc: "process_stripe_webhook_event",
      result: { data: [], error: null },
    },
  ]);

  await assert.rejects(
    () => processStripe(database),
    (error) => error.code === "stripe_event_transaction_invalid" && error.status === 500,
  );
  database.done();
});

test("GitHub distinguishes completed duplicates from a delivery-table outage", async () => {
  const duplicateDatabase = new FakeSupabase([
    {
      table: "github_webhook_deliveries",
      operation: "insert",
      result: { data: null, error: { code: "23505" } },
    },
    {
      table: "github_webhook_deliveries",
      operation: "select",
      result: { data: { delivery_id: "delivery_1", status: "processed" }, error: null },
    },
  ]);
  assert.deepEqual(
    await processGitHubDelivery({
      supabase: duplicateDatabase,
      delivery: "delivery_1",
      event: "push",
      payload: {},
      supported: new Set(["push"]),
    }),
    { duplicate: true },
  );
  duplicateDatabase.done();

  const outageDatabase = new FakeSupabase([
    {
      table: "github_webhook_deliveries",
      operation: "insert",
      result: { data: null, error: { code: "08006", message: "database unavailable" } },
    },
  ]);
  await assert.rejects(
    () =>
      processGitHubDelivery({
        supabase: outageDatabase,
        delivery: "delivery_2",
        event: "push",
        payload: {},
        supported: new Set(["push"]),
      }),
    /github_delivery_record_failed/,
  );
  outageDatabase.done();
});

test("GitHub revocation errors fail the delivery and return a retryable failure", async () => {
  const database = new FakeSupabase([
    {
      table: "github_webhook_deliveries",
      operation: "insert",
      result: { data: { delivery_id: "delivery_3", status: "received" }, error: null },
    },
    {
      table: "github_repositories",
      operation: "update",
      result: { data: null, error: { code: "42501", message: "denied" } },
    },
    {
      table: "github_webhook_deliveries",
      operation: "update",
      result: { data: { delivery_id: "delivery_3" }, error: null },
    },
  ]);

  await assert.rejects(
    () =>
      processGitHubDelivery({
        supabase: database,
        delivery: "delivery_3",
        event: "repository",
        payload: {
          action: "deleted",
          installation: { id: 17 },
          repository: { id: 42 },
        },
        supported: new Set(["repository"]),
        now: () => "2026-08-01T00:00:00.000Z",
      }),
    /github_repository_revoke_failed/,
  );
  assert.equal(database.calls.at(-1).value.status, "failed");
  database.done();
});

test("GitHub treats already-revoked or not-yet-discovered repository rows as idempotent no-ops", async () => {
  const database = new FakeSupabase([
    {
      table: "github_webhook_deliveries",
      operation: "insert",
      result: { data: { delivery_id: "delivery_zero", status: "received" }, error: null },
    },
    {
      table: "github_repositories",
      operation: "update",
      result: { data: [], error: null },
    },
    {
      table: "github_repositories",
      operation: "update",
      result: { data: [], error: null },
    },
    {
      table: "github_webhook_deliveries",
      operation: "update",
      result: { data: { delivery_id: "delivery_zero" }, error: null },
    },
  ]);

  assert.deepEqual(
    await processGitHubDelivery({
      supabase: database,
      delivery: "delivery_zero",
      event: "repository",
      payload: {
        action: "deleted",
        installation: { id: 17 },
        repository: { id: 42 },
      },
      supported: new Set(["repository"]),
      now: () => "2026-08-01T00:00:00.000Z",
    }),
    { duplicate: false },
  );
  assert.equal(database.calls.at(-1).value.status, "processed");
  database.done();
});

test("GitHub final-status errors are not acknowledged as success", async () => {
  const database = new FakeSupabase([
    {
      table: "github_webhook_deliveries",
      operation: "insert",
      result: { data: { delivery_id: "delivery_4", status: "received" }, error: null },
    },
    {
      table: "github_webhook_deliveries",
      operation: "update",
      result: { data: null, error: { code: "08006", message: "connection failed" } },
    },
    {
      table: "github_webhook_deliveries",
      operation: "update",
      result: { data: { delivery_id: "delivery_4" }, error: null },
    },
  ]);

  await assert.rejects(
    () =>
      processGitHubDelivery({
        supabase: database,
        delivery: "delivery_4",
        event: "workflow_run",
        payload: {},
        supported: new Set(["workflow_run"]),
      }),
    /github_delivery_finalize_failed/,
  );
  assert.equal(database.calls.at(-1).value.status, "failed");
  database.done();
});
