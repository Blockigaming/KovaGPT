# Day-15 live versus isolated chat-workspace comparison — 2026-09-27

**Status:** ten Day-15 lineage entries remain `requires_schema_proof`. Azure migration remains 14/24 accepted and 0/19 schema proofs accepted. This is a bounded catalog observation, not production authorization or a version-2 proof.

## Verified rehearsal and read-only inputs

The canonical source replay in PR #436, source commit `56c66d16dd8ae7e5310285608dda9ec61722d216` and tree `91329495c0c8c1260140f5a5edb39f24aa3a59a7`, used the hosted isolated-database job in KovaGPT CI run `36337285127`. The exact-head `database-upgrade-evidence` artifact ID is `10938038678`, ZIP SHA-256 `0de3c625ced5ff18faafe9171be8e4c208e417c3242bf0a9fb89f28256f6e835`. The three files below were extracted by exact name; their receipt pointers, source commit/tree, query digests, 98-version baseline and 208-version canonical source-final capture were checked by `compare-live-chat-workspace-catalog.mjs`. The PR's separate first-remote-omission synthetic variant is **not** the source input here.

| Input                                         | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `upgrade-database.json`                       | `4a0b5fd36e57fb3d55e3737c6d9b93ece7a5279949d3ad050b89e3c268870a30` |
| `upgrade-chat-workspace-table-catalog.json`   | `ab01a0378a2ad3744f390156900dbab4bbacfae4002e0e28c8173f9cf4a884fc` |
| `upgrade-chat-workspace-routine-catalog.json` | `6ad8ee76bc1538936849b8214326a23127a4f4ed37522a6b88b72bb2b088d8fd` |

The three catalog/data SQL calls selected Supabase project `mfbycmbjygcfkrsuepxf`. The exported SQL used `REPEATABLE READ, READ ONLY` transactions with 10-second statement and 1-second lock timeouts. The [live table envelope](./evidence/day15-live-chat-table-catalog-20260927.json) completed at `2026-09-27T18:01:31.647Z`, and the [live routine envelope](./evidence/day15-live-chat-routine-catalog-20260927.json) at `18:01:53.987Z`. Both reported PostgreSQL 17, the same 98 ordered versions, four tables or 19 routines respectively, and read-only mode. The [aggregate data evidence](./evidence/day15-live-chat-data-counts-20260927.json) has a later client-recorded timestamp `18:03:17.211Z`, the same ledger digest, and all 24 named violation counts equal to zero. A fourth, separate read-only transaction returned zero [row totals](./evidence/day15-live-chat-row-totals-20260927.json) for each table; its envelope time was recorded by the client **after** the SQL response. These observations are separate transactions, and with zero rows the data checks do not exercise row conversion.

## Bounded comparison

The [saved comparison](./evidence/day15-live-chat-comparison-20260927.json) passed the pinned receipt, artifact bytes, query digests, ledger, capture-shape, read-only, and chronology checks.

| Scope                  | 98-version isolated baseline versus live                                                                                                                                                                                                                                 | 208-version source final versus live                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four chat tables       | No differences in captured columns, constraints, indexes, grants/effective privileges, policies or triggers. All four aggregate fingerprints match.                                                                                                                      | Four changed tables, each with differences in constraints, indexes, policies and triggers. The source-final ACL fingerprint matches live; the other three do not. These are later source changes, not evidence that production should already have them. |
| Selected chat routines | One difference: live gives `service_role` an explicit `EXECUTE` grant on `public.set_active_chat_branch(p_chat_id text, p_branch_id uuid)`; the isolated baseline does not. That role's effective execute privilege differs. The routine definition fingerprint matches. | Thirteen changed or source-only routine identities; the above grant difference persists.                                                                                                                                                                 |

The live table query SHA-256 is `f4586501852be6a16cedf6561445fa4281b72f13a20cf3479f84ba37c8c0db26`, the routine query SHA-256 is `5e7e22c232389e7aa2273417c8465585555da2d831739e696b1a93d7e6c950de`, and the aggregate data query SHA-256 is `2c4d62919fae56192644d4f104605da4e6b0a0e998e5edc5cad61838dc15f947`. The ordered live-ledger digest is `c9bf4a75ebb8c28fd33e965060505558aa8b6d05e06b854b4b01635c527e5eef`. The saved comparison SHA-256 is recorded in this change's review description; editing the report does not change the underlying evidence.

One later writer is already identified: `20260922001355_kova_owned_compatibility_revocation.sql` dynamically adds the restrictive `kova_owned_session_guard` policy to every RLS-enabled public table. All four chat tables have that policy in the exact-hosted 208-version source-final capture, but none has it in the isolated 98-version baseline or current live capture. The same hosted ZIP shows it on both scheduled tables only at the source-final checkpoint. Consequently the final-policy differences depend on the owned-auth session guard and its private tables, not just on the ten historical Day-15 statements. Another later migration, `20260925143706_kova_restore_legacy_private_helper_usage.sql`, restores authenticated USAGE on `kova_private`; the selected public-routine catalog does not establish effective access to those private helpers. Review these dependencies and all 28 source migrations added after the recorded 157-version source checkpoint before proposing any per-entry equivalence.

## Reproduce and finish

Download artifact `10938038678` for run `36337285127`, verify the ZIP digest above, and extract the three named files. From the exact PR source tree:

```bash
node scripts/release/compare-live-chat-workspace-catalog.mjs \
  upgrade-database.json \
  upgrade-chat-workspace-table-catalog.json \
  upgrade-chat-workspace-routine-catalog.json \
  docs/release-reconciliation/evidence/day15-live-chat-table-catalog-20260927.json \
  docs/release-reconciliation/evidence/day15-live-chat-routine-catalog-20260927.json \
  docs/release-reconciliation/evidence/day15-live-chat-data-counts-20260927.json
```

The recorded project ref and count timestamp are client claims; independently verify the selected project and SQL calls. The collectors include metadata and hashes, not customer rows, raw routine bodies, or application payloads. Their scope excludes other dependencies, later writers, and executable cross-user behavior. Review the extra `service_role` grant's provenance and intended authority, close dependency/overload and later-writer scope, run isolated behavioral and legacy conversion checks, then collect and independently review the full version-2 source/remote evidence for each lineage entry. Do not repair history, apply the forward migrations, promote any proof, restore to production, or activate the application based on this comparison.
