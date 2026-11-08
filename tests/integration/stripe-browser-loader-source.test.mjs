import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("hosted checkout needs no Stripe.js; legacy SDK loading remains lazy", async () => {
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
    /if \(!stripePromise\)[\s\S]*getBillingClientConfiguration\(\)[\s\S]*loadStripe\(token\)/,
  );

  assert.doesNotMatch(checkout, /getStripe\(|EmbeddedCheckoutProvider|<iframe/);
  assert.match(checkout, /createCheckoutSession/);
  assert.match(checkout, /window\.location\.assign\(url\.href\)/);
  assert.match(checkout, /url\.origin !== "https:\/\/checkout\.stripe\.com"/);
  assert.match(
    hook,
    /const checkoutElement =\s*isOpen && options \? \(\s*<Suspense[\s\S]*?<StripeEmbeddedCheckout \{\.\.\.options\} \/>[\s\S]*?<\/Suspense>\s*\) : null;/,
  );
  assert.match(hook, /const StripeEmbeddedCheckout = lazy\(async \(\) =>/);
  assert.match(hook, /await import\("@\/components\/StripeEmbeddedCheckout"\)/);
  assert.doesNotMatch(hook, /import \{ StripeEmbeddedCheckout \} from/);

  for (const e2e of [responsive, migration]) {
    assert.doesNotMatch(e2e, /STRIPE_PAYMENT_PERMISSION_WARNING|permissions policy violation/);
  }
});
