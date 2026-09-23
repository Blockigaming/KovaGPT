# Temporary-export candidate: source effect inventory

Remote entry `20260824085042` remains `requires_schema_proof`, and all 19
structural mappings remain blocked. This inventory starts the full-effect
review of its proposed source candidate `20260824090000`. It is a source review,
not a live schema comparison or a decision to equate the two migrations.

## Pinned bytes and checkpoint

| Input                  | Pinned identity                                                                                                                                                                                               | Scope                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Source checkout        | commit `1f17e686ef8243bc94ec9fcb9b7e4c18a21ec762`, tree `47fcc93b85c87dbbb5cf3b92b33315889cd499d0`                                                                                                            | #399 head from which this inventory was prepared                                                                    |
| Remote history fixture | `tests/fixtures/production-migration-history-20260904/20260824085042_remove_temporary_day15_source_export.sql`, SHA-256 `546d25859cd2b5a3756f27ef4c13ef2b79d21641c091087a63176d0a22218d2b`                    | Reviewed replay of `DROP FUNCTION IF EXISTS public._kova_temp_export_day15(text)`; not the original production text |
| Candidate source       | `supabase/migrations/20260824090000_day15_chat_workspace_reconciliation.sql`, SHA-256 `5c86b2c7f26d1a3bff47cb43db71ee0ff5291e01ebfb278c0edb9a6841f6a034`, Git blob `bd96d83d7f28f95af2e86b457c674050a1d4abab` | 504 lines, order 81 in the 157-file pinned source manifest                                                          |

The candidate file does not mention `_kova_temp_export_day15`, and it does not
execute the historical `DROP FUNCTION`. The source scan of all 157 verified
migration files proves that symbol is absent from those files. The scoped live
catalog comparison proves absence of the exact signature, routine-name family,
inbound dependencies, and literal stored-routine references at the captured
98-version checkpoint. Neither result attributes the candidate's other effects
to the historical one-statement removal.

The source manifest records `destructive: true` and `dataBackfill: true` for the
candidate. Its `tables: []` and `rls: []` fields are **not an effect inventory**:
the SQL visibly changes four tables and rewrites five privileged routines. The
introductory comment describes the migration as additive, but it also drops
function overloads and constraints and replaces their definitions. Review the
actual SQL and catalog effects rather than inferring safety from either label.

## Candidate's direct effects

Line ranges refer to the pinned 504-line SQL file above. These are source
statements and function bodies; they do not assert what production currently
contains or how many customer rows a backfill would touch.

| Lines   | Object / effect                                                                                                                                                                                                                                                                                                                  | Review boundary                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 19–70   | `chat_branches`: add `conversation_id`, `branch_from_message_index`, `message_ids` with empty-array default; backfill null `conversation_id` from `chat_id`; make it NOT NULL; add conversation length, nonnegative index, and 2,000-ID checks; add unique `(owner_id, chat_id, conversation_id)` and owner/chat/active indexes. | Column/default/nullability, backfill cardinality, constraints, both index definitions and uniqueness on populated data.               |
| 76–137  | `chat_message_versions`: conditionally rename `edit_instruction` to `instruction`, add `instruction` and selection offsets; backfill `source='regeneration'` to `retry`; replace source enum-style check; drop old instruction-length check and add the new 4,000-character limit and paired selection-range check.              | Both possible preexisting column names, data conversions, constraint definitions, accepted source values and invalid historical rows. |
| 143–158 | `chat_pinned_files`: backfill `status='ready'` to `active`, replace the allowed-status check, and set the default to `active`.                                                                                                                                                                                                   | Data conversion, status check/default and any external readers of old values.                                                         |
| 164–198 | `chat_branches`, `chat_custom_rules`, `chat_message_versions`, `chat_pinned_files`: dynamically drop/recreate each `chat_id_length` check at 1–256 characters; additionally replace the message/version combined `chat_id`/`message_id` length check.                                                                            | All four table constraints, dynamic names and populated-target compatibility.                                                         |
| 204–291 | Drop an earlier `kova_record_message_version` overload; create/replace the 11-argument function as `SECURITY DEFINER` with `search_path=public`; owner lookup, advisory lock, version/acceptance updates, insert and old-version pruning. Revoke PUBLIC/anon EXECUTE; grant authenticated/service_role EXECUTE.                  | All overloads, body/config/owner/security/ACL, referenced tables and runtime behavior.                                                |
| 293–338 | Create/replace `kova_accept_message_version(uuid)` as `SECURITY DEFINER`; owner check, advisory lock, accepted-version update; reset and grant EXECUTE as above.                                                                                                                                                                 | Function body/config/ACL and accepted-version invariants.                                                                             |
| 340–424 | Drop an earlier `kova_create_chat_branch` overload; create/replace a 10-argument `SECURITY DEFINER` version; owner checks, advisory lock, branch capacity, parent and conversation uniqueness, active-branch changes and insert. Reset and grant EXECUTE.                                                                        | Overloads, return type, concurrency, owner boundary, table/index semantics and ACL.                                                   |
| 426–465 | Create/replace `kova_activate_chat_branch(text,uuid)` as `SECURITY DEFINER`; owner check, row/advisory locks, active-branch updates. Reset and grant EXECUTE.                                                                                                                                                                    | Function body/config/ACL and single-active-branch behavior.                                                                           |
| 467–504 | Create/replace `kova_update_chat_branch_messages(uuid,text[],text)` as `SECURITY DEFINER`; owner check, 2,000-ID bound, message/label update. Reset and grant EXECUTE.                                                                                                                                                           | Function body/config/ACL, owner boundary and message-ID capacity.                                                                     |

