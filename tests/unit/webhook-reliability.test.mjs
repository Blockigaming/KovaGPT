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

  done() {
    assert.deepEqual(this.steps, []);
  }
}

const stripeEvent = (type = "customer.subscription.updated") => ({
  id: "evt_123",
  type,
  data: {
    object: {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      metadata: { userId: "user_123" },
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

const processStripe = (supabase, event = stripeEvent()) =>
  processStripeEvent({
    supabase,
    event,
    environment: "live",
    resolvePriceId: (item) => item?.price?.lookup_key,
    now: () => "2026-08-01T00:00:00.000Z",
  });

test("Stripe retries a failed mutation and records the event only after success", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      table: "subscriptions",
      operation: "upsert",
      result: { data: null, error: { code: "08006", message: "connection failed" } },
    },
    {
      table: "processed_stripe_events",
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
  ]);

  await assert.rejects(() => processStripe(database), /subscription_upsert_failed/);
  assert.equal(
    database.calls.some((call) => call.operation === "insert"),
    false,
  );

  assert.deepEqual(await processStripe(database), { duplicate: false });
  assert.deepEqual(
    database.calls.map((call) => `${call.table}.${call.operation}`),
    [
      "processed_stripe_events.select",
      "subscriptions.upsert",
      "processed_stripe_events.select",
      "subscriptions.upsert",
      "processed_stripe_events.insert",
    ],
  );
  database.done();
});

test("a subscription update received before create idempotently upserts the complete row", async () => {
  const database = new FakeSupabase([
    {
      table: "processed_stripe_events",
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
  ]);

  await processStripe(database);
  const mutation = database.calls.find((call) => call.table === "subscriptions");
  assert.equal(mutation.operation, "upsert");
  assert.deepEqual(mutation.options, { onConflict: "stripe_subscription_id" });
  assert.equal(mutation.value.user_id, "user_123");
  assert.equal(mutation.value.price_id, "plus_monthly");
  assert.equal(mutation.value.environment, "live");
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
