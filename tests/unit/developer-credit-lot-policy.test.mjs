import assert from "node:assert/strict";
import test from "node:test";
import {
  PRO_API_ALLOWANCE_USD_MINOR,
  purchasedCreditExpiresAt,
  planDeveloperCreditReservation,
} from "../../src/lib/pricing/developer-credit-lot-policy.mjs";

const now = "2026-11-26T12:00:00.000Z";
const lots = [
  { id: "later", kind: "purchased", availableTicks: 90n, expiresAt: "2027-11-26T12:00:00.000Z" },
  { id: "earlier", kind: "purchased", availableTicks: 50n, expiresAt: "2027-02-01T12:00:00.000Z" },
  {
    id: "included",
    kind: "included_pro",
    availableTicks: 80n,
    expiresAt: "2026-12-01T12:00:00.000Z",
  },
  { id: "expired", kind: "purchased", availableTicks: 999n, expiresAt: now },
];
test("annual purchase expiry is per purchase, UTC, with February leap-day handling", () => {
  assert.equal(PRO_API_ALLOWANCE_USD_MINOR, 8000);
  assert.equal(purchasedCreditExpiresAt(now), "2027-11-26T12:00:00.000Z");
  assert.equal(purchasedCreditExpiresAt("2024-02-29T23:59:59.999Z"), "2025-02-28T23:59:59.999Z");
  assert.equal(purchasedCreditExpiresAt("2023-02-28T23:59:59.999Z"), "2024-02-28T23:59:59.999Z");
  assert.throws(() => purchasedCreditExpiresAt("2026-02-30T00:00:00.000Z"), /date_invalid/);
});
test("API uses included eligible Pro credits, then earliest-expiring purchased lots", () => {
  assert.deepEqual(
    planDeveloperCreditReservation({
      lots,
      requestedTicks: 140n,
      now,
      surface: "api",
      proEligible: true,
    }),
    [
      { lotId: "included", ticks: 80n },
      { lotId: "earlier", ticks: 50n },
      { lotId: "later", ticks: 10n },
    ],
  );
  assert.deepEqual(
    planDeveloperCreditReservation({ lots, requestedTicks: 80n, now, surface: "api" }),
    [
      { lotId: "earlier", ticks: 50n },
      { lotId: "later", ticks: 30n },
    ],
  );
});
test("consumer funding defaults off and never spends included Pro API allowance", () => {
  const request = { lots, requestedTicks: 100n, now, surface: "consumer", proEligible: true };
  assert.equal(planDeveloperCreditReservation(request), null);
  assert.deepEqual(planDeveloperCreditReservation({ ...request, consumerOptIn: true }), [
    { lotId: "earlier", ticks: 50n },
    { lotId: "later", ticks: 50n },
  ]);
  assert.equal(
    planDeveloperCreditReservation({ ...request, consumerOptIn: true, requestedTicks: 141n }),
    null,
  );
});
test("reservation planning is exact, nonmutating and fails closed for duplicate lots", () => {
  assert.equal(
    planDeveloperCreditReservation({
      lots,
      requestedTicks: 221n,
      now,
      surface: "api",
      proEligible: true,
    }),
    null,
  );
  assert.equal(lots[0].availableTicks, 90n);
  assert.throws(
    () =>
      planDeveloperCreditReservation({
        lots: [...lots, lots[0]],
        requestedTicks: 1n,
        now,
        surface: "api",
      }),
    /lot_invalid/,
  );
  assert.throws(
    () => planDeveloperCreditReservation({ lots, requestedTicks: 1.1, now, surface: "api" }),
    /amount_invalid/,
  );
});
