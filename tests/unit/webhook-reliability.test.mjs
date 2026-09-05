import assert from "node:assert/strict";
import test from "node:test";
import { processGitHubDelivery } from "../../src/lib/webhook-reliability.mjs";

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
