# Kova-owned authentication

## Decision

KovaGPT will own authentication. Supabase Auth, Clerk, Auth0, and other hosted
identity providers are not the target authority.

The application may continue to use Supabase-hosted PostgreSQL and Storage
during the migration. Hosting application data there does not give Supabase
Auth authority over Kova identities or sessions. A later infrastructure move
can relocate the database independently.

## Security boundary

The target system owns:

- identities, verified email addresses, credentials, and account state;
- opaque server-side sessions and device/session revocation;
- email verification and recovery challenges;
- Google OAuth state, PKCE, callback validation, and identity linking;
- MFA, passkeys, recovery codes, trusted-device policy, and audit events;
- abuse controls, login throttling, suspicious-session invalidation, and deletion.

Password hashing and token generation must use maintained, audited libraries.
KovaGPT must not implement cryptographic primitives.

Browser sessions use `__Host-kova_session`: an opaque, high-entropy token in an
`HttpOnly; Secure; SameSite=Lax; Path=/` cookie with no `Domain` attribute.
Only a digest of that token is stored. Rotation is mandatory after login,
privilege elevation, password change, recovery, and MFA changes.

## Rollout modes

`KOVA_AUTH_MODE` is fail-closed and accepts exactly:

| Mode       | Kova cookie | Supabase bearer                          | Purpose         |
| ---------- | ----------- | ---------------------------------------- | --------------- |
| `supabase` | ignored     | accepted                                 | current default |
| `dual`     | preferred   | accepted only when no Kova cookie exists | migration       |
| `kova`     | accepted    | rejected                                 | final state     |

In `dual` mode, a malformed, expired, or revoked Kova session never falls back
to Supabase. Otherwise logout or server-side revocation could be bypassed with a
legacy token.

## Identity continuity

The application UUID remains the durable account identifier. Stripe customers,
subscriptions, conversations, projects, files, memories, family relationships,
usage, and audit history remain attached to that UUID.

Migration must never link accounts merely because the browser supplied an email
address. An existing Google identity may be linked only after a valid provider
callback proves the provider subject and the verified provider email satisfies
the reviewed linking policy. Password users retain access through a verified
migration flow; if a password hash cannot be migrated safely, require recovery
instead of copying or weakening it.

## Required source stages

1. Provider-neutral principal and middleware contract.
2. Identity, credential, session, challenge, MFA, recovery, and audit schema.
3. Server-only session store with hashed opaque tokens and transactional rotation.
4. Email/password, verification, recovery, Google OAuth, MFA, and passkey adapters.
5. Dual-mode migration and stable UUID binding.
6. Replacement of browser bearer tokens with same-origin cookies.
7. RLS/storage authorization migration away from `auth.uid()` and `auth.users`.
8. Account export/deletion, billing, trusted contacts, and abuse-control validation.
9. Staging rehearsal, rollback evidence, owner-authorized production cutover.
10. Legacy-session expiry followed by removal of Supabase Auth dependencies.

## Non-negotiable release gates

No production enablement is allowed until tests prove:

- cross-user reads and writes fail across every protected surface;
- CSRF, fixation, replay, open redirect, OAuth state, and account-link attacks fail;
- password reset and email-change challenges are single-use and expire;
- logout, global logout, ban, deletion, password change, and MFA changes revoke sessions;
- billing identity and entitlements survive migration;
- rate limits work across replicas;
- secrets and raw session tokens never enter logs or client bundles;
- rollback preserves account identity and does not reactivate revoked sessions.

This foundation is source-only. It does not create users, migrate credentials,
change production configuration, or authorize deployment.

## Current dormant implementation

The feature branch now includes a staging-gated implementation of the next
source phase:

- fourteen RLS-enabled tables in the non-exposed `kova_private` schema;
- service-role-only RPCs for password accounts, verification, recovery,
  opaque sessions, TOTP enrollment and login challenges, one-time MFA recovery
  code storage, Google state, and one-time cross-origin handoffs;
