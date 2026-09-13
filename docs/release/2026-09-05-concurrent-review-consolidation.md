# Concurrent review consolidation

The independently published PR #289 head `fef6cf4ab04e3d6ff13ba0b7051b1d97943aa4b0`
adds three commits after `36eb328ced939ad11f791873920b5d674154d311`. The latter's tree
exactly matches local checkpoint `f317a4387dbe65153f2866444aa0820c39edf1b5`.
Every changed path in that three-commit range was compared with the integrated
local source before recording a merge. No branch history was rewritten.

The large-PR `pipefail`/SIGPIPE classification correction and its regression
assertions are retained verbatim from the remote head. The overlapping review
repairs retain the following locally tested implementations:

| Remote repair                                       | Consolidated implementation and reason                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas remote adoption during an intentional revert | Acknowledged edit revisions plus pending-write count protect dirty/reverting edits and permit later clean remote updates. `canvas-version-durability-source` and actual editor regressions cover both.                                              |
| Project comment permission after lock               | Current Project edit permission is checked again after the comment lock. Actual-role `project-canvas-collaboration` tests exercise permission loss.                                                                                                 |
| Canvas active comment capacity                      | Only live comments count toward 500. Bounded redacted tombstones are purged under a new comment epoch, so ancient retries cannot recreate removed comments after cleanup. The client pins that epoch to pending submissions.                        |
| Rejected Google token exchange                      | Encrypted durable staging precedes UserInfo and settlement. Exact receipts and cleanup leases distinguish a rejection from a lost success response and avoid revoking a valid accepted grant. This supersedes best-effort unconditional revocation. |
| Site export allocation                              | `account-export-sites.mjs` checks shared metadata and decoded-body budgets before body reads, then verifies owner/path/size/digest. It replaces the parallel inline export loop rather than embedding Site bodies twice.                            |
| Deleted Site metadata                               | Follow-up migration `20260905020833_sites_export_and_erasure.sql` erases aliases, private metadata and file bodies with bounded cleanup and retry identity. Its lifecycle tests cover deletion and lost-response retries.                           |
| Browser deletion navigation                         | The existing navigation-safe IndexedDB observation and actual Chromium deletion/reset regressions cover the same destroyed-context race.                                                                                                            |

Generated schema and migration provenance are regenerated from the consolidated
source. Counts and hosted results must come from the subsequently published tree;
this merge record does not claim production verification.

## Second concurrent review pass

Remote `0b17a672efc89feafd698aaf3a4a796ee04d43da` adds the three follow-up repairs from `7dbcec8e`. Its ancestry is retained. Canonical `ac1db54a` already clears stale Sites errors; the remote regression is retained verbatim. Canvas retains the bounded redacted-row/comment-epoch design described above, including deletion IDs; the alternative tombstone-table index has no corresponding table in this implementation. Canonical `05ca5389` strengthens deletion beyond the remote local boolean: the initial organization admission already erases memory, so the durable fence is irreversible from that first transaction, with status/retry UI and database protection against fence removal. Generated manifest/schema evidence is regenerated from this exact combined source.

## Third concurrent review pass

Remote `8d5f08df` adds the Canvas payload and retry-fence refinements from `85ea26ef` and an onboarding teardown wait. The teardown wait is retained. Canvas already bounds both persisted redacted rows and returned deletion identifiers to at most 499, with epoch rollover protecting old retries and paginated client snapshots. The alternative remote known-ID filter still leaves its separate tombstone table unbounded; that table is not introduced. Account deletion retains the stronger durable first-admission fence and database prohibition against cancellation, including cross-request retries. The corresponding executable regressions remain in the consolidated suites.
