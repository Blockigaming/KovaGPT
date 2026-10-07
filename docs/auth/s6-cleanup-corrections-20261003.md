# S6 closed-run cleanup and six-check continuation

Auth Migration remains 14/20; S6 remains 16/22 deployed PASS. No new rehearsal
has been started. The consumed run is e772155fb514. Its application source is
5f8cdcf059643a2fa82257ef97773c87448f70d1, tested revision 0000026; restoration
returned the original image to 0000027 and stopped the app.

## Cleanup

The explicitly authorized Cloud Shell fallback deleted exactly one empty
project c5c501a3-ccdd-45ef-b655-353198b83623 at 2026-10-03T17:54:41Z.
An independent database read at 19:41:13Z found zero remaining project rows,
active run accounts/sessions/passkeys/MFA, hosted sessions/unbanned fixtures,
queued mail, Storage objects, or temporary Realtime table. The disposable
Google principal was absent from both active identity systems. The immutable
retirement/audit evidence remains. The original app image stayed stopped.

## Deterministic corrections

- Storage failed at the project object upload with HTTP 400: the private
  project-files bucket was missing in the reduced staging setup. The production
  migration already defines it. Restored only this staging prerequisite with
  the pinned private/10MiB/MIME settings. Subsequent inspection found two missing
  reader columns, status and content_sha256, in the empty staging project_files
  table. Added just those columns using the pinned migration definitions.
  Existing RLS policies were unchanged. Readback confirms zero files/objects.
- Preflight now rejects missing bucket/reader columns before creating fixtures.
- Project cleanup no longer aborts when the optional provenance table is absent;
  exact project/owner/run/path guards remain. Local SQL tests cover both schemas
  and confirm unrelated projects survive.
- Realtime's historical generic assertion cannot be recovered from the retained
  receipt. Do not invent an exact historical phase. Local real SDK/undici socket
  plus compiled production lifecycle reaches SUBSCRIBED. Every wait now records
  a distinct assertion ID, boolean expected/actual, safe numeric counters and
  runner source location. Arbitrary messages and credentials are excluded.
  Cleanup errors cannot replace the primary Realtime assertion.
- Rollback now labels the mode/source-specific assertion. Image restoration is
  distinct from authority assertions. The previously corrected no-session
  contract remains HTTP 200 with session null. Offline tests cover restoration
  after denial-test failure and the real session route contract.
- Coordinator runs only the six unresolved gates. It prepares fresh revoked
  credentials immediately before rollback, with expiry assertions preventing
  expiry from masquerading as revocation. These are rollback inputs without rerunning Legacy MFA or hosted
  retirement acceptance checks. The 16 preserved results are not overwritten.

## Next bounded run (not authorized by this correction cycle)

Before startup: exact-head CI green; unchanged application source/image digest
proof; bucket/reader preflight; fixture absence; existing Google Key Vault
configuration; owner kit available with dependencies installed; original image
pinned; fresh watchdog actual-stop self-test and independent armed readback.
No stale watchdog receipt can authorize startup.

Run Storage and Realtime automation, then one combined physical passkey/Google
session. Rollback checks follow across corrected dual, corrected kova, original
dual. Reserve seven minutes for transitions/restoration/cleanup. Hard maximum
20 minutes, no retry/extension. Close relay, clear only run fixtures, restore
original image, stop app, independently verify cleanup and stopped state. Only
six new deployed PASS receipts plus preserved16 can advance S6 to22/22 and
Auth Migration to15/20. Offline tests do not advance the deployed ledger.