- scrypt password hashing, SHA-256 token digests, AES-256-GCM OAuth-secret
  encryption, Google ID-token verification, and five-minute ES256 RLS JWTs;
- same-origin API routes for signup, password plus TOTP or one-time recovery-code
  login, TOTP enrollment and removal, logout, session rotation, email verification,
  password recovery, recovery-code regeneration, other-device session revocation,
  signed-in password changes, owned WebAuthn passkeys, and Google OAuth;
- a dual-mode browser/provider adapter that prefers a Kova cookie but retains
  the legacy session path when no Kova cookie exists.

This is not the final cutover. Deployed passkey/device rehearsal and existing
hosted-passkey migration, complete removal of `auth.users` compatibility principals, production
credential migration, and the production switch remain blocked on their later
release gates.

## Owned recovery-code and device controls

`POST /api/auth/mfa/recovery/regenerate` requires the current owned cookie,
an account-verified AAL2 session, an active verified owned TOTP factor, and an
explicit `{ "confirm": true }` body. Account identities and replacement codes
cannot be supplied by the browser. Both client-key and verified-account rate
limits apply, and cross-site requests are rejected before the mutation.

The server generates eight opaque codes and a new session token. One transaction
replaces the prior code digests, increments the account session epoch, retires
all prior sessions, and creates the replacement AAL2 session. Only the new
SHA-256 digests are stored. The response rotates the HttpOnly cookie and shows
the codes once; they are not logged or persisted in browser storage. Reusing
the old session or submitting a duplicate/invalid digest set fails without
partial changes. Missing or exhausted old code sets do not block a user who
still has a valid AAL2 session and active owned factor.

`POST /api/auth/sessions/revoke-others` accepts no account selector. It derives
ownership from the cookie, increments the account epoch, and preserves only the
current session at that epoch. A concurrent rotation with the prior epoch
cannot become a valid sibling afterward. Accounts requiring MFA must use AAL2;
accounts without MFA may use their valid AAL1 session. The Kova-mode settings
control calls this owned endpoint, never Supabase Auth as a fallback.

Recovery-code consumption rechecks the current factor and credential revision
inside its locked transaction. Regeneration and recovery consumption lock the
account before the related session/challenge/code rows. Public RPC execution is
restricted to `service_role`; the lock helper and all private auth tables remain
inaccessible to browser roles. Audit events contain counts and internal context,
not plaintext codes or digests.

The controls migration explicitly retires the earlier three-argument staging
regeneration function with `DROP FUNCTION ... RESTRICT`. The supported
five-argument RPC requires a fresh session digest and returns the rotated
principal. Unexpected database dependencies block the migration rather than
being removed with `CASCADE`.

The browser invalidates cached principals and compatibility tokens after these
changes, including responses already in flight. The signed-token request guard
described below additionally checks current session state at the Data API/RLS
boundary. Deployed multi-device rehearsal and legacy retirement remain gates.
Local regression tests execute the PostgreSQL transitions and the actual
handler/store path with synthetic data; component tests drive the actual UI
callbacks. These are not evidence of a deployed staging or production cutover.

## Owned passkeys

The dormant owned implementation uses pinned `@simplewebauthn/server` 14.0.2
and `@simplewebauthn/browser` 14.0.0. Passkeys are available on the owned login
dialog/password page and in `KovaPasskeyPanel`. Hosted mode retains its separate
Supabase passkey surface; failures never fall back between authorities.

The relying-party ID is the hostname of the existing exact HTTPS
`KOVA_AUTH_PUBLIC_ORIGIN`, not a caller-supplied value or forwarded Host header.
Passkey ceremonies run on that application origin. No new deployment secret or
environment flag is introduced by these source changes. Existing hosted passkeys
are **not** imported or silently treated as Kova credentials.

