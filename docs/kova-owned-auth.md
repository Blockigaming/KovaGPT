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

| Mode | Kova cookie | Supabase bearer | Purpose |
| --- | --- | --- | --- |
| `supabase` | ignored | accepted | current default |
| `dual` | preferred | accepted only when no Kova cookie exists | migration |
| `kova` | accepted | rejected | final state |

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
