# Team email invitations

Owners invite from `/team` with a recipient email and Standard or Premium seat. The recipient can create and verify an account after receiving the email; acceptance requires that exact verified email.

The server reserves an available paid seat first. When none is available, the review shows Stripe's estimated prorated subtotal before tax, estimated total, and additional monthly or annual recurring cost. The explicit Send invitation & add seat action updates the existing subscription using `pending_if_incomplete` and `always_invoice`, with the reviewed proration timestamp. No invitation is granted or emailed before paid seat capacity is confirmed. Extra payment authentication uses a full-screen hosted Stripe invoice.

A durable invitation UUID pins billing and email idempotency. Concurrent increases are serialized per workspace. Refresh and signed webhooks reconcile existing operations without initiating new seat charges. Provider retries retain identical email bytes and an existing 23-hour idempotency window. The signed email worker retries one server-selected invitation only when it has not attempted another send in that invocation. No caller-provided recipient or payload crosses the worker boundary.

Canceling an invitation or removing a member frees the paid seat for reuse. It does not reduce the Stripe quantity or promise a refund. Owners use Manage billing to reduce purchased seats.

## Deployment

- Apply `20261108034500_team_email_invitations.sql` before the application image. The additive invitation table and RPCs are service-only, with RLS enabled and public/browser privileges revoked.
- Existing live restricted Stripe key requires Subscriptions Write and Invoices Write (preview and paid subscription adjustment), in addition to existing customer/price access. Permission expansion requires owner approval; this implementation does not alter keys or permissions.
- Email uses the existing server-side `RESEND_API_KEY` and already-established `KovaGPT <noreply@kovagpt.com>` sender. No credentials are sent to the browser.
- Existing signature-verified Team subscription/invoice/risk webhook processing remains authoritative. A risk hold or account-deletion fence prevents invitation grants and acceptance.
- Roll back only the application image if necessary; preserve invitation rows and investigate any in-flight billing before retrying. Reverting source does not reverse a Stripe transaction.

## Verification

71 targeted billing, invitation, and email-worker checks passed, including native PostgreSQL-compatible permission/capacity/acceptance tests. Twelve isolated browser tests cover the real page component at 320, 390, 768, and 1440 pixels. Production build, TypeScript, and targeted lint pass. No real charge or invitation email was initiated during these tests; paid settlement and email provider behavior were simulated.
