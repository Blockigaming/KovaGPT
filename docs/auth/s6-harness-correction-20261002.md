# S6 correction after 0ab755df4018

Auth Migration remains 14/20 (70%); S6 remains 14/22 deployed PASS.
The bounded run is consumed. App stopped, original image restored on revision
0000025, independent cleanup and watchdog timed stop passed. No new run is
started by this correction. No production, image build, migration or merge.

## Evidence reuse

Use `tests/ops/evidence/s6-deployed-baseline-20261002.json`: the original thirteen
PASS receipts are unchanged; signup/login adds the deployed PASS from
2026-10-02T22:56:37.420Z, revision 0000024. Do not execute signupCheck again.
Disposable account setup still needs signup/login to supply principals to the
unresolved checks; it does not rerun or replace that preserved check.

Application/image source remains 5f8cdcf059643a2fa82257ef97773c87448f70d1.
Only the external coordinator/harness changes. Its separate SHA is embedded by
the build script and retained in the run report. Reuse these image receipts:

- dual: sha256:07d2cd8132f38cd096970e2791e88d147f4ce527742397e6a7f41ff3e5bac83a
- kova: sha256:07ccd96bdb1dbace3e4d8b154ce6c5295f6f2b221c36141c74294b0623fe1509
- original dual rollback: sha256:976c191615aca22d3653d0d3c1704cff743b16df693afea9407b5e2c57be71a1

## Reproduced deterministic defects

The old live receipt retained only error classes, not the assertion/stack. These
are local reproductions against the pinned source, not invented recovered logs.

1. Legacy MFA: the admin-created hosted user has verified TOTP but no adopted
   `kova_private.auth_accounts` row. The real migration-status SQL rejects it;
   the real enrollment handler returns 503, failing `next.status === 200`.
   The runner now prepares only its exact new synthetic user's adopted mapping.
   Local real-handler/SQL execution proves owned enrollment, activation and
   hosted-session retirement after this correction.
2. Storage: inserting a cancelled agent job still invokes
   `enforce_supported_agent_job_kind`, which unconditionally raises
   `Agent runtime unavailable`. Keep that guard intact. Use a supported private
   Project file for authenticated proxy/owner isolation/revocation, retaining
   the original agent-evidence direct-byte/signing/expiry probes. Cleanup covers
   both exact object paths, the synthetic Project and its provenance row.
3. Realtime: esbuild CommonJS writes `module.exports`; the VM supplied only
   `exports`. Supply the linked CommonJS module and consume `module.exports`.
4. Hosted retirement and rollback had missing legacy evidence, not independent
   proof of a product failure. Record unmet dependencies as BLOCKED. Always
   restore the original image independently of the rollback assertions. Existing
   rollback failure and successful-no-session assertion tests still pass.
5. Do not issue an owner invitation before automation passes. No physical owner
   action should be spent on a run with failed automated prerequisites.

Failure receipts now retain a stage, HTTP status, numeric/boolean assertion
values and source locations. Never retain arbitrary error messages, SQL,
response bodies, credentials, identity strings or assertion string values.

## Next bounded window (requires new authorization)

Remaining eight: legacy MFA, Storage, Realtime, hosted bearer retirement,
passkey registration, passkey login/removal, Google callback/consent, rollback.
At most twenty minutes, one attempt, independently verified fresh watchdog before
startup of only ca-kovagpt-auth-rehearsal. Automated checks first; one combined
passkey/Google session only after they pass; dual -> kova -> original dual
assertions; cleanup; stop and independent readback. No retry or extension.

The previous disposable Google identity was bootstrapped then disabled during
cleanup, although OAuth itself was never exercised. The existing fresh-owner
preflight intentionally refuses any previously owned identity, including deleted
ones. Do not silently clear deletion/ban flags or replace credentials to reuse it.
Client ID/secret and their receipts remain reusable. Resolve this fixture identity
boundary securely before any next window; no values belong in chat or logs.
