import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { stripeEventMatchesEnvironment } from "../../src/lib/stripe-event-mode.mjs";

test("signed Stripe Event mode must exactly match the selected environment", async () => {
  assert.equal(stripeEventMatchesEnvironment(true, "live"), true);
  assert.equal(stripeEventMatchesEnvironment(false, "sandbox"), true);
  assert.equal(stripeEventMatchesEnvironment(false, "live"), false);
  assert.equal(stripeEventMatchesEnvironment(true, "sandbox"), false);
  assert.equal(stripeEventMatchesEnvironment(undefined, "live"), false);

  const source = await readFile(new URL("../../src/lib/stripe.server.ts", import.meta.url), "utf8");
  assert.match(source, /livemode: boolean/);
  assert.match(source, /stripeEventMatchesEnvironment\(event\.livemode, env\)/);
  assert.match(
    source,
    /crypto\.subtle\.sign[\s\S]*timingSafeEqualText[\s\S]*parseVerifiedStripeEvent\(body, env\)/,
  );
});
