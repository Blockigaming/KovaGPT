# Passkey authentication

KovaGPT supports passwordless WebAuthn sign-in plus passkey and hardware-security-key enrollment,
rename, and removal through Supabase Auth. The browser client explicitly opts into Supabase's
experimental passkey API. Both sign-in and settings remain hidden unless the public
`/auth/v1/settings` capability probe returns `passkeys_enabled: true`, so a deployment never
advertises a ceremony its identity provider cannot complete.

## Production owner action

This is the only provider-side prerequisite and must be performed by an authorized owner because
changing authentication policy affects every account and the Supabase Dashboard requires an
authenticated control-plane session.

1. In the production Supabase project, open **Authentication > Passkeys**.
2. Turn on **Enable Passkey authentication**.
3. Set **Relying Party Display Name** to `KovaGPT`.
4. Set **Relying Party ID** to `kovagpt.com` (bare domain; no scheme, port, or path).
5. Set **Relying Party Origins** to the canonical deployed origins that are subdomains of that RP
   ID. At minimum use `https://kovagpt.com`; add `https://www.kovagpt.com` only if it is an
   intentional interactive origin rather than a redirect.
6. Save. Do not change the RP ID after users enroll: existing passkeys are cryptographically bound
   to it and would stop working.

This action does not create billable infrastructure, but the owner must verify current Supabase
plan terms before saving. Do not enable the UI through a separate frontend flag; availability is
read directly from the deployed Auth settings.

## Verification

From a current browser on the canonical HTTPS origin:

1. Sign in with an existing confirmed, non-anonymous test account.
2. Open **Settings > Security**, add a passkey, rename it, sign out locally, and sign back in with
   **Continue with a passkey**.
3. Register a second credential (a hardware security key where available), remove only the first,
   and confirm the second still signs in.
4. Confirm a cancelled browser ceremony produces a safe retry message, an unsupported browser gets
   a truthful state in Security settings, and a logged-out browser cannot list or alter credentials.
5. Re-open `<SUPABASE_URL>/auth/v1/settings` with the publishable `apikey` header and record only
   the boolean `passkeys_enabled: true`; do not record tokens or credential IDs.

Source: [Supabase passkey authentication](https://supabase.com/docs/guides/auth/passkeys).
