# PR229 integration status

Source comparison: PR229 `c327474cb3e2a511d3fad3f263360e3a89f1726a` against
PR289 `27f8bed29b4d4cf56507ecbeffe29d274dae9006`, 2026-09-04.
This is a source-only integration record. It does not authorize deployment,
live Stripe changes, database migrations, or account deletion.

## Completed source integration

- Signed webhook envelopes enforce live/sandbox mode, finite timestamps, bounded
  UTF-8 bodies, and the existing HMAC checks. Atomic event completion uses leased,
  database-monotonic observations with rollback-compatible audit ordering.
- Browser Checkout and structural readiness use the same compiled public key.
  Docker forwards the build argument. The old-account fallback is removed;
  server, build-time public key, webhook, and explicit Portal configuration need
  account-matched operator evidence before enablement.
- Forward migrations `20260904231210` and `20260904231213` establish immutable
  Customer mappings, exact Price registry/legacy normalization, atomic webhook
  completion, own/effective family entitlement consumers, and Checkout attempts.
  Missing periods never grant paid access. Multiple rows with one agreed paid
  tier retain access; conflicting tiers fail closed and expose billing conflict.
- First-Customer creation reserves one durable identity before any Stripe work.
  Checkout and account deletion use the export deletion advisory key and fence.
  An unresolved reservation blocks Auth deletion, including direct Auth deletes;
  expiry cannot silently authorize another Customer creation.
- Deletion snapshots billing only after fencing, verifies every local page against
  exact mapped Customer IDs, and checks all environment credentials before file
  or connector teardown. It retires every Customer before disconnecting external
  services and deleting Auth. Missing historical sandbox credentials fail closed.
- Every Checkout scans authoritative paginated Stripe history, including Pro and
  expired local rows. Reviewed ambiguous-period and all-row protections remain.
- Session requests persist pending state before POST and record attempt identity
  in metadata. Retries recover the exact Session before replaying the same key;
  empty lists and cached 500s never justify a new key. Known ready Sessions require
  exact expiry proof before rotation. Unknown expired outcomes remain pending for
  operator reconciliation. Terminal outcomes cannot regress through late writes.
- Portal uses the immutable mapping and rejects a conflicting verified active
  local Customer instead of targeting the newest stale row.
- `STRIPE_BILLING_RUNTIME` defaults to `disabled`. Checkout, Portal, and webhook
  writes require `durable`; signed webhook requests receive retryable failure
  while disabled. Deployment still requires the migration/drain sequence below.

Runtime mocks and isolated PGlite fixtures cover the identity/deletion ordering,
readiness, exact Price/family behavior, webhook convergence, stale local fallback,
ambiguous attempts, and reviewed PR289 regressions. No live service was mutated.

## Decisions and operator evidence still required

1. Approve trial-redemption identity and retention policy across account recreation.
   The prior Customer is deleted and a new Auth ID cannot prove prior redemption.
   No email hash, new retention period, or changed benefit has been invented.
   Potential first-trial Plus Checkout therefore explicitly reports unverified
   30-day eligibility; it neither grants a repeat trial nor silently removes the
   trial and charges immediately. This is a rollout blocker requiring policy and
   then its corresponding source implementation before enabling Plus Checkout.
2. Approve the minimal detached Customer-ID event tombstone retained by the source
   mapping after Auth deletion; it retains no email or old Auth ID. It supports
   orphan webhook handling but cannot establish recreated-account trial eligibility.
3. Supply and verify account-matched restricted server/build-time public keys,
   explicit Portal configuration, webhook secret, and historical sandbox cleanup
   access through the established Key Vault/deployment process. Reconcile any
   expired unknown Customer/Session request against Stripe before permitting a
   replacement; an empty list alone is not proof of no delayed side effects.
4. Reconcile the live migration ledger and run the approved staged rollout in
   [STRIPE_BILLING_ROLLOUT.md](./STRIPE_BILLING_ROLLOUT.md). Payment Method Domain,
   tax, refund/cancellation operations, and the first live transaction remain
   owner-controlled. No automatic tax, price, or live environment change is included.

## References

- [Stripe low-level error handling](https://docs.stripe.com/error-low-level):
  cached 500 outcomes are indeterminate and must not be retried under a new key
  without resolving possible side effects.
- [List Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/list):
  Customer filtering and cursor pagination for attempt reconciliation.
- [Subscription object](https://docs.stripe.com/api/subscriptions/object):
  current periods belong to subscription items on the pinned API.
- [Delete a Customer](https://docs.stripe.com/api/customers/delete): deletion
  prevents further Customer operations and cancels active subscriptions.
