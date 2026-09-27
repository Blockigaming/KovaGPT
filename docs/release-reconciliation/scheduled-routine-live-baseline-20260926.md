# Scheduled routine production versus isolated baseline

Status on September 26 ET / September 27 UTC: **narrow read-only comparison for proof IDs `proof-20260823092107` and `proof-20260823092450`; neither is accepted.** No scheduler routine was called, no production row was read, and no database write or restore occurred.

The retained isolated upgrade run `36257008993` published `database-upgrade-evidence` artifact `10910973363` (ZIP SHA-256 `8fd441a653806665f49e85318ce01b2a5516dbe9ca1e797bf480d8358e2bcc69`). Its `upgrade-scheduled-execution-catalog.json` binds source commit `24106a7c34d05c234f6d1040cc4bb339c26ed0ca`, a 98-version baseline capture from 2026-09-26 17:12:39 UTC, and a later 208-version isolated upgrade capture. The catalog query digest is `f29d28e93527edd4437c1be74ecadeecd4c8b74c13a70a0e025a1b36da90aeae`.

On 2026-09-27 00:46:48 UTC, the same bounded [read-only seven-family routine collector](../../scripts/release/upgrade-database-scheduled-catalog.mjs) ran through the Supabase connector explicitly targeting production project `mfbycmbjygcfkrsuepxf`. It reported `readOnly: true`, `repeatable read`, seven routines and the same complete ordered 98-version ledger as the isolated baseline. The SQL output alone cannot authenticate the connector target. Comparison used stable routine identities and normalized JSON object keys, preserving array order:

- Six of seven baseline routine records matched the live capture, including function/body definition hashes, ACL entries and effective privileges for `anon`, `authenticated`, and `service_role`.
- `public.next_scheduled_task_occurrence(p_previous timestamptz, p_repeat text)` had matching function metadata and effective permissions for those three roles. The live ACL additionally recorded explicit `EXECUTE` entries for `anon`, `authenticated`, and `service_role`; the baseline recorded `PUBLIC` and `postgres` entries. The ACL arrays therefore differ despite matching checked effective permissions. Preserve and review this difference rather than normalizing it away.
- The isolated upgrade comparison reports six changed routine identities between its baseline and its final 208-version source/remote union. That final state is not the live 98-version state or a per-entry replay of the two scheduled migrations.

This is evidence about a **seven-family routine subset only**. Scheduled-task table columns, indexes, constraints, table/column ACLs, RLS, intermediate historical effects, later writers and the complete four-category per-entry schema snapshots remain uncaptured. The lineage still requires independent source-state and live captures for each scoped proof, reviewed query/scope digests, and exact artifact provenance. Do not promote either entry or the release gate on the basis of matching routine records.

## Scheduled table catalog comparison

The same isolated artifact also contains `upgrade-scheduled-table-catalog.json`, query SHA-256 `6bb88798ba36bf178a6057a4a14fb4c4941e6925384511c59f7f168257dd46d0`. The matching [read-only two-table collector](../../scripts/release/upgrade-database-scheduled-tables.mjs) ran against the same production connector target on 2026-09-27 00:48:24 UTC. Both captures reported the same ordered 98-version ledger and exactly `public.scheduled_tasks` and `public.scheduled_task_runs`.

After normalizing JSON object keys while preserving semantic array order, the captured table records matched on **every field except `acl` and `effectivePrivileges`**:

- `scheduled_task_runs`: production has explicit `SELECT`, `INSERT`, `UPDATE`, and `DELETE` grants to `anon`, `authenticated`, and `service_role` absent from the isolated baseline. Effective privileges for those roles reflect the extra grants.
- `scheduled_tasks`: production has those four explicit grants to `anon` absent from the isolated baseline, with corresponding effective privileges.

RLS and other captured table fields matched, but that does **not** prove these grants permit a row operation or that browser access is safe. The production-versus-rehearsal ACL differences block equivalence; review the intended grant model, effective role inheritance and RLS behavior with isolated identities before any production change or proof promotion. The catalog remains a bounded subset, not a complete v2 schema/ACL/RLS/function proof for either remote entry.
