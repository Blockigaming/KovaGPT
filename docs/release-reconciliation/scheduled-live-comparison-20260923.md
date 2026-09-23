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
query hashes, source commit/tree consistency, complete ledger sets, capture
shapes, chronology, and recomputed fingerprints. Its output includes bounded
schema changes and grant deltas: grantor and grantee role names, privilege type,
grantability, and effective API-role privilege values. It never emits
application rows or raw function bodies. Every promotion/readiness flag is
false. The selected live project identity is an operator-side fact: the catalog
JSON does not independently attest its Supabase project ref. Do not use this
scoped comparison as the v2 full-schema proof for either mapping; later-writer
scope, dependency closure, synthetic behavior, independent review and
production-history reconciliation remain separate gates.
