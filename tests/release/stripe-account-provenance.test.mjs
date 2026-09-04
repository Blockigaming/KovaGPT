import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("browser and server live credentials must target the approved Stripe account", async () => {
  const [publicConfig, stripeClient, envExample, rollout] = await Promise.all([
    read("src/config/public-config.ts"),
    read("src/lib/stripe.ts"),
    read(".env.example"),
    read("docs/release/STRIPE_BILLING_ROLLOUT.md"),
  ]);

  assert.match(publicConfig, /PUBLIC_STRIPE_ACCOUNT_ID = "acct_1UAeDgAEZlsb6DBY"/);
  assert.match(publicConfig, /PUBLIC_PAYMENTS_CLIENT_TOKEN = ""/);
  assert.doesNotMatch(publicConfig, /pk_(?:live|test)_/);
  assert.doesNotMatch(publicConfig, /51TW1VcAHcChSIaIo/);
  assert.match(stripeClient, /VITE_PAYMENTS_CLIENT_TOKEN/);
  assert.match(stripeClient, /Live billing requires a Stripe pk_live publishable key/);
  assert.match(envExample, /VITE_PAYMENTS_CLIENT_TOKEN=/);
  assert.match(envExample, /STRIPE_LIVE_ACCOUNT_ID=/);
  assert.match(envExample, /acct_1UAeDgAEZlsb6DBY/);
  assert.match(rollout, /browser publishable key and server key must be verified/);
  assert.match(rollout, /Azure Key\s+Vault/);
  assert.match(rollout, /Payment Method Domain/);
  assert.match(rollout, /stripe\.com\/files\/ips\/ips_webhooks\.json/);
  assert.match(rollout, /Cloudflare[\s\S]*webhook source IPs/i);
  assert.match(rollout, /Customer[\s\S]*reads\/updates\/deletion/);
  assert.match(rollout, /restricted-key permissions/);
  assert.match(rollout, /deletes that Customer immediately before deleting the auth user/);
});