The server requests discoverable credentials with user verification required and
accepts ES256, RS256 or Ed25519 keys. Registration uses `none` attestation, so
verification never fetches vendor attestation metadata. Actual attestation/assertion
verification checks the challenge, exact origin, RP hash, ceremony type, user
presence/verification, signatures, counter rules and backup eligibility. Embedded
cross-origin ceremonies, malformed/noncanonical binary encodings and incorrect
user handles are rejected. User handles are derived from stable account UUIDs.

`POST /api/auth/passkeys/register/options` requires an owned session and either
current-password verification at AAL1 or an already verified AAL2 session. The
resulting registration challenge binds the account, session and applicable
password credential revision. `POST /api/auth/passkeys/login/options` is
discoverable: no email/account selector or credential list is accepted or returned.
Both create five-minute SHA-256-digested challenges and a browser-bound
`__Host-kova_passkey` cookie (Secure, HttpOnly, SameSite=Strict).

The matching `/register/verify` and `/login/verify` endpoints claim the challenge
once before cryptographic verification. A server-only receipt is required to
finish; browser-provided verification flags cannot replace proof. A failed proof
burns its claim. The database then rechecks the active account, credential, epoch,
counter/revision and registration session under account-first locks. Synced keys
with zero counters still use a revision check to reject concurrent stale proofs.
Successful login creates an AAL2 session. Adding a key rotates the current session
and retires other sessions without making password-only accounts TOTP-required.

`GET /api/auth/passkeys` returns only the current owner's display metadata and
management capability state. `/rename` accepts a bounded display name; `/remove`
requires AAL2 and explicit confirmation, preserves another demonstrably usable
owned sign-in method, disables the key and rotates the session. Maximum ten
active keys are allowed. Removing a key does not remove it from the physical
device/password manager. Secrets, public-key bytes and raw WebAuthn response
objects are never logged. Browser caches are cleared across successful or
uncertain session-changing responses; plaintext confirmation passwords are
not persisted.

All eight RPCs are service-role-only, with empty search paths and bounded
statement timeouts. Both new tables use private-schema RLS and deny browser
access. Local tests include real synthetic P-256 signatures through the actual
HTTP/store/PostgreSQL path, negative security cases, and UI callback tests.
They do not prove physical-device interoperability, browser-native biometrics,
deployed staging readiness or production cutover. Hosted-auth retirement and
deployed verification of the request guard below are still open gates.

## Compatibility-token revocation enforcement

Every newly issued Kova compatibility JWT includes the signed top-level
`kova_auth: 1` marker. `kova_auth_guard.session_is_active()` takes no arguments
and checks only the gateway-verified caller claims against the current owned
session and account. Revocation, expired/deleted sessions, epoch mismatch,
suspension/deletion, changed/unverified email, subject/session mismatch and
insufficient MFA assurance all reject a marked token even before JWT expiry.
Malformed or unknown marker versions fail closed; user-editable metadata does
not select the authority. JWT signatures remain the gateway's responsibility.

The migration adds a restrictive policy (both USING and WITH CHECK) to each
existing RLS-enabled public table, `storage.buckets`, `storage.objects`, and
`realtime.messages`. Storage service-internal tables, including vector and
multipart metadata, are not modified. Existing
ownership policies are preserved and must also pass. It changes neither private
auth-table privileges nor RLS-disabled tables, including `integration_providers`.
The helper is in a dedicated **non-exposed** guard schema; its only executable
functions return a boolean or a generic authentication failure and accept no
account/session selector. Browser roles still cannot access `kova_private`.

The database-scoped PostgREST pre-request hook also rejects marked invalid
tokens before owner-executed views or SECURITY DEFINER RPCs, which can bypass
RLS. Installation refuses to overwrite an unrelated existing hook. The guard
schema must never be added to exposed API schemas. No signing key is imported,
no application is enabled, and no hosted auth authority is retired by this work.

The owned data client clears rejected cached JWTs on a 401 response. Only GET
and HEAD may retry once with a newly obtained Kova token, and only against the
configured data origin. POST/PUT/PATCH/DELETE are never automatically replayed.
A revoked cookie cannot obtain a new token or fall back to hosted credentials.

