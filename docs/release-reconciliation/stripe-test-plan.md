# Stripe sandbox and production-readiness plan

## Verified live inventory on September 1, 2026

Connected account: KovaGPT (`acct_1UAeDgAEZlsb6DBY`).

- KovaGPT Plus (`prod_VB1Crlvg4utbCe`) and KovaGPT Pro (`prod_VB1Cbp01TZ8hOI`) are active products with Kova-managed metadata and no default price.
- There are no active or inactive prices. The `plus_monthly` and `pro_monthly` lookup keys do not exist in live mode.
- There is no webhook endpoint.
- Stripe Tax settings are active, but there are no active tax registrations. Automatic tax must remain disabled until the intended jurisdictions are confirmed.
- No customer, subscription, charge, tax registration, price, or webhook was created or changed during the September 1 reconciliation.

This inventory supersedes the stale August 16 snapshot that referred to a different connected account. It is not evidence that live billing is launch-ready. Exact price creation and the live webhook remain approval-gated in issue #207.

## Source test path

The webhook accepts only the allowlisted `sandbox` and `live` environments. Each environment uses its own API key and signing secret. Checkout return state never grants entitlement; verified subscription and invoice webhooks remain authoritative.

The server uses Stripe SDK `22.4.0` with API `2026-07-29.dahlia`. Embedded Checkout sends the stable integration identifier `kovagpt_checkout_wshrfyef`. It deliberately omits `payment_method_types` so Stripe can manage eligible payment methods, and it does not enable automatic tax without approved registrations.

`npm run release:stripe:contract` verifies:

- sandbox and live allowlisting;
- separate sandbox/live webhook secrets;
- constant-time signature verification;
- processed-event idempotency and duplicate handling;
- lookup-key plan resolution;
- no source hard-coded price amounts;
- the exact Stripe API version and stable Checkout integration identifier;
- SDK-typed Checkout parameters without a type-assertion escape;
- dynamic payment methods and no premature automatic-tax enablement.

## Required sandbox exercise

1. Create or reuse Stripe test-mode products and prices with lookup keys `plus_monthly` and `pro_monthly`.
2. Configure only sandbox API and webhook secrets in staging.
3. Complete checkout with a Stripe test payment method.
4. Deliver signed webhook events for checkout completion, subscription creation/update/deletion, invoice paid, payment failed, and action required.
5. Replay the same event ID and prove no duplicate entitlement or mutation.
6. Verify activation, cancellation, downgrade, failed-payment state, and account-deletion cleanup.
7. Verify server-side plan and usage enforcement using the resulting subscription state.
8. Confirm no live-mode customer or charge was created.

## Live launch gates

- Obtain explicit approval for the exact Plus and Pro recurring price amounts before creating active live prices.
- Confirm the product tax code and active registration jurisdictions with a qualified tax adviser before enabling automatic tax.
- Deploy the exact webhook route before endpoint creation, store its signing secret in Azure Key Vault as `PAYMENTS_LIVE_WEBHOOK_SECRET`, and prove signed delivery and replay handling.
- Record product IDs, price IDs, lookup keys, webhook endpoint IDs, and signing-secret fingerprints without exposing secret values.
- Complete the full live checkout, entitlement, cancellation, failed-payment, and rollback evidence matrix before declaring billing ready.
