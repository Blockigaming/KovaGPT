# Privacy account export integration

Source verification: 2026-10-18. This change uses the existing asynchronous account-export API and keeps the existing device-local JSON export separately labeled.

## Existing contract and implementation

- `GET /api/account/export` returns only the latest owned job, or `{ "job": null }`. The panel displays the service's queued, processing, complete, failed, canceled, and expired states, plus real request/completion/expiry timestamps and file size when supplied. It does not invent progress percentages, an ETA, a job history, or data-completeness guarantees.
- `POST /api/account/export` sends the existing empty object. Requests require the current verified session; the client pins its initiating principal, uses same-origin credentials and owner headers, refuses redirects, and bounds requests and responses. The existing distributed limit and durable 12-hour cooldown remain authoritative, including the policy's audit-failure exception. The client also respects `Retry-After`.
- Before sending a POST, the panel persists a principal-scoped session marker under `kova-account-export-request:v2:user:<owner>`. The marker contains only request time and the previously observed job ID. Reads are bounded and validated; denied storage or an existing marker blocks a new POST. A lost response, server failure, malformed success, or ambiguous conflict never causes a POST retry. Only status reads are repeated; removal and download preparation are also disabled until the uncertain request is reconciled. A null or unchanged latest job does not reconcile an uncertain request; a newly observed job does. Explicit pre-dispatch, authentication, verification, invalid-input, or rate-limit rejection can safely release the marker. Session storage is a same-tab safeguard, not a server idempotency guarantee; the existing API provides no idempotency key or request-ID lookup.
- Polling uses status GETs only, at least five seconds apart, while the Privacy section is open and the job is active, request outcome is uncertain, or cleanup is pending. Read errors require a deliberate status refresh. Closing, account replacement, browser-data cleanup, and unmount abort reads and reject late results. A synchronous operation lock blocks repeated clicks.
- Export removal confirms the exact displayed job ID and uses the existing DELETE contract. Processing conflicts and pending artifact cleanup remain visible, including the DELETE response’s explicit cleanup flag when no file path has yet been recorded. Retrying removal targets the same job and does not request a new export. Account records are unaffected by this action.
- Preparing a download reauthorizes through `GET /api/account/export?download=1`. Native-auth responses must contain a same-origin owner/job/version-bound private-file URL and require the signed-in session. Legacy responses must use the configured Storage origin, the exact owned export path, and a bounded 300-second lifetime. A separate explicit link opens the checked file; the UI never claims that a file was downloaded. Links are removed or blocked after expiry or principal changes. Tokens and hashes are not displayed as metadata or stored in the request marker.
- The existing endpoint uses `requireVerifiedUser` for new requests and `requireUser` for status, download preparation, and cancellation. It does not currently expose a recent-reauthentication challenge field or dedicated recent-auth gate. The UI preserves authentication/verification errors and asks the user to complete sign-in/verification; it adds no bypass or invented reauthentication flow. Native private delivery continues to check the active authenticated cookie, ownership, verification, expiry, version, and artifact integrity.

## Narrow source correction

The export table already has `content_sha256`, populated by `complete_account_export_job` in `20260904225916_account_export_generation_outbox.sql`. `ownedPrivateFileLink("export", ...)` requires that digest. The existing account-export route's projection omitted it, which prevented a native-auth completed job from obtaining its authorized link. The only route change adds `content_sha256` to that projection. The public job object still excludes the digest and private storage path. No schema, authorization policy, export worker, or provider behavior was changed.

## Executed verification

The following synthetic tests passed **68/68**:

```sh
node --test \
  tests/unit/account-export-settings.test.mjs \
  tests/unit/account-export-native-link.test.mjs \
  tests/unit/account-export-policy.test.mjs \
  tests/unit/kova-auth-private-download.test.mjs
```

The 17 new tests execute the actual client/helper/component source with explicit mocked authentication, storage, transport, timers, and hook state, plus the actual account-export GET handler with a projection-respecting database fixture. They cover state progression, duplicate clicks, cooldowns, malformed status, safe download targets, unknown POST outcomes across remounts, storage denial, late responses, account transitions, hidden sections, cleanup, cancellation conflicts, retryable artifact removal, expiry, and cloud/device separation. The native-auth handler tests demonstrate the corrected link projection while rejecting foreign ownership, expired artifacts, missing digests, foreign artifact paths, and unauthenticated access. Existing private-file tests continue to exercise the real delivery handler's cookie/owner/version checks, revocation rechecks, expiry, digest, and byte limits.

Focused ESLint and Prettier checks pass for the new component/helpers/tests and changed export route. `node_modules/.bin/tsc --noEmit --pretty false` and `git diff --check` passed.

## Synthetic rendered-review plan

The isolated review adapter intercepts both `/api/account/export` and export-kind `/api/private-files` paths. It must never fall through to the live API. Its fixture job ID is `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`, scoped to the authenticated fixture owner.

The public job shape is:

```json
{
  "job": {
    "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "status": "queued",
    "requestedAt": "2026-10-18T23:00:00.000Z",
    "completedAt": null,
    "expiresAt": null,
    "sizeBytes": null,
    "failureCode": null,
    "downloadable": false,
    "cleanupPending": false
  }
}
```

- **Idle:** GET returns `{ "job": null }`; no export is created by opening Privacy.
- **Requested/processing/ready:** explicit POST returns 202 queued with `Retry-After: 5`; subsequent GETs return processing, then complete with real synthetic completion/expiry timestamps, size, and `downloadable: true`. Preparing the file returns that same job plus the owned private-file URL, `downloadExpiresInSeconds: 0`, and `requiresSession: true`.
- **Failed:** GET returns a failed job with a safe failure code. A request timestamp older than 12 hours permits the retry button; a recent failure retains the cooldown.
- **Unknown:** POST returns an ambiguous 503 `account_export_request_failed`; later GETs return null. The panel stays read-only for new requests, including after remount. Recovery is demonstrated only by a newly observed owned job, not by a fake successful retry.
- **Removal:** DELETE returns canceled. A processing race returns 409 `account_export_processing` with the current job; cleanup failure returns the canceled job with `cleanupPending: true`. Both remain truthful and retry-safe.

These are source and synthetic-test results, not live export acceptance. No live export request, account change, download, build, server launch, deployment, provider action, or spend was performed for this integration. The parent-owned isolated browser review remains separate evidence.
