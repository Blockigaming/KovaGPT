# Scheduled catalog comparison — 2026-09-23

Both scheduled mappings (`20260823092107`, `20260823092450`) remain
`requires_schema_proof`. This report compares fresh read-only live catalog
captures with both the 98-version isolated baseline and the 180-version
source-final rehearsal. It does not authorize a grant change, lineage promotion,
history repair, migration execution, deployment or scheduler activation.

## Exact inputs

- Connected target selected by the operator: KovaGPT Supabase project
  `mfbycmbjygcfkrsuepxf`, database `postgres` on PostgreSQL 17.
- Source commit: `6642e8c109ca7fce346fa3a760976d5a09aaae2f`; source tree:
  `fb265d07798304b1bbb71a7b4169f055f90a97e7`.
- Hosted KovaGPT CI run: `35635159447`, successful `isolated-database` job
  `106455166430`; artifact `database-upgrade-evidence` (`10656073978`). The ZIP
  matched its published SHA-256
  `41fdde863422db38328e60cf0bdcd2ebc14ad2d248a4d8a880788981a0f127bd`.
- Table query SHA-256:
  `6bb88798ba36bf178a6057a4a14fb4c4941e6925384511c59f7f168257dd46d0`.
  Routine query SHA-256:
  `f29d28e93527edd4437c1be74ecadeecd4c8b74c13a70a0e025a1b36da90aeae`.
  Both equal the exports in the pinned source commit.
- The live table capture completed at `2026-09-23T00:15:51.935Z`, and the live
  routine capture at `2026-09-23T00:15:53.365Z`. Both transactions reported
  `REPEATABLE READ`, `READ ONLY`, and the exact 98-version ledger. The table
  inventory contained two tables; the routine inventory contained seven routines.
  No application rows, scheduled functions, raw function bodies, or secrets were
  read by these collectors.

## 98-version baseline versus live

| Scope                  | Matching categories              | Actual difference                                                           |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `scheduled_task_runs`  | Schema, RLS, triggers            | Explicit ACL and effective privileges                                       |
| `scheduled_tasks`      | Schema, RLS, triggers            | Explicit ACL and effective privileges                                       |
| Seven routine families | Routine definitions and metadata | Only the explicit ACL of `next_scheduled_task_occurrence(timestamptz,text)` |

The table baseline ACL fingerprint is
`4f1e4bc6bb34afd3cd5ab7776cc0aac6ceebddaa73f8e041951d5b77f459e7d6`;
live is `2cfc66cb6ee054889ff381aca3f926d966c2a80844456ca637a02d069c322967`.
The routine baseline ACL fingerprint is
`647b776d3b15bc77b4f375260425db21c19c42a0cfd982f289df7f14067d2da0`;
live is `b8070ce8f8bd0e0af9f90b52e1b14a63e8502fd41cf20e8abd0e80ac731544c5`.
The other baseline category fingerprints match their live counterparts.

A separate bounded aggregate query confirmed eight explicit `anon` DML grants
across the two tables, four explicit `authenticated` DML grants on
`scheduled_task_runs`, and three explicit API-role EXECUTE grants on the
recurrence routine. These are catalog grant counts, not evidence that RLS allows
any particular row access. The original September 20 report documents their
role-by-role distinction.

## 180-version source-final versus live

The later source migrations deliberately change the scheduling contract. The
source-final table capture differs from live in policies on `scheduled_task_runs`;
and in columns, constraints, inbound foreign keys, ACL, effective privileges,
policies, and triggers on `scheduled_tasks`. The source-final routine capture
differs from live in six routine families' definitions/metadata or privileges,
and in the recurrence routine's explicit ACL. These changes are not erased by
the matching 98-version structural categories.

The source-final table fingerprint is schema
`283f143ea57207ebc05e644302633be642e8152c806baa1199590fc4908d77ac`,
ACL `8d2139ab49ad466c47fc9b7881ebca4df6ec85cfc2b3f9a70fbf3d01612b6723`,
RLS `d846973b2485c6683f87ea082961882f65d597dba06eb3c5a2120556cf1f1bcf`,
and trigger `bdc20d15063905650af72816486c6c6ce6f0e458c17104c35746db7b54b2a50e`.
The source-final routine fingerprint is
`f57eb638f50fea20be3992f3fec626fdfb9c7341a9dfb0a25c2a74468404f100`,
with ACL `cbd3bfd4ed20253608fe41643c8a69d04656872cf1575087f89f081b027314a3`.

## Reproduce the comparison

Run the exact exported `SCHEDULED_TABLE_SQL` and `SCHEDULED_CATALOG_SQL` from
`scripts/release/upgrade-database-scheduled-tables.mjs` and
`scripts/release/upgrade-database-scheduled-catalog.mjs` through a verified
read-only connection. Save each single `capture` object from the SQL result as
JSON, without the SQL tool's envelope. Download the hosted ZIP, verify its
published digest, and extract its three named JSON files. Then run:

```bash
node scripts/release/compare-live-scheduled-catalog.mjs \
  upgrade-database.json \
  upgrade-scheduled-table-catalog.json \
  upgrade-scheduled-execution-catalog.json \
  live-scheduled-tables.json \
  live-scheduled-routines.json
```

