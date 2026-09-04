# Stripe live catalog reconciliation — August 16, 2026

> **Historical and superseded (2026-09-03):** This dated read-only snapshot is retained for audit history. Its prices, metadata, webhook state, and recommended actions are not current billing or release guidance. No runtime code depends on the historical metadata described below.

Read-only inspection of the connected Blocera, LLC Stripe account found the following KovaGPT live-mode records. No customer, subscription, product, price, payment, or charge was changed.

## KovaGPT Plus

- Product: `prod_UkpSfBno3K7X9O`
- Active recurring price: `price_1TlJndAHcChSIaIoymISUxXW`
- Lookup key: `plus_monthly`
- Live amount: **$14.00 USD/month**
- Application-published amount: **$16.00 USD/month**
- Product and price metadata still contain historical `lovable_external_id` and `lovable_managed` keys.

## KovaGPT Pro

- Product: `prod_UkpSsEFWWVmf8S`
- Active recurring price: `price_1TlJncAHcChSIaIouevSTkzg`
- Lookup key: `pro_monthly`
- Live amount: **$89.00 USD/month**
- The live product description still promises “highest voice quality,” which conflicts with KovaGPT’s established no-Voice product contract.
- Product and price metadata still contain historical `lovable_external_id` and `lovable_managed` keys.

## Required reconciliation before launch

1. Decide whether Plus remains $14 or moves to the already published $16 amount. The current source intentionally publishes $16, so the expected release action is to create a new $16 recurring price and move the `plus_monthly` lookup key under a reviewed Stripe migration. Never alter an existing price amount in place.
2. Remove the Pro voice-quality promise and replace it with truthful text about supported reasoning/research capability.
3. Replace historical Lovable metadata with Kova-owned metadata such as `kova_plan=plus_monthly` and `kova_managed=true`, then remove the webhook’s temporary read-only `lovable_external_id` fallback after verifying no active subscription depends on it.
4. Preserve existing customer/subscription references and verify lookup-key resolution, trial behavior, cancellation, downgrade, payment failure, duplicate webhooks, and deletion cleanup in Stripe test mode.
5. Confirm the live webhook endpoint no longer points to Lovable infrastructure and record its endpoint ID and signing-secret fingerprint without exposing the secret.

## Tool boundary

The connected Stripe credential is currently read-only for product updates, so catalog cleanup cannot be performed through the available connector. A Stripe owner must grant the required write permission or complete the reviewed dashboard/API changes. Creating a new live price or changing a live lookup key is consequential and requires explicit approval even after write access exists.
