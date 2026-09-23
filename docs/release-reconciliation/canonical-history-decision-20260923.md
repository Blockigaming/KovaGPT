# Canonical migration history: proposed reconciliation decision

Status: **proposed for independent review; no production action approved**. This
decision uses the 98-version captured ledger and the 157-file source checkpoint
in `release-migration-lineage.json`. Refresh both before accepting an execution
plan. A source timestamp absent from production is not an execution instruction.

## Exact inventory and disposition

| Set                                          | Count | Proposed disposition                                                                                                                                                                                                          |
| -------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared source and captured remote timestamps |    74 | Retain; verify full statement identity and current ledger before application.                                                                                                                                                 |
| Remote-only versions                         |    24 | Retain all 24. Five have reviewed content equivalence; 19 remain `requires_schema_proof`. Never delete or silently relabel them.                                                                                              |
| Source-only timestamps                       |    83 | Preserve as the raw gap. The isolated 98-version rehearsal executes 82; the remaining security body was executed once under its equivalent remote timestamp. This replay exception does not create its canonical history row. |
| Isolated final ledger                        |   180 | 98 existing + 82 forward executions. This is a disposable database result, not current production history.                                                                                                                    |

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
writer review. The September 23 scoped live comparisons of scheduled objects
and the temporary export routine are partial observations, not 19 accepted
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
3. Specify a **per-source-version history action** for all 83 absent source
   timestamps. For each, distinguish an already executed equivalent body from
   a version to execute; pin source SHA, expected prior state, target ledger
   change, validation, and rollback/recovery gate. In particular, explicitly
   decide how the absent `20260903145843` canonical row will be represented
   without rerunning its body. Do not invent an applied timestamp or rely on
   the disposable rehearsal's 180 rows as a production target.
4. Rehearse that exact proposed history operation in an isolated copy with
   synthetic data, then with an authorized actual-backup restore; demonstrate
   unchanged customer data, full 19-scope catalog contracts, precise before/after
   ledger sets, and cleanup. The current CI replay does not implement a
   production history repair.
5. Obtain separate approval for the precise production history/application
   operation after recovery, Storage, provider/key, Azure rollback, and release
   candidate gates. Apply only with a fresh pre-operation ledger readback and
   stop on drift. Record the resulting ledger and scoped catalog independently.

**Decision still needed:** the production treatment of all absent canonical
timestamps, especially the equivalent security migration, has not been
selected or reviewed. Accordingly this is a concrete inventory and review
sequence, not accepted M13 reconciliation or authorization for M20. No
production SQL, history repair, restore, deployment, or mapping promotion was
performed to prepare it.
