import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webhook = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
const plans = readFileSync("src/lib/billing-plans.ts", "utf8");

test("billing resolves Kova lookup keys without Lovable metadata compatibility", () => {
  assert.match(webhook, /lookup_key/u);
  assert.match(webhook, /metadata\?\.kova_plan/u);
  assert.match(webhook, /resolveBillingPlan\(candidate\)/u);
  assert.doesNotMatch(webhook, /lovable_(?:external_id|managed)/iu);
  assert.doesNotMatch(plans, /lovable/iu);
});
