import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveStripeCustomerId } from "../../src/lib/stripe-customer-mapping.mjs";

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

test("an environment-scoped mapping is the only existing-customer identity source", async () => {
  const supabase = new FakeSupabase([
    {
      table: "stripe_customer_mappings",
      operation: "select",
      result: { data: { stripe_customer_id: "cus_mapped" }, error: null },
    },
  ]);
  const stripe = {
    customers: {
      create: async () => assert.fail("must not create when a mapping exists"),
    },
  };

  assert.equal(
    await resolveStripeCustomerId({
      stripe,
      supabase,
      environment: "live",
      userId: "user_123",
      email: "same@example.com",
    }),
    "cus_mapped",
  );
  assert.deepEqual(supabase.calls[0].filters, [
    ["environment", "live"],
    ["user_id", "user_123"],
  ]);
});

test("a new Customer is inserted with a checked durable mapping", async () => {
  const supabase = new FakeSupabase([
    {
      table: "stripe_customer_mappings",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      table: "stripe_customer_mappings",
      operation: "insert",
      result: { data: { stripe_customer_id: "cus_new" }, error: null },
    },
  ]);
  const calls = [];
  const stripe = {
    customers: {
      create: async (...args) => {
        calls.push(args);
        return { id: "cus_new" };
      },
    },
  };

  assert.equal(
    await resolveStripeCustomerId({
      stripe,
      supabase,
      environment: "sandbox",
      userId: "user_456",
      email: "contact@example.com",
    }),
    "cus_new",
  );
  assert.deepEqual(calls[0], [
    {
      email: "contact@example.com",
      metadata: { userId: "user_456", environment: "sandbox" },
    },
    { idempotencyKey: "kova-customer-sandbox-user_456" },
  ]);
  assert.deepEqual(supabase.calls[1].value, {
    environment: "sandbox",
    stripe_customer_id: "cus_new",
    user_id: "user_456",
  });
});

test("a concurrent mapping insert returns the database winner", async () => {
  const supabase = new FakeSupabase([
    {
      table: "stripe_customer_mappings",
      operation: "select",
      result: { data: null, error: null },
    },
    {
      table: "stripe_customer_mappings",
      operation: "insert",
      result: { data: null, error: { code: "23505" } },
    },
    {
      table: "stripe_customer_mappings",
      operation: "select",
      result: { data: { stripe_customer_id: "cus_winner" }, error: null },
    },
  ]);
  const stripe = { customers: { create: async () => ({ id: "cus_loser" }) } };

  assert.equal(
    await resolveStripeCustomerId({
      stripe,
      supabase,
      environment: "live",
      userId: "user_789",
    }),
    "cus_winner",
  );
});

test("checkout never reassigns a Stripe Customer by email", async () => {
  const source = await readFile(
    new URL("../../src/utils/payments.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolveStripeCustomerId/u);
  assert.doesNotMatch(source, /customers\.(?:list|search|update)/u);
});
