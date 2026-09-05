# Organization administration foundation

Organization administration is available at `/organization`, linked from the existing Enterprise preparation panel. It is disabled unless `KOVA_ORGANIZATION_ADMIN_ENABLED=true` and `KOVA_ORGANIZATION_POLICY_VERSION` names an approved operational policy. Schema availability is verified by the authenticated API before showing administration controls. Database requests have a ten-second server deadline; client requests pin the signed-in principal and have a fifteen-second deadline. This feature does not create an Enterprise subscription or change individual entitlements.

## Authorization and lifecycle

Membership is explicit and scoped to one organization. Owners manage organization settings, roles, domains, SSO connection records, and retention drafts. Admins may invite/remove ordinary members and read audit history. Members may inspect current membership and leave. Only an owner may grant owner/admin roles or remove another owner/admin. Every tenant mutation requires the exact current organization revision and a principal-bound mutation UUID. Retrying an acknowledged request does not repeat its write or audit event; a changed payload with the same UUID is rejected.

Invitations resolve exactly one existing Auth account with a confirmed email, no active ban, and no deleted/anonymous state. The recipient UUID is stored, rather than an email-based authorization rule. Invitation records appear inside the target account's Organization page; no email is sent automatically. Acceptance and decline require that exact account. Expired/revoked invitations cannot enroll a user. Matching an organization email domain or completing SSO never creates membership.

RLS checks current membership, role, tenant state, and the account-deletion fence. Revocation takes effect on the next request, including the next audit-export page. Browser roles have no organization table mutations or service-RPC execution. The recursive membership RLS helper runs privately with a fixed empty search path and can inspect only `auth.uid()`'s role. Auth identity lookups use the narrow private helpers from `20260905001736`; service_role receives no `SELECT auth.users` grant.

Tenant mutations serialize behind the tenant row and account locks ordered before tenant locks. A last owner cannot leave, be demoted, be revoked, or disappear through Auth deletion without another non-deleting owner. `prepare_org_account_deletion(uuid)` must run before export Storage cleanup, Stripe retirement, or connector teardown. It checks ownership and establishes the shared account fence only when deletion can proceed. Other deleting owners do not count as replacements. A final Auth trigger provides a second check.

Organization closure is separate from account deletion. Its API is disabled unless `KOVA_ORGANIZATION_CLOSURE_ENABLED=true` after policy approval. The sole remaining owner must enter the exact organization name. Closure revokes access, pending invitations, domain proofs, and SSO connection records. It preserves audit/history records; it is not a data-erasure claim. No organization is automatically destroyed by account deletion.

## Domain and SSO adapter

An owner creates a random DNS TXT challenge at `_kovagpt-verification.<domain>` with value `kovagpt-domain=<challenge>`. The server resolves that exact DNS name, requires the current matching token, bounds records and response sizes, and times out after five seconds. Only the server's verification adapter can add proof to the service-only mutation; the public request parser rejects proof/provider fields supplied by a browser. Verification lasts 24 hours and is globally exclusive while current. Fresh verified control can replace an expired claim under a domain advisory lock and sorted tenant locks. This rotates the former challenge, disables its connection, increments its tenant revision, and adds an expiration audit event without exposing the new claimant. Revocation rotates the challenge and disables the connection record.

An SSO connection additionally requires an operator-managed `KOVA_ORGANIZATION_SSO_CONNECTIONS_JSON` map:

```json
{
  "organization-uuid": {
    "providerId": "verified-supabase-sso-provider-uuid",
    "domains": ["example.com"]
  }
}
```

Actual UUIDs and domains must come from the reviewed provider setup; the placeholders above are not a configuration to deploy. The adapter accepts only an exact organization/domain/provider mapping and a current DNS proof. It records configuration readiness; it does not claim an operational SSO login flow, provision users, or accept identity claims as membership. Supabase SSO provider creation, IdP metadata/certificate validation, login callback setup, and organization policy activation remain explicit operator work.

## Retention, export, and bounds

Retention changes are saved only as proposals (`retention_days_draft`). No retention duration is activated and no audit/content purge runs automatically. Audit records contain fixed action names, actor/subject UUIDs, timestamps, and narrow role/domain/draft-policy fields. They contain no invitation emails, raw requests, tokens, SSO assertions, or content bodies. An administrator may export JSON using a fixed audit high-water mark, deterministic ID cursors, and at most 200 events per request. The UI exports at most 10,000 events and labels the file incomplete if more remain.

Account exports include the user's organization membership, organizations they created, invitations they sent/received, and audit records in which they are the actor or subject. They exclude unrelated member records, domain proof tokens, and provider configuration.

Operational limits are five created active organizations per account, 100 active memberships per account, 100 active members per organization, 50 current pending invitations per organization, 100 current pending invitations per recipient, and five current domains per organization. These are operational bounds, not commercial plan promises. Idempotency receipts are capped at 10,000 per actor; `purge_organization_mutation_receipts` removes at most 500 receipts older than eight days and never touches audit events. Add that RPC to the existing secret-protected receipt-maintenance scheduler when activating the backend.

## Verification and activation boundary

PGlite tests exercise real migration functions, RLS, exact revisions, idempotent replay, verified invitations, revocation, owner/admin separation, account-deletion fencing, domain proof, bounded audit snapshots, and draft-only retention. Boundary tests execute the route/domain/client helpers to verify disabled defaults, email verification, cross-site/rate protections, server-owned proof, provider mapping, principal pinning, and bounded response bytes.

No live migration, DNS change, SSO provider creation, invitation delivery, policy approval, or retention activation was performed while creating this source package. Hosted migration/browser CI and deployment validation remain required before enabling organization administration.
