# Stripe billing rollout blockers

The billing durability migrations and runtime changes are source-only. This change does not apply a
Supabase migration, create or update a Stripe object, write Azure configuration, or deploy a
revision. Live Checkout and webhook intake remain blocked.

## Required production configuration

Do not enable live Checkout or the live webhook until an operator has wired and verified all of the
following through the approved Azure configuration and secret-reference workflow:

- VITE_PAYMENTS_CLIENT_TOKEN: browser-safe live publishable key for Stripe account
  acct_1UAeDgAEZlsb6DBY.
- STRIPE_LIVE_ACCOUNT_ID: the operator-verified value acct_1UAeDgAEZlsb6DBY used by readiness
  to bind browser, server, webhook, and Portal configuration to one account.
- STRIPE_LIVE_API_KEY: server-only restricted live key for the same account, stored in Azure Key
  Vault and never committed or logged. The owner must verify that it permits Price reads, Customer
  reads/updates/deletion, Checkout Session reads/writes, Subscription reads/cancellation, and
  Billing Portal Session creation. Account deletion fails closed unless Customer deletion is
  authorized; environment-shape readiness cannot introspect restricted-key permissions.
- PAYMENTS_LIVE_WEBHOOK_SECRET: server-only signing secret for the exact live endpoint.
- STRIPE_BILLING_PORTAL_CONFIGURATION_ID: owner-approved identifier
  bpc_1UB2ZxAEZlsb6DBYU3PoJJPU.

A read-only check on 2026-09-02 confirmed that the connected KovaGPT live account is
acct_1UAeDgAEZlsb6DBY. The previous committed publishable-key fallback belonged to a different
account and has been removed. The browser publishable key and server key must be verified against
that same account before the first Checkout smoke test; Checkout client secrets are account-scoped.

The current production Bicep and deployment workflow do not wire these values. That remains a
rollout blocker, not a reason to commit credentials or casually expand the development-scoped
template. The Cloudflare client-certificate fingerprint contract remains independently required at
the origin.

No live webhook endpoint currently exists. Create and verify
https://kovagpt.com/api/public/payments/webhook?env=live only during the approved rollout, using the
exact signing secret and the lifecycle events handled in source. The handler verifies the raw body
signature and timestamp before processing. At Cloudflare, restrict this exact path to Stripe's current
webhook source IPs imported from https://stripe.com/files/ips/ips_webhooks.json. Verify the official
list immediately before enablement and subscribe the owner to Stripe's API announce list; do not
hardcode a copy in application source.

Register and verify kovagpt.com as a live Payment Method Domain before claiming Apple Pay or Google
Pay availability. Domain registration is environment-specific and remains an owner-run blocker.

The existing live Portal configuration is active/default, but subscription updates are disabled.
The application therefore promises only payment methods, invoices, customer details, and
cancellation. Do not advertise plan changes unless the owner separately enables and tests them.

## Database and application release order

1. Snapshot and reconcile the remote migration ledger. Source/live drift was previously observed;
   never replay source-only migrations blindly.
2. Run the isolated-database suite against both forward migrations. It must prove exact live Price
   mapping, legacy lookup-key normalization, family own/effective parity, duplicate-subscription
   conflict handling, lease crash/retry convergence, orphan completion, and Checkout claim
   convergence.
3. Stop deliveries to the old webhook revision and wait for all old handlers to drain. Old and new
   handlers must never receive deliveries concurrently because the old revision does not honor the
   lease protocol.
4. Apply the two forward billing migrations in timestamp order. Verify the exact live Plus and Pro
   Price IDs and retain a registry row for every still-valid historical Price ID.
5. Verify the Cloudflare webhook-path rule uses Stripe's current official source-IP feed and rejects
   non-Stripe source networks before application signature verification.
6. Confirm stripe_event_processing_claims is empty before switching revisions. Deploy the new
   revision with live billing still disabled, then verify account/key provenance and configuration.
7. Create or enable the live webhook endpoint and perform one owner-authorized, reversible smoke
   test before enabling general Checkout traffic.

Stripe explicitly documents that webhook event ordering is not guaranteed and that Event created
must not be used to determine event order:
https://docs.stripe.com/webhooks#event-ordering. Event timestamps and IDs are retained only for audit
and idempotency. Before each authoritative Stripe GET, begin_stripe_event allocates a
database-monotonic observation sequence and a short lease. complete_stripe_event accepts only the
current lease, atomically applies that observation, and records the completed event. In-flight work
lives in stripe_event_processing_claims, separate from the rollback-compatible completed ledger.
The legacy last_stripe_event_created_at/last_stripe_event_id columns retain only their monotonic
tuple maximum for rollback compatibility; they never decide which authoritative snapshot applies.

Checkout similarly uses a durable per-user/environment attempt. Concurrent requests reuse one
Stripe idempotency key, frozen Price/trial parameters, and Session expiry. The attempt rotates as
soon as the Session expires. A read of the mapped Customer's current Stripe subscriptions closes the
webhook-lag window before Session creation; the database RPC repeats the local active-subscription
check while holding the durable row.

Account deletion does not trust webhook-lagged subscription rows. It resolves each immutable mapped
Customer, paginates and cancels every nonterminal or unknown Stripe subscription, then permanently
deletes that Customer immediately before deleting the auth user. Customer deletion is the final
barrier against an already-authorized Checkout request completing between the scan and auth
deletion. Any unverified mapping, cancellation, Customer deletion, or restricted-key permission
fails the account deletion without deleting auth identity; a retry accepts only Stripe's exact
deleted-Customer response as idempotent proof. Successful auth deletion leaves the mapping's
user_id null as the minimal event-audit tombstone and never recreates entitlement.

## Rollback

Application rollback is not interchangeable with merely disabling one endpoint.

1. Disable live Checkout and webhook intake and stop the new revision from receiving requests.
2. Wait for active requests to finish and verify stripe_event_processing_claims has zero rows.
3. Roll back the application revision while leaving the forward schema in place. The schema retains
   legacy single-column uniqueness, normalizes legacy lookup-key writes, and keeps an authenticated
   own-user user_plan_tier(uuid) compatibility wrapper for the rollback window.
4. Only after the new revision is fully drained may an old revision receive webhook deliveries.
   Re-enable intake only through an explicit operator decision; the old handler has weaker
   email-identity and timestamp-ordering behavior.
5. Do not reverse the migrations or remove compatibility constraints/functions without a separate,
   post-stability contract migration and reviewed data-recovery plan.

## Other manual blockers

Stripe Tax has zero live registrations, so automatic_tax remains disabled. Tax nexus,
registrations, customer communications, refund policy, cancellation operations, and the first live
transaction require owner/legal approval. Enabling automatic_tax before an active registration
would not collect the expected tax.

No live mutation was performed while preparing this change.
