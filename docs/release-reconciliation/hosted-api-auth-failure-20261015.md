# Hosted API verification failure classification

Source base: `a3c26832dfda5fe7b5dc88f683411d500b9c5a3e`. Supabase remains the active production provider. This correction is not deployed and does not change any rehearsal grant or image.

## Reproduced defect and correction

The real `/api/memory` GET handler calls `requireUser` before its data-read error boundary. The hosted branch treated every returned Supabase verification error as an invalid session. An injected HTTP 503 through the installed Supabase SDK therefore produced an application 401. An unexpected `getClaims` exception escaped the handler entirely. Both regressions were reproduced before changing application code.

`api-auth.server.ts` now reuses the existing terminal-user-error policy. Provider errors that do not establish invalid credentials return a sanitized, non-cacheable 503. Unexpected exceptions also fail closed with 503. Explicit rejected, expired or malformed credentials remain 401; an account-binding mismatch remains 409. Privileged clients are created only after verification succeeds. No retry, logout, credential reset or automatic provider fallback was added. Diagnostics contain only a fixed phase/classification and bounded numeric status, never upstream messages, URLs, tokens or bodies.

## Focused verification

Six focused cases exercise the actual memory route, shared API authorizer and installed Supabase SDK. The remote Auth response and privileged data transport are nonsecret fixtures; they are not live signature, RLS or deployment acceptance.

- Upstream 503 and 429 produce 503 and can recover with the same fixture credential without signing out.
- An unexpected verifier exception produces a sanitized 503 before privileged access.
- Owner and other-account requests return only their own fixture memories even though the data transport is privileged.
- Anonymous and credential-removed requests return 401 without Auth or data access. This does not prove revocation of a previously issued JWT.
- Explicit rejection and malformed credentials return 401; mismatched owner binding returns 409.

The existing live Google/save/refresh/logout and database-isolation evidence is reused. These new checks establish application response handling and owner-filter wiring offline. They do not replace live owner/nonmember/anonymous API evidence.

## Remaining live uncertainty

The earlier direct HTTP probe was rejected by Cloudflare and browser navigation timed out. Their missing origin response details remain unavailable. This reproduction does not establish that either live barrier was caused by the corrected code, nor that this source revision is deployed.

Password sign-in, email recovery and native passkey acceptance remain incomplete. Neither known account had a registered passkey in the retained metadata check. No production configuration, password, provider link, account or saved record was changed. PR #450 remains a separate project-navigation release dependency.
