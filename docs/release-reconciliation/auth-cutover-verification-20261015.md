# Auth transition and rollback verification — 2026-10-15

Production remains on Supabase. This is offline preparation, not cutover permission or deployed acceptance. The approved self-hosted grant `s6-20261015-runner-diagnostics-01` and its image/package bindings remain unchanged and unused.

## Reused evidence

Reuse completed Google sign-in, saved-record creation/reopening/refresh, logout and signed-out project gate evidence. The live database owner/nonmember/anonymous RLS tests remain database tests, not authenticated HTTP isolation evidence. Reuse the existing provider-discovery and expired-link corrections, deletion/retirement tests, and the 39 passing project-routing checks and full application build. PR #450 remains the independent project-navigation release dependency.

The new integration test executes the existing browser authority module, session HTTP handler, store, API admission and actual Auth migrations together. It does not re-run the old tests. The hosted verifier and compatibility-JWT signer use explicit nonsecret fixtures. Saved-record and entitlement tables are owner-FK fixtures; the test does not certify every production product table, Stripe state or live provider consent.

Three focused cases passed on source base `a3c26832dfda5fe7b5dc88f683411d500b9c5a3e`:

1. Paired browser/server `supabase → dual → kova → dual`: a verified Google adoption retains the existing UUID rather than the candidate UUID; hosted provider links, saved-record fields and entitlement fixtures remain byte-equivalent. Browser and API resolve the same owned account. A non-adopted hosted account remains available in dual mode and is denied in owned-only mode. After session revocation, the owned cookie is rejected without exposing a dormant hosted login.
2. Owned credential retirement remains enforced through `dual → kova → dual`. A failed retirement lookup returns sanitized HTTP 503; it never falls back to allowing access. Markers remain intact.
3. **Negative reproduction, not a security pass:** plain `supabase` mode skips the retirement RPC. When the fixture hosted verifier accepts a still-valid hosted JWT, API admission accepts it despite an existing retirement marker. This proves that plain hosted-mode reversion is not a safe general post-retirement rollback. It does not establish a live exploit or current production failure.

The first local run stopped at an incomplete test-fixture module mapping before exercising application behavior. After adding the missing inert billing import to the fixture, all three cases passed. No application behavior was changed to force the result.

## Prepared configuration path

| Stage                        | Browser build                  | Server mode               | Binding                                                                            |
| ---------------------------- | ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| Current continuity           | `VITE_KOVA_AUTH_MODE=supabase` | `KOVA_AUTH_MODE=supabase` | Existing deployment unchanged                                                      |
| Accepted transition          | `dual`                         | `dual`                    | Paired immutable browser/server release; same origin, UUIDs and database           |
| Final retirement             | `kova`                         | `kova`                    | Only after adoption/MFA and complete acceptance gates pass                         |
| Security-preserving rollback | `dual`                         | `dual`                    | Keep migration tables, retirement markers, deletion fences and session revocations |

The browser mode is compiled into its bundle. A server-variable-only change is not a complete switch. Rollback must use a preverified, compatible dual-mode browser/server artifact and must not restore a database snapshot, clear security state, resurrect credentials, or replay migration. A dual-mode rollback is not a full return to hosted credentials for users whose hosted authority was intentionally retired. Those users require a functioning owned path or a separately reviewed recovery design.

The current production database was checked read-only: neither `public.kova_auth_legacy_session_allowed(uuid)` nor `kova_private.auth_legacy_retirements` is installed. Thus the migration-aware dual/owned candidate cannot simply replace the current hosted release. The existing reviewed migration chain and prerequisite gates must be integrated and accepted first; this work ran no production migration.

## Remaining cutover evidence

- Exact release source/config/build identity and paired browser/server deployment, including stale-tab and in-flight behavior at the real edge.
- Existing-user authenticated HTTP owner/nonmember/anonymous response matrix, native passkey/password/recovery ceremonies and provider links.
- Production-shaped full data/entitlement mapping and account-deletion/revocation checks; offline fixture preservation alone is insufficient.
- Controlled deployed rollback with actual health/API checks and measured recovery time. No instantaneous or zero-interruption claim is made.
- Current live rehearsal still requires Models' Cloud Shell release, owner availability, fresh consumption/token/budget/staging qualification, CLOUD_READY before receiver startup and physical READY immediately before activation.

## Hosted screening gap

The project organization is on Free and the existing security advisor reports leaked-password protection disabled. Supabase documents built-in protection as Pro-and-above. The smallest supported configuration payload after a separately authorized eligible-plan change is `{"password_hibp_enabled":true}`. Do not alter any other Auth setting or assume a paid-plan change fits the rehearsal's cumulative $5 ceiling. No plan or setting was changed.

## Limits preserved

All consumed grants stay closed. Keep the completed images, setup and admission, cumulative $5 ceiling including prior spending, 25-second authentication/10-second checkpoint limits, independent watchdog, at least 1,160 seconds before activation, 20-minute maximum, seven-minute cleanup reserve, pinned restoration, scoped cleanup and independent stopped-state verification. No retries, image builds, admission repeats, production changes, merge or S8.
