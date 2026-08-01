import assert from "node:assert/strict";
import test from "node:test";

import { parseAllowedBillingPortalUrl } from "../../src/lib/billing-portal-url.mjs";

test("accepts only normalized HTTPS Stripe billing portal URLs", () => {
  assert.equal(
    parseAllowedBillingPortalUrl("https://billing.stripe.com/p/session/test_123"),
    "https://billing.stripe.com/p/session/test_123",
  );
  assert.equal(parseAllowedBillingPortalUrl("http://billing.stripe.com/p/session/test_123"), null);
  assert.equal(
    parseAllowedBillingPortalUrl("https://billing.stripe.com.evil.example/p/session/test_123"),
    null,
  );
  assert.equal(parseAllowedBillingPortalUrl("https://evil.example/?next=billing.stripe.com"), null);
  assert.equal(parseAllowedBillingPortalUrl("https://user@billing.stripe.com/p/session/test"), null);
  assert.equal(parseAllowedBillingPortalUrl("not-a-url"), null);
});