Run `scripts/release/kova-auth-revocation-proof.sql` in a REPEATABLE READ,
READ ONLY transaction before any Kova data-plane enablement and after schema
changes. It returns aggregate metadata counts only; every violation count must
be zero. Later RLS tables need the same restrictive policy. The proof detects
missing policies, weakened expressions, missing hooks and invalid grants; it
does not establish that the external PostgREST service reloaded its config.

On September 21, 2026 (America/New_York), the Auth Rehearsal database passed
this aggregate proof for all 119 scoped tables with zero violation counts.
Both advisors were checked; private auth access remained denied and the
unrelated `integration_providers` RLS finding was left unchanged.

Unmarked hosted/service/anonymous tokens intentionally retain their existing
rules during dual mode. **Pre-marker Kova JWTs must expire before cutover**;
deployments must not alternate old/new signers after guard acceptance. Legacy
credential retirement is still separate. New statement snapshots see committed
revocation, but transactions already in flight are not forcibly cancelled.
Existing Realtime channel permissions and already-issued signed Storage URLs
are not retroactively cancelled by this SQL. Deployed tests must verify hook
activation, channel reauthorization/teardown and signed-URL lifetimes before
claiming end-to-end immediate revocation or a complete migration.

## Configuration contract

### Owned password and MFA session mutations

`GET /api/auth/password` returns only whether the current verified Kova account
has an owned password. `POST /api/auth/password` accepts exactly the current
password and the new password. It rechecks the current password using scrypt,
binds the resulting credential ID/revision to the cookie owner, enforces MFA
where required, and applies client/account throttling and CSRF protection.
One transaction replaces the hash, retires pending recovery/MFA challenges,
disables unfinished authenticator enrollment, advances the account epoch,
revokes prior sessions, and issues a replacement cookie for this device.
No password, hash, recovery code, or session token is written to audit metadata.

TOTP activation and removal now use the `*_with_session` RPCs, which atomically
rotate the current session and retire other sessions. The previous non-rotating
RPCs remain in migration history but are not executable by `service_role` or
browser roles. Pending activation expires after ten minutes; invalid code sets,
wrong-account factors, stale sessions, and replacement-token collisions roll
back without changing factor or account state. Removing the last factor returns
an AAL1 session only when no other owned or legacy MFA requirement remains.

TOTP login consumption now rechecks the active factor and credential revision
under account-first locks. A factor removed between HTTP verification and RPC
completion cannot mint an AAL2 session. Ordinary cookie refresh uses the same
account-first session lock as security mutations. These source/database checks
do not constitute a deployed rehearsal or retire hosted authentication.

### Environment and provider configuration

The server and compiled browser must use matching `KOVA_AUTH_MODE` and
`VITE_KOVA_AUTH_MODE` values. The default is `supabase`; `dual` and `kova` are
activated only through an environment-specific deployment review.

Kova OAuth and email links require exact HTTPS origins in
`KOVA_AUTH_ORIGIN` and `KOVA_AUTH_PUBLIC_ORIGIN`. The JWT issuer must be an
exact HTTPS URL in `KOVA_AUTH_ISSUER` (including its trailing slash). Secret
material is server-only:

`VITE_KOVA_AUTH_ORIGIN` is the browser-safe copy of `KOVA_AUTH_ORIGIN`. It is
used only to navigate to the Kova-owned Google OAuth start endpoint when the
auth and application hosts differ; the server still validates the request
against `KOVA_AUTH_ORIGIN` before creating state.

- `KOVA_AUTH_ENCRYPTION_KEY` is a base64url 32-byte AES key and
  `KOVA_AUTH_ENCRYPTION_KEY_SHA256` pins its fingerprint.
