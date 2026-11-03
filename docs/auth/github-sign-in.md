# GitHub sign-in for KovaGPT

GitHub **login** and the GitHub **Connections** app are different integrations. Do not use the connector's OAuth callback or its repository scopes to authenticate customers.

## Supported deployment modes

- **Supabase hosted mode:** GitHub sign-in is available once the hosted GitHub provider is enabled. The login dialog and full-page `/auth` form use the same hosted callback `/~oauth/callback`.
- **Dual mode:** The same provider is available only when Kova's existing authority gate explicitly allows hosted authentication. A Kova-owned session is never replaced or linked solely by matching a GitHub email.
- **Kova-only mode:** Not yet supported. The UI must not claim that a hosted GitHub account yields a Kova-owned session. Enabling that mode requires a separate, reviewed GitHub identity schema and server-side OAuth-to-Kova-session implementation.

## One-time provider configuration (administrator)

1. Register a **GitHub OAuth App for sign-in**, separate from the GitHub connector. Set its homepage to `https://kovagpt.com`, and callback URL to the hosted Supabase Auth callback, not Kova's app callback: `https://mfbycmbjygcfkrsuepxf.supabase.co/auth/v1/callback`.
2. In the Supabase project Authentication → Providers → GitHub, enable the provider and set that OAuth app's client ID and client secret **privately**. Do not commit them, add them to frontend `VITE_` variables, or send them in chat.
3. Configure Supabase's allowed redirect URLs to include `https://kovagpt.com/~oauth/callback`. Leave `https://kovagpt.com` as the site URL.
4. Verify `GET /auth/v1/settings` reports `external.github: true`. The frontend intentionally disables the control until that probe resolves successfully. Confirm the production `VITE_SUPABASE_URL` points to this same hosted project.
5. Using an actual test GitHub account, start login from both the dialog and full-page `/auth`, approve the minimal authentication request, and verify the callback completes the expected account session. Test cancellation, rejected callbacks, sign out, existing-account safety and dual-mode Kova-session isolation.

Sign-in must not request repository access; connector authorization happens separately after authentication. GitHub OAuth should use the least privilege necessary for a verified user profile/email. The connected GitHub provider does not grant automatic access to customer repositories.

## Acceptance

This PR makes both entry points use the guarded, hosted sign-in path and validates the destination URL. It **does not** configure the production provider, deploy secrets, merge accounts, or establish a Kova-owned login. Do not call this live until the provider and callback are configured and browser-tested with an authenticated user.
