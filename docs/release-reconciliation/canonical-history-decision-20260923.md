# Canonical migration history: proposed reconciliation decision

Status: **proposed for independent review; no production action approved**. This
decision uses the 97-version captured fixture in
`tests/fixtures/production-migration-history-20260904/manifest.json`, its
98th-row `current-supplement-20260918.json` in the same directory, and the
157-version source set in `release-migrations.json`. The 24 remote-only mappings
and blocked proof states are in `release-migration-lineage.json`. Refresh the
actual ledger and source manifest before accepting an execution plan. A source
timestamp absent from production is not an execution instruction.

## Exact inventory and disposition

| Set                                          | Count | Proposed disposition                                                                                                                                                                                                          |
| -------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared source and captured remote timestamps |    74 | Retain; verify full statement identity and current ledger before application.                                                                                                                                                 |
| Remote-only versions                         |    24 | Retain all 24. Five have reviewed content equivalence; 19 remain `requires_schema_proof`. Never delete or silently relabel them.                                                                                              |
| Source-only timestamps                       |    83 | Preserve as the raw gap. The isolated 98-version rehearsal executes 82; the remaining security body was executed once under its equivalent remote timestamp. This replay exception does not create its canonical history row. |
| Isolated final ledger                        |   180 | 98 existing + 82 forward executions. This is a disposable database result, not current production history.                                                                                                                    |

The full, machine-checked **proposed** action for each of the 83 source-only
versions and the retain decision for each of the 24 remote-only versions is in
`canonical-history-actions-20260923.json`. Generate and verify that inventory
without a database connection using
`node scripts/release/canonical-history-decision.mjs --check`. It pins the
157-version source manifest, source migration Git tree, all source-file hashes,
the 97-row historical fixture manifest, the 98th-row supplement, all 24 remote
fixture identities and hashes, and the captured ledger metadata digest. The
capture in that file is dated September 18; it must be refreshed before any
operation on the current production target.

Three source-only versions (`20260822122000`, `20260823113000`, and
`20260903145843`) are **proposed** as history-only canonical records after
verification of their equivalent remote effects, without executing their SQL
again. The other 80 are **proposed** for execution and recording only after
their individual pre-state, data transformation, and schema contracts are
reviewed. The 98-row synthetic rehearsal executed 82 source bodies (including
the earlier two equivalent goals/settlement files) and skipped only the
security body, so it does **not** validate the proposed 80-body execution
sequence. A complete canonical ledger would contain 181 versions (98 existing
plus 83 canonical versions) if all these proposed actions were separately
accepted and applied. Neither the 180-row rehearsal nor the 181-row projection
is a claim about current production. Every source action in the inventory
remains blocked pending its per-version effect review and a rehearsal of the
exact proposed sequence.

The five equivalent remote entries map to three distinct source versions:

| Remote version(s)                                    | Canonical source version | Evidence/decision                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260823092042`, `20260823092405`, `20260823100156` | `20260822122000`         | Two exact-content and one terminal-newline-only equivalence; keep every remote record.                                                                                                  |
| `20260823120804`                                     | `20260823113000`         | Terminal-newline-only equivalence; keep the remote record.                                                                                                                              |
| `20260906024459`                                     | `20260903145843`         | Identical security body already applied under the remote timestamp. Do not execute it twice: the isolated double application failed on an existing private function (SQLSTATE `42723`). |

All other 19 remote-only versions remain blocked by the lineage file. Their
candidate sequences and required object scopes are enumerated in
`remote-only-migrations-20260915.md`; a matching routine name or a successful
forward rehearsal cannot replace schema, ACL, RLS, function, data, and later
writer review. The retained September 20 live catalog comparison is partial
evidence. Separate September 23 read-only comparisons are proposed in PR #399
and are not part of this branch's base; neither set constitutes 19 accepted
proofs.

## Decision gates before an executable plan can be accepted

1. Pin the intended Supabase project and obtain a new bounded, repeatable-read,
   read-only 98-version ledger and relevant catalog captures. If the version
   count, order, statement identities, or scoped catalog changed, stop and
   revise this document and source-bound proof workload.
2. Review each of the 19 version-2 proofs against the complete candidate
   sequence, later writers, synthetic two-user behavior, and the captured
   target. Preserve any unexplained privilege or function difference as a
   blocker. Promote entries only through the reviewed proof contract and
   independent approval.
3. Review the **proposed per-source-version action** for all 83 absent source
   timestamps in the checked inventory. For each, approve or revise its
   already-executed-equivalent versus forward-execution disposition, pin the
   expected prior state and intended row transformations, then demonstrate the
   exact target ledger change and recovery gate. Choose and rehearse the
   history-recording mechanism, especially for `20260903145843`, without
   rerunning its body. Do not invent an applied timestamp or rely on the
   disposable rehearsal's 180 rows as a production target.
4. Rehearse that exact proposed history operation in an isolated copy with
   synthetic data, then with an authorized actual-backup restore; validate
   each migration's expected data transformations against a reviewed
   before/after contract, absence of unintended data loss, full 19-scope
   catalog contracts, precise before/after ledger sets, and cleanup. The
   current CI replay does not implement a production history repair.
5. Obtain separate approval for the precise production history/application
   operation after recovery, Storage, provider/key, Azure rollback, and release
   candidate gates. Apply only with a fresh pre-operation ledger readback and
   stop on drift. Record the resulting ledger and scoped catalog independently.

**Decision still needed:** the proposed production treatment of all absent
canonical timestamps, especially the equivalent security migration, has not
been independently accepted or exercised as an exact sequence. The history
recording mechanism remains unchosen. Accordingly this is an explicit proposed
action inventory and review sequence, not accepted M13 reconciliation or
authorization for M20. No
production SQL, history repair, restore, deployment, or mapping promotion was
performed to prepare it.
