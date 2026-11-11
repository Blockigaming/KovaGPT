import test from "node:test";
import assert from "node:assert/strict";
import { selectEligibleCampaignRows } from "../../src/lib/notification-campaign-policy.mjs";
import { safePersistedNoticeActionUrl } from "../../src/lib/persisted-notification-policy.mjs";

const campaign = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  event_id: "whats_new",
  release_id: "2026-november",
  title: "A Kova feature is ready",
  body: "Explore the new capability.",
  action_path: "/images",
  allowed_tiers: ["free", "plus"],
};
const select = (rows, overrides = {}) =>
  selectEligibleCampaignRows(rows, {
    tier: "free",
    dismissedIds: new Set(),
    allowedEventIds: new Set(["whats_new"]),
    safeActionUrl: safePersistedNoticeActionUrl,
    ...overrides,
  });

test("eligible announcements require the actual account tier and valid campaign metadata", () => {
  assert.deepEqual(select([campaign]), [campaign]);
  assert.deepEqual(select([campaign], { tier: "pro" }), []);
  assert.deepEqual(select([campaign], { tier: "unknown" }), []);
  assert.deepEqual(select([{ ...campaign, event_id: "offer_claimed" }]), []);
  assert.deepEqual(select([{ ...campaign, action_path: "https://other.test" }]), []);
  assert.deepEqual(select([{ ...campaign, allowed_tiers: ["plus"] }]), []);
  assert.deepEqual(select([{ ...campaign, release_id: "" }]), []);
  assert.deepEqual(select([{ ...campaign, title: " " }]), []);
  assert.deepEqual(select([{ ...campaign, body: "" }]), []);
});

test("dismissed campaigns are suppressed and only two are returned per account", () => {
  assert.deepEqual(select([campaign], { dismissedIds: new Set([campaign.id]) }), []);
  const rows = [
    campaign,
    { ...campaign, id: "650e8400-e29b-41d4-a716-446655440001" },
    { ...campaign, id: "750e8400-e29b-41d4-a716-446655440002" },
  ];
  assert.equal(select(rows).length, 2);
  assert.deepEqual(select(null), []);
});