There is no direct `CREATE POLICY`, `ALTER POLICY`, or table `GRANT` in this
candidate. The five functions' `SECURITY DEFINER` and explicit EXECUTE changes
can still change effective authority over the four tables. A complete proof must
compare the tables' existing RLS policies and effective access as well as these
new routines; the lack of policy DDL in this file does not make RLS irrelevant.

## Known later source writers and consumers

The following are **all later source migration files** in this checkout with a
case-insensitive whole-name match for any of the four tables or five `kova_*`
routines above. A mention can be a consumer rather than a schema writer; the
effect classification below is based on reading its actual statements. This is
not yet a PostgreSQL dependency-closure proof or a search of application code.

| Source version and SHA-256                                                                                                                | Relevant later effect                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260824094500_day15_canonical_workspace_rpc_aliases.sql` — `0cfaaf95eaaa22d25b8f704355e49a32b383a084663f2ca1b57e166b8926e945`           | Conditionally creates canonical wrapper RPCs `create_chat_message_version`, `accept_chat_message_version`, `activate_chat_branch` if absent; wrappers invoke the candidate's `kova_*` routines and have their own security-definer and EXECUTE grants. No direct rewrite of the four tables or five candidate functions.                                                                                     |
| `20260903145843_remediate_security_advisor_warnings.sql` — `7f479d52a2fddc859d1603932c8b59dbe8b481bcd77e3062b3b94427a631689d`             | Changes the candidate's five `kova_*` functions (including either known record-message overload) from `SECURITY DEFINER` to `SECURITY INVOKER`. This changes authority even if the body is otherwise retained.                                                                                                                                                                                               |
| `20260904230332_canonical_chat_workspace_lineage_reconciliation.sql` — `44bb822403d1213a6a90df6dd4afbcc5efd3e0216069d193edbf8a949371a449` | Replaces the five `kova_*` bodies and canonical workspace RPCs, makes known overloads invoker and resets EXECUTE grants, adds branch-integrity trigger/function, and replaces two constraints on `chat_branches`/`chat_message_versions` with `NOT VALID` checks (lines 1111–1196). It changes ownership/concurrency/UTF-16 selection behavior and the message-ID ceiling from the candidate's 2,000 to 512. |
| `20260905000905_project_canvas_collaboration.sql` — `5b6ae37ebf0edf38aca1f8c89cba1ccb8beaaf090c8494aa04996a0f47314a34`                    | Replaces `chat_message_versions_content_length` with a larger content check (lines 76–80), introduces canvas routines that read/write message versions, and adds an insert/update trigger on that table (line 339).                                                                                                                                                                                          |
| `20260910210000_workflow_skill_packages.sql` — `15fb94556a7fe60a86b91798540012a4fa01ee8d0829f09bb70ae55017846751`                         | Lists the four workspace table names in a data-export ownership registry (lines 221–228); a later consumer of their owner columns, not direct DDL on those tables.                                                                                                                                                                                                                                           |

## Missing acceptance evidence

1. Freeze an agreed historical and final comparison boundary for this single
   remote version. The candidate's four-table/five-RPC effect overlaps other
   remote workspace changes; equivalent final snapshots would not attribute
   them to this one remote DROP.
2. Generate complete, receipt-bound metadata for each affected table, index,
   constraint, trigger, RLS policy, default, ACL, function overload, ownership,
   body hash, security mode and transitive dependency in isolated checkpoints
   and a read-only live capture. The current temporary-export collector covers
   only the removed routine family; no complete candidate/live comparison exists.
3. Measure aggregate backfill and constraint-violation counts on a production
   `REPEATABLE READ`, `READ ONLY` snapshot, without returning row values or
   customer content; rehearse data compatibility on a disposable restored copy
   before any production migration.
4. Account for all later writers and dynamic/catalog dependencies, and review
   function authority and owner isolation after each relevant checkpoint.
   Extend the source-name inventory to application callers and external
   references before declaring dependency closure.
5. Obtain independent acceptance of an exact proof artifact bound to project,
   query hashes, full ledger, source commit/tree and byte-verified rehearsal
   receipts. Do not promote the mapping before that evidence exists. Backup
   restore, canonical-history repair and production release gates remain
   separate and blocked.

Reproduce the source byte checks with `sha256sum` on each listed path and run
`node scripts/release/migration-temp-export-source-proof.mjs`. The source scan
returns `migrationCount: 157`, `matchingFiles: []`,
`fullLedgerScanned: true`, and `schemaProofPromoted: false`. No production query
or mutation was performed to prepare this inventory.
