# Account-retention source-test maintenance

Date: 2026-10-19, approximately 09:27 UTC. Starting production source: `febec2962c5ad645ef942ca3bc9f7a2aeee88953`.

## Bounded result

Only `tests/integration/auth-account-security-source.test.mjs` was executed, serially, with `node --test tests/integration/auth-account-security-source.test.mjs`. Despite the originally supplied unit path, this file lives under integration and only reads source files; this is not a live integration test.

- Before maintenance: exit 1, 7 tests, 6 passed, 1 failed, 0 skipped.
- After maintenance: exit 0, 8 tests, 8 passed, 0 failed, 0 skipped.
- No production-source changes; no broader suite, typecheck, build, browser, or live-service calls. This is not full-suite or runtime verification.

## Exact cause and history

The original assertion at test lines 185–187 looked for `Legally required billing, security, and backup records may be retained` anywhere in SettingsDialog. The sole failing case was `auth UI does not enumerate duplicate signups or expose raw provider errors`, but its auth assertions passed before reaching this unrelated copy check.

- The test had not changed since restored baseline `eaaddce`.
- Commit `f35f129` moved the previous confirmation warning out of SettingsDialog into the presentation-only `src/components/AccountDeletionGraceView.tsx`; the warning remains at current lines 181–186. That commit replaced the production destructive flow with an unavailable deletion view.
- Commit `638a162` introduced the current account/data-deletion Settings notice. At current `src/components/SettingsDialog.tsx:1703–1704`, it says that some billing, security, and backup records may be retained when required by law or operational policy.
- The notice is identical in parent `1dad023`; `git diff 1dad023 febec29 -- src/components/SettingsDialog.tsx` changes only the two saved-memory descriptions. The automatic-memory safeguard did not introduce this failure.
- Current `src/routes/privacy.tsx:171–187` independently describes backups/security/billing/tax/provider retention and operational or legal requirements. Owner specification 357 requires existing privacy/terms information and no invented legal promises. This maintenance preserves the existing disclosures; it does not change or independently certify legal policy or actual retention behavior.

Classification: stale source-location and exact-copy assertion after an intentional component extraction and notice change. No production defect was exposed by this file.

## Assertions retained and strengthened

All original auth, MFA, passkey, redirect, cross-site, account/memory mutation, provider-error, and ownership assertions remain intact. Retention has its own accurately named test:

- Select exactly the named Account and data deletion Settings section.
- Require the complete current retention exception rather than a broad substring from elsewhere in the file.
- Require the 30-day recovery policy and explicit statement that scheduling/recovery are unavailable.
- Require the support mailto link and instruction to use the email connected to the account.
- Retain the original legally-required-record warning against its actual AccountDeletionGraceView owner.
- Require exactly one production view, `status="unavailable"`, and no `onSchedule` or `onRecover` callbacks.

## Persisted logs

Logs are stored under the sibling `kova-spec400-exports/` directory:

- Before: `auth-retention-source-before-febec29.log`; SHA-256 `2aa3e26fae37688c8be557f170875cd03da9e34f23ebf70945ef3aa2336009e7`.
- After: `auth-retention-source-after-febec29.log`; SHA-256 `fd735e669ce4122cc3e122e25e2cae337d7b521775de56b147a29669c090e19c`.

Exit codes above come from terminal execution, not an inference from text in the logs. The after log is the test run for the test content committed with this evidence document. No typecheck, broader-suite, build, or browser claim is made.