The comparator verifies the receipt's artifact byte hashes, exact collector
query hashes, source commit/tree consistency, complete rehearsal ledger sets,
capture shapes, chronology, and recomputed fingerprints. Its output includes bounded
schema changes and grant deltas: grantor and grantee role names, privilege type,
grantability, and effective API-role privilege values. It never emits
application rows or raw function bodies. Every promotion/readiness flag is
false. Its `rehearsalQuerySha256` does not identify the SQL that produced the
live JSON; `liveQueryIdentityVerified` is false. The selected live project
identity is an operator-side fact: the catalog JSON does not independently
attest its Supabase project ref. Do not use this
scoped comparison as the v2 full-schema proof for either mapping; later-writer
scope, dependency closure, synthetic behavior, independent review and
production-history reconciliation remain separate gates.

## Dated September 24 continuation

New read-only captures at `01:47:37.767Z` and `01:47:39.221Z` are retained as
[`scheduled-tables-live-capture-20260924.json`](./evidence/scheduled-tables-live-capture-20260924.json)
(`d77bfeb32bf24dd5d7de0d8b3c3918f59cc71ed097938d41ebcb2ccd0b07d3f4`)
and [`scheduled-routines-live-capture-20260924.json`](./evidence/scheduled-routines-live-capture-20260924.json)
(`cb1b00fc44242f44ca14a4753281b2bcad31ed4f75ecc4257bdbfe3abdb0e4f7`).
Both reported a 98-version read-only repeatable-read snapshot. The
[`saved comparison`](./evidence/scheduled-live-comparison-20260924.json)
replays against hosted artifact `10656073978`: two table and one routine
baseline changes; two table and seven routine source-final changes. Every
promotion, canonical-history and production-readiness flag remains false.
The two live captures are separate snapshots and their bytes alone do not
independently attest the selected project or exact executed query.

## Dated September 27 continuation against the current hosted replay

The exact-head #436 KovaGPT CI run `36337285127` passed its isolated-database
job at source commit `56c66d16dd8ae7e5310285608dda9ec61722d216`, tree
`91329495c0c8c1260140f5a5edb39f24aa3a59a7`. Its artifact `10938038678`
has ZIP SHA-256 `0de3c625ced5ff18faafe9171be8e4c208e417c3242bf0a9fb89f28256f6e835`.
The canonical 98-to-208 replay's extracted
`upgrade-database.json`, `upgrade-scheduled-table-catalog.json`, and
`upgrade-scheduled-execution-catalog.json` have SHA-256 respectively
`4a0b5fd36e57fb3d55e3737c6d9b93ece7a5279949d3ad050b89e3c268870a30`,
`af6421f030c874bf364c11cdc51da7edff298e21b99f0284460607a6c6523a32`,
and `1c3616dc4ef2481758855017c1afc227720e7eb51c770ac7985c060885244b5a`.
The first-remote-omission synthetic variant in the same ZIP was not used.

Fresh read-only, repeatable-read SQL calls against the selected project
`mfbycmbjygcfkrsuepxf` returned a two-table [catalog](./evidence/scheduled-tables-live-capture-20260927.json)
at `2026-09-27T18:17:07.793Z` and a seven-routine
[catalog](./evidence/scheduled-routines-live-capture-20260927.json) at
`18:17:16.632Z`. Both reported the same ordered 98-version ledger.
A separate read-only [row-total observation](./evidence/scheduled-row-totals-20260927.json)
returned zero rows in both tables; its client time was recorded after the SQL
response. These separate transactions are not an atomic snapshot, and zero
rows cannot prove row conversion.

The [saved comparison](./evidence/scheduled-live-comparison-20260927.json)
was regenerated from the formatted checked-in catalogs and the exact hosted
receipt; it agrees with a fresh comparator invocation. Baseline-to-live has
two changed tables, only in explicit ACL and effective privileges, and one
changed recurrence routine, only in its explicit ACL. The table schema/RLS/trigger
and routine-definition fingerprints match the isolated baseline. Live has
16 additional table DML grant entries across the two tables and three
additional EXECUTE grant entries on
`next_scheduled_task_occurrence(timestamptz,text)`; routine effective execute
access is unchanged. Source-final-to-live has two changed tables and seven
changed routine identities. The later `kova_owned_session_guard` restrictive
policy exists on both scheduled tables in the isolated source final, not the
98-version baseline or live capture. This is a later writer, not proof of either
historical scheduled entry's effect.

To reproduce the saved comparison, verify the ZIP digest above, extract the
three named JSON files, and run `compare-live-scheduled-catalog.mjs` with
those paths followed by the two September 27 catalog paths. The table and
routine exported query SHA-256 values are
`6bb88798ba36bf178a6057a4a14fb4c4941e6925384511c59f7f168257dd46d0`
and `f29d28e93527edd4437c1be74c13a70a0e025a1b36da90aeae`. The saved
comparison SHA-256 is
`dc1e14324a8eecffefde18fa983e81a435a023aee8f770377bbf8de0b97468fa`.
The SQL calls' selected project and identity were observed through the
connector, not proven by the raw catalog JSON; the comparator correctly sets
`liveQueryIdentityVerified: false`. Its proof, history, and release flags
remain false. Review the extra grants and the first/second remote statement
effects, later writers, row history, dependencies, and synthetic behavior
before proposing either version-2 proof.