- `KOVA_AUTH_JWT_PRIVATE_KEY` is a PKCS#8 P-256 key;
  `KOVA_AUTH_JWT_PUBLIC_KEY_SHA256` pins the derived SPKI public key and
  `KOVA_AUTH_JWT_KEY_ID` identifies the imported Supabase signing key.
- `KOVA_GOOGLE_CLIENT_ID` and `KOVA_GOOGLE_CLIENT_SECRET` belong to the
  Kova-owned login client, not the separate Google connector.

Supabase requires the matching private JWK to be imported as an
environment-specific signing key before it can trust Kova-minted RLS JWTs. Its
`kid` must equal `KOVA_AUTH_JWT_KEY_ID`; activation is a separate, reversible
staging key-rotation step. The key may be entered only in the signing-key
control—not the SQL editor—and must also live in the application environment's
secret store. The private signing key, service-role key, encryption key,
passwords, raw challenges, and raw session tokens must never be placed in the
browser bundle, repository, SQL text, or logs.

## Auth Rehearsal evidence and cutover receipt

The September 24 Rehearsal database has the MFA binding, multiple-factor
login, legacy MFA bridge, MCP session authority, and explicit hosted-ID mapping
migrations installed. A read-only check returned zero legacy MFA gaps, 119
scoped RLS tables, and zero violations in all five revocation-proof counts.
The bridge table has RLS enabled and denies browser-role reads; its five RPCs
and the MCP authority RPC are service-role-only with empty search paths and
bounded statement timeouts. The bridge has no rows yet. These checks establish
database state, not a deployed application rehearsal.

`scripts/release/kova-auth-cutover-gate.mjs` accepts a JSON receipt outside the
source tree and compares it with a clean checked-out commit. Run it with
`--evidence <receipt.json> --environment <name> --project-ref <ref>
--config-sha256 <audited-config-fingerprint>`. The receipt must contain the
exact `sourceSha` and `appBuildSha`, environment, project ref, `ACTIVE_HEALTHY`
status, HTTPS deployment origin, `kova` mode, config fingerprint, and a capture
time no more than fifteen minutes old. It requires all five named migrations,
`legacyMfaGapCount: 0`, the six fields from
`kova-auth-revocation-proof.sql`, service-only ACL/search-path/timeout evidence
for the four security-sensitive RPCs, every named deployed check exported by
the script, and expiration times for the last pre-marker JWT and last historic
signed Storage URL that precede capture. JSON field names are defined by the
validator and exercised in `tests/unit/kova-auth-cutover-gate.test.mjs`.

Capture the database counts and ACLs with read-only queries on the project
identified in the receipt. Capture the browser, device, email, OAuth, Storage,
Realtime, MCP, and rollback checks from the _deployed_ build. The validator
checks consistency and freshness; a JSON file alone does not authenticate
where its observations came from. Review the original observations and live
configuration before any cutover authorization. No complete deployed receipt
exists while app deployment, signing-key configuration, and device rehearsal
remain unapproved.

### Hosted-auth retirement inventory

The source still contains hosted Auth SDK calls in login/MFA panels, the
Supabase client and auth attacher, Google connection helpers, account and
trusted-contact routes, MCP bearer fallback, and data clients that obtain
compatibility sessions. Pure Kova routing and owner-bound requests are covered
by source tests; dormant hosted calls are not evidence that every deployed
surface has exercised its pure path. Before retirement, capture a runtime
inventory from the deployed build and check each bearer, password, refresh,
logout, passkey, recovery, email, invitation, signed URL, and Realtime path
under `kova` mode. Prove that no old hosted credential revives authority after
owned revocation. Existing `auth.users` rows remain inert compatibility rows
until the separate retirement decision; no destructive deletion is implied.

OAuth consent remains fail closed when the owned principal cannot be resolved.
Its redirect URI and client must be checked against the deployed authority,
and any dormant hosted fallback must be removed only after the runtime
inventory and the owner-approved staging transition. Production cutover,
merging this PR, and changing signing keys remain separate decisions.
