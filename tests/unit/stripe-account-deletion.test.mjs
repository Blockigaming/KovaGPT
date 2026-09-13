import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cancelAuthoritativeStripeSubscriptions,
  retireStripeCustomerForAccountDeletion,
} from "../../src/lib/stripe-account-deletion.mjs";

function stripeFixture(subscriptions, overrides = {}) {
  const calls = { list: [], cancel: [], retrieve: [] };
  const stripe = {
    customers: {
      async retrieve(id) {
        return { id, deleted: false };
      },
      async del(id) {
        return { id, deleted: true };
      },
    },
    subscriptions: {
      list(params) {
        calls.list.push(params);
        return {
          async *[Symbol.asyncIterator]() {
            for (const subscription of subscriptions) yield subscription;
          },
        };
      },
      async cancel(id) {
        calls.cancel.push(id);
        return { id, status: "canceled" };
      },
      async retrieve(id) {
        calls.retrieve.push(id);
        return { id, status: "canceled" };
      },
      ...overrides,
    },
  };
  return { calls, stripe };
}

test("deletion paginates the mapped Customer and cancels every nonterminal status", async () => {
  const rows = [
    { id: "sub_active", status: "active" },
    { id: "sub_incomplete", status: "incomplete" },
    { id: "sub_unpaid", status: "unpaid" },
    { id: "sub_paused", status: "paused" },
    { id: "sub_future", status: "future_status" },
    { id: "sub_canceled", status: "canceled" },
    { id: "sub_expired", status: "incomplete_expired" },
  ];
  const { calls, stripe } = stripeFixture(rows);
  assert.deepEqual(
    await cancelAuthoritativeStripeSubscriptions({
      stripe,
      customerId: "cus_authoritative",
    }),
    { examined: rows.length, canceled: 5 },
  );
  assert.deepEqual(calls.list, [{ customer: "cus_authoritative", status: "all", limit: 100 }]);
  assert.deepEqual(calls.cancel, [
    "sub_active",
    "sub_incomplete",
    "sub_unpaid",
    "sub_paused",
    "sub_future",
  ]);
});

test("a concurrent cancellation is idempotent only when a fresh GET proves terminal", async () => {
  const { calls, stripe } = stripeFixture([{ id: "sub_race", status: "active" }], {
    async cancel(id) {
      calls.cancel.push(id);
      throw new Error("already canceled");
    },
    async retrieve(id) {
      calls.retrieve.push(id);
      return { id, status: "canceled" };
    },
  });
  assert.deepEqual(
    await cancelAuthoritativeStripeSubscriptions({
      stripe,
      customerId: "cus_race",
    }),
    { examined: 1, canceled: 0 },
  );
  assert.deepEqual(calls.retrieve, ["sub_race"]);
});

test("deletion fails closed when cancellation cannot be proven", async () => {
  const { stripe } = stripeFixture([{ id: "sub_still_open", status: "active" }], {
    async cancel() {
      throw new Error("network failed");
    },
    async retrieve(id) {
      return { id, status: "active" };
    },
  });
  await assert.rejects(
    () =>
      cancelAuthoritativeStripeSubscriptions({
        stripe,
        customerId: "cus_failure",
      }),
    /network failed/u,
  );
});

test("Customer deletion closes a Checkout race after the subscription scan", async () => {
  const state = {
    deleted: false,
    subscriptions: [],
  };
  const stripe = {
    subscriptions: {
      list() {
        return {
          async *[Symbol.asyncIterator]() {
            // No subscription exists at scan time.
          },
        };
      },
      async cancel(id) {
        const subscription = state.subscriptions.find((row) => row.id === id);
        if (subscription) subscription.status = "canceled";
        return { id, status: "canceled" };
      },
      async retrieve(id) {
        return state.subscriptions.find((row) => row.id === id);
      },
    },
    customers: {
      async retrieve(id) {
        return { id, deleted: state.deleted };
      },
      async del(id) {
        // A Checkout completion wins the race after list() but before deletion.
        state.subscriptions.push({ id: "sub_raced", status: "active" });
        state.deleted = true;
        for (const subscription of state.subscriptions) {
          subscription.status = "canceled";
        }
        return { id, deleted: true };
      },
    },
  };

  assert.deepEqual(
    await retireStripeCustomerForAccountDeletion({
      stripe,
      customerId: "cus_racebarrier",
    }),
    { alreadyDeleted: false, examined: 0, canceled: 0 },
  );
  assert.equal(state.deleted, true);
  assert.deepEqual(state.subscriptions, [{ id: "sub_raced", status: "canceled" }]);
});

test("Customer retirement is idempotent only with an exact deleted-Customer proof", async () => {
  let listed = false;
  let deleted = false;
  const stripe = {
    subscriptions: {
      list() {
        listed = true;
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
    },
    customers: {
      async retrieve(id) {
        return { id, deleted: true };
      },
      async del() {
        deleted = true;
      },
    },
  };
  assert.deepEqual(
    await retireStripeCustomerForAccountDeletion({
      stripe,
      customerId: "cus_alreadydeleted",
    }),
    { alreadyDeleted: true, examined: 0, canceled: 0 },
  );
  assert.equal(listed, false);
  assert.equal(deleted, false);
});

test("account deletion uses mappings and the Customer barrier before auth removal", async () => {
  const source = await readFile(
    new URL("../../src/routes/api/account.ts", import.meta.url),
    "utf8",
  );
  const fence = source.lastIndexOf("cleanupAccountExportsBeforeAccountDeletion(");
  const prepare = source.indexOf("preparedBilling = await prepareStripeAccountDeletion");
  const storage = source.lastIndexOf("cleanupOwnedStorageBeforeAccountDeletion(");
  const cleanup = source.indexOf("await disconnectAllOAuth(auth.userId)");
  const authoritative = source.lastIndexOf("retireStripeCustomerForAccountDeletion");
  const authDelete = source.indexOf("auth.admin.deleteUser(");
  assert.ok(fence >= 0 && prepare > fence && storage > prepare);
  assert.ok(authoritative > storage && cleanup > authoritative && authDelete > cleanup);
  assert.doesNotMatch(
    source,
    /createStripeClient\(environment\)\.subscriptions\.cancel\(\s*subscription\.stripe_subscription_id/,
  );
});
