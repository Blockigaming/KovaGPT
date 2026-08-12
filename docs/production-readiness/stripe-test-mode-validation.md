# Stripe test-mode staged validation

Run only with a Stripe `sk_test_` key and test webhook secret injected through the authorized environment—not command arguments. The prerequisite guard must report `keyMode=test` and margin floor at least 50%:

```bash
node scripts/staging-validation/external-harness.mjs stripe --fixture <sanitized-prerequisites.json>
```

Execute allowed lookup-key checkout and reject unknown/modified plans; complete checkout; replay the same signed webhook twice; reject an invalid signature; exercise upgrade, downgrade, cancellation-at-period-end, deletion, failed payment, portal return, customer/user mismatch, stale event ordering, and entitlement synchronization. After each event assert server-authoritative plan/status/period fields, one processed event, no duplicate credit/usage mutation, and no client-authoritative entitlement.

Verify upstream pricing fails closed and the developer gross-margin floor remains at least 50%. A live-mode key or live object is a hard stop. Disable staging checkout/webhook processing and restore the prior test mapping on any signature, idempotency, ownership, ordering, pricing, or entitlement discrepancy.
