# Stripe sandbox and production-readiness plan

## Read-only live inventory on August 16, 2026

Connected account: Blocera, LLC.

- `plus_monthly` is active at $14.00/month.
- `pro_monthly` is active at $89.00/month.
- Application source resolves plans by lookup key and does not hard-code those amounts.
- Existing Stripe product metadata still contains historical `lovable_*` fields.
- The Pro product description still promises voice quality, which conflicts with the established no-Voice product contract.

The connected Stripe permission set allowed read-only verification but did not allow product updates. No product, price, customer, subscription, or charge was mutated.

## Source test path

The webhook accepts only the allowlisted `sandbox` and `live` environments. Each environment uses its own API key and signing secret. Checkout return state never grants entitlement; verified subscription and invoice webhooks remain authoritative.

`npm run release:stripe:contract` verifies:

- sandbox and live allowlisting;
- separate sandbox/live webhook secrets;
- constant-time signature verification;
- processed-event idempotency and duplicate handling;
- lookup-key plan resolution;
- no source hard-coded price amounts.

## Required sandbox exercise

1. Create/reuse Stripe test-mode products and prices with lookup keys `plus_monthly` and `pro_monthly`.
2. Configure only sandbox API and webhook secrets in staging.
3. Complete checkout with a Stripe test payment method.
4. Deliver signed webhook events for checkout completion, subscription creation/update/deletion, invoice paid, payment failed, and action required.
5. Replay the same event ID and prove no duplicate entitlement or mutation.
6. Verify activation, cancellation, downgrade, failed-payment state, and account-deletion cleanup.
7. Verify server-side plan and usage enforcement using the resulting subscription state.
8. Confirm no real-mode customer or charge was created.

## Live dashboard cleanup before launch

- Remove or replace historical `lovable_external_id` and `lovable_managed` metadata after confirming no compatibility consumer remains.
- Remove the Pro voice-quality claim.
- Confirm current prices and trial configuration are intentional.
- Record product IDs, price IDs, lookup keys, webhook endpoint IDs, and signing-secret fingerprints without exposing secret values.
