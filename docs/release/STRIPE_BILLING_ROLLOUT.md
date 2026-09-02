# Stripe billing rollout blockers

The billing durability migrations and runtime changes are source-only. They do not configure Stripe,
apply a Supabase migration, or deploy an Azure revision.

## Required production configuration

Do not enable live Checkout or the live webhook until an operator has provided all three values to
the production Azure Container App through approved secret references:

- `STRIPE_LIVE_API_KEY`
- `PAYMENTS_LIVE_WEBHOOK_SECRET`
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`

The current production Bicep and deployment workflow do not wire these settings. That is a rollout
blocker, not a reason to place secrets in source or casually expand the development-scoped template.
The Cloudflare client-certificate fingerprint contract remains independently required at the origin.

Create and verify a live Stripe webhook endpoint for
`https://kovagpt.com/api/public/payments/webhook?env=live` before traffic is enabled. Subscribe only
to the lifecycle events handled in source: Checkout completion/expiration, subscription lifecycle,
and the supported invoice lifecycle events. Create and test the Billing Portal configuration before
setting its `bpc_...` identifier.

## Database release order

1. Snapshot and reconcile the remote migration ledger. The repository audit found source/live drift;
   do not replay every source-only migration blindly.
2. Review and apply the two forward billing migrations in timestamp order.
3. Verify that the exact live Plus and Pro Price IDs map to paid tiers and that sandbox, unknown, and
   ambiguous rows resolve to free.
4. Reconcile any historical subscription rows whose Price or Customer identity is not authoritative.
5. Exercise duplicate, out-of-order, same-second, retry, cancellation, and portal paths with test
   identities before enabling live Checkout.

The atomic completion RPC records the event and conditionally updates the subscription in one
transaction. Stripe deliveries are ordered by `(event_created_at, event_id)`; a stale delivery is
recorded but cannot overwrite a newer subscription state.

## Other manual blockers

Stripe Tax has no registrations and automatic tax remains disabled. Tax nexus, registrations,
customer communications, refund policy, and cancellation operations require owner/legal approval.
The live webhook and portal must be created in Stripe Dashboard and their secret/configuration values
must be supplied through the production secret-management workflow.

Rollback the application revision or disable the live endpoint/configuration if verification fails.
Do not delete completion-ledger rows or reverse the forward migrations without a separately reviewed
data-recovery plan.
