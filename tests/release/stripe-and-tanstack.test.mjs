import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("Stripe pins Dahlia and verifies Checkout and webhook safety contracts", async () => {
  const stripeSource = await readFile(
      new URL("../../src/lib/stripe.server.ts", import.meta.url),
      "utf8",
    ),
    checkoutSource = await readFile(
      new URL("../../src/utils/payments.functions.ts", import.meta.url),
      "utf8",
    ),
    hook = await readFile(
      new URL("../../src/routes/api/public/payments/webhook.ts", import.meta.url),
      "utf8",
    ),
    pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.dependencies.stripe, "22.6.0");
  assert.match(stripeSource, /apiVersion: "2026-08-26\.dahlia"/);
  assert.match(stripeSource, /readUtf8BodyBounded\(req, maxBodyBytes\)/);
  assert.match(stripeSource, /age > 300/);
  assert.match(stripeSource, /timingSafeEqualText/);
  assert.match(checkoutSource, /integration_identifier: "kovagpt_checkout_wshrfyef"/);
  assert.match(
    checkoutSource,
    /const sessionParams: Parameters<typeof stripe\.checkout\.sessions\.create>\[0\]/,
  );
  assert.doesNotMatch(checkoutSource, /payment_method_types\s*:/);
  assert.doesNotMatch(checkoutSource, /automatic_tax\s*:/);
  assert.doesNotMatch(checkoutSource, /sessionParams\s+as\s+Parameters/);
  assert.match(checkoutSource, /return_url: CHECKOUT_RETURN_URL/);
  assert.match(
    checkoutSource,
    /\.validator\(\(data: unknown\) => \{\s*const parsed = parseCheckoutRequest\(data\);\s*if \(!resolveBillingPlan\(parsed\.priceId\)\) throw new Error\("Invalid priceId"\);\s*return parsed;/,
  );
  assert.doesNotMatch(checkoutSource, /\breturnUrl\b|data\.returnUrl/);
  assert.match(hook, /processStripeEvent/);
  assert.match(hook, /stripe\.subscriptions\.retrieve/);
  assert.match(hook, /status: retryableFailure \? 503 : 400/);
  assert.match(hook, /"Retry-After": "5"/);
  assert.match(hook, /correlationId/);
  assert.doesNotMatch(hook, /console\.(log|error)/);
});
test("installed TanStack compiler and application retain validated input contract", async () => {
  const compiler = await readFile(
    new URL(
      "../../node_modules/@tanstack/start-plugin-core/src/start-compiler/handleCreateServerFn.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../../src/lib/agent-definitions.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(compiler, /inputValidator/);
  assert.match(app, /\.validator\(/);
  const pkg = JSON.parse(
    await readFile(
      new URL("../../node_modules/@tanstack/react-start/package.json", import.meta.url),
    ),
  );
  assert.equal(pkg.version, "1.168.34");
});
