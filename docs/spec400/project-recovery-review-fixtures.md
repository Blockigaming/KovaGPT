# Bounded Project recovery review fixtures

These optional choices use the existing private HTTP adapter, its current synthetic owner and its existing Review project. They do not add production routes, provider calls, account permissions or backend behavior.

## Visible scenarios

Choose Free, Plus or Pro, then select one of these explicitly labeled scenarios and reset the private review. Both open `/projects/33333333-3333-4333-8333-333333333333`. Select the **Tasks** or **Memory** tab inside the project. The separate directory-state selector does not override these nested reads.

- **project-list-recovery · Tasks / Memory fail once, Retry recovers**: the first valid Tasks read and the first valid Memory read each fail independently with HTTP 503. The application's Retry control returns four sample tasks or two sample memories. Repeated reads preserve those rows. Reset re-arms both failures.
- **project-mutation-recovery · Project actions fail once, retry locally**: lists initially contain four meaningful tasks (two To do, one In progress, one Done) and two clearly synthetic memories. Each supported action fails on its first valid attempt and succeeds locally on retry: task status, task deletion, task reorder, memory add, memory deletion, member removal and invitation revoke. Failure counters are per operation, per session. Malformed requests do not consume them.

For task reorder, drag one sample task over another. The first attempt saves only the first requested position before returning its simulated error, matching the application's sequential-write uncertainty. The subsequent list read shows that saved local state; repeating the reorder saves the complete validated order. This is a deterministic recovery exercise, not a production atomicity or concurrency claim.

For task status, retry using the same row's status button. Task deletion keeps the existing confirmation/retry flow. Memory addition leaves the draft available after failure; resubmission creates a disposable sample row. Memory deletion and member removal keep their target until success. The existing viewer `collaborator@example.invalid` can be removed; the owner cannot. Pending invitations start empty. To inspect revoke recovery, use the existing invite UI with a clearly fictional `.invalid` address. That already-existing fixture creates a local pending record and sends no invitation; only its actual pending ID can be revoked.

Task creation and arbitrary task title/date/position updates are deliberately outside these fixtures and return an explicit error. Memory additions follow the existing 1–2000-character contract and allow at most 14 additions before reset, bounding session data. Unknown IDs, incomplete or duplicate reorder lists, unexpected fields, incorrect project IDs, wrong request methods and mismatched supplied owner headers are rejected. Removing/deleting the sample project prevents subsequent recovery reads. Sign-out, disposal and reset block the previous session, including actions waiting on a local owner lookup. The helper uses only the existing server-function manifest and closed fixture registry. Member/invite successful retries reuse existing fixture mutations rather than returning invented success.

## Verification

Run from the source checkout using already-installed dependencies and an already-existing complete review package:

```sh
KOVA_REVIEW_PACKAGE=/absolute/path/to/existing-review-package node --test review-kit/project-recovery-fixtures.test.mjs tests/unit/review-state-fixtures.test.mjs
node --check review-kit/private-http-review.mjs
node --check review-kit/review-state-fixtures.mjs
```

The focused tests use in-process handler dispatch. They do not start a socket, build the application, run a browser, create a commit or contact providers. They verify catalog labels and disclosure wiring, all signed-in tiers, guest exclusion, list retries, directory-state independence, mutation failure/recovery, partial reorder reconciliation, exact row scopes, existing membership/invite reuse, reset/session ownership and closed unsupported routes. Browser interaction, focus and visual acceptance require separate review of a newly built package; passing handler tests does not establish them.
