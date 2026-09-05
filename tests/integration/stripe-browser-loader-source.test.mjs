import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Stripe.js uses the pure entry and initializes only for an opened checkout", async () => {
  const [stripe, checkout, hook, responsive, migration] = await Promise.all([
    read("src/lib/stripe.ts"),
    read("src/components/StripeEmbeddedCheckout.tsx"),
    read("src/hooks/useStripeCheckout.tsx"),
    read("tests/e2e/responsive.spec.ts"),
    read("tests/e2e/openai-migration.spec.ts"),
  ]);

  assert.match(stripe, /import \{ loadStripe \} from "@stripe\/stripe-js\/pure";/);
  assert.match(stripe, /import type \{ Stripe \} from "@stripe\/stripe-js";/);
  assert.doesNotMatch(stripe, /import \{[^}]*loadStripe[^}]*\} from "@stripe\/stripe-js";/);

  const initializer = stripe.slice(stripe.indexOf("export function getStripe"));
  assert.match(stripe, /let stripePromise: Promise<Stripe \| null> \| null = null;/);
  assert.doesNotMatch(stripe.slice(0, stripe.indexOf("export function getStripe")), /loadStripe\(/);
  assert.match(
    initializer,
    /if \(!stripePromise\)[\s\S]*stripePromise = loadStripe\(clientToken\)/,
  );

  assert.match(checkout, /<EmbeddedCheckoutProvider stripe=\{getStripe\(\)\}/);
  assert.match(
    hook,
    /const checkoutElement = isOpen && options \? <StripeEmbeddedCheckout \{\.\.\.options\} \/> : null;/,
  );

  for (const e2e of [responsive, migration]) {
    assert.doesNotMatch(e2e, /STRIPE_PAYMENT_PERMISSION_WARNING|permissions policy violation/);
  }
});
