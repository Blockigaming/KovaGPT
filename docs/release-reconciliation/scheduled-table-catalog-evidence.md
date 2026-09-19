# Scheduling table catalog checkpoints

This is the table-side companion to the scheduling routine collector. It covers
`public.scheduled_task_runs` and `public.scheduled_tasks` for proof entries
`20260823092107` and `20260823092450`. It does not promote either entry or change
the 19-entry blocked lineage inventory.

## Scope

The collector reads PostgreSQL 17 catalogs in a bounded repeatable-read, read-only
transaction. It captures columns and default hashes, constraints, indexes, explicit
table/column grants, effective table privileges for the three existing API roles,
RLS enablement/force flags, policy roles and expression hashes, and user-trigger
identities/definition hashes. No task/run/customer rows or raw routine bodies are
returned, and no scheduler or application function is invoked.

The fixed search path and byte-order sorting make checkpoint comparisons stable.
Each observation retains its timestamp, PostgreSQL version, exact migration-version
set and source commit/tree. A missing table, malformed or extra field, incorrect
history, duplicate name, invalid hash, or unsupported partition/inheritance layout
fails validation. Explicit grants are not collapsed into effective privileges. `aclIsNull` records
whether `pg_class.relacl` is null independently of the expanded ACL inventory,
and participates in the ACL hash. An implicit default ACL and an explicitly
stored identical ACL therefore remain distinguishable. Each index also records
`pg_index.indisreplident` as `replicaIdentity`; switching the selected existing
replica-identity index changes the schema hash even when both index definitions
and the table's `relreplident` value are unchanged.
A column ordinal gap is permitted because dropped columns may leave gaps; duplicate
ordinals and duplicate live column names are rejected.

The four hashes are scoped **schema, ACL, RLS and trigger** hashes. The trigger
category is not a substitute for the separate seven-family routine fingerprint.
Changed columns, permissions, policies and triggers remain visible as changed
fields, even if a later source migration deliberately causes those changes.
A successful capture is not an assertion that the two states are equivalent.

## Integration

The current-history command-line rehearsal captures the tables before synthetic
seeding and after the final upgrade-history assertion. The programmatic API adds
`captureScheduledTables: true` with `currentHistory: true`; existing callers remain
opt-in. Historical mode and dry runs do not perform these catalog reads.

The existing committed-byte and filename-inventory checks, local-only generated
Docker project, credential stripping, SQL assertions and cleanup remain in force.
No workflow or migration SQL is added. The unchanged evidence-upload glob collects
`upgrade-scheduled-table-catalog.json`, whose byte and query SHA-256 values are
linked from the main upgrade receipt. Stale table evidence is removed before a
full run, and new evidence is written only after cleanup and final source checks.
The two existing collectors retain independent artifacts and hashes.

## Verification and limitations

Tests use synthetic catalog observations and mocked database execution. They
exercise all three collectors together, table-only mode, exact histories, invalid
fields, duplicate inventories, genuine ACL/RLS differences, ordering, capture
failure, cleanup failure, final source failure, and observational dry runs.
Missing or non-boolean ACL-storage/replica-identity flags fail validation; old
captures must not be upgraded by guessing their values. The query hash changes
with these catalog fields, so a new hosted capture is required. These tests do
not claim a real PostgreSQL table checkpoint; the new exact-head
hosted artifact is required for that result.

Read-only live-side observations may be retained separately. Any query-byte
variation must be disclosed rather than relabeled as the exact collector query.
A live observation is not an isolated-source checkpoint or permission to modify
production. In particular, RLS enabled plus table privileges does not by itself
prove which rows a role may read or change; executable authorization tests remain
separate.

This is not a whole-database/dependency-closure comparison. It does not cover
sequence state, referenced foreign-key target structures, role-membership graphs,
all transitive trigger dependencies, generated-column execution behavior, grants
with inherited column privilege effects, or actual task data. Original intermediate
migration effects, later-writer review, fresh-source/live comparisons, runtime
concurrency, canonical history reconciliation, recovery and independent review
remain open. All proof/readiness/restore flags are explicitly false.

References: [PostgreSQL 17 relation catalog](https://www.postgresql.org/docs/17/catalog-pg-class.html),
[column catalog](https://www.postgresql.org/docs/17/catalog-pg-attribute.html),
[policy catalog](https://www.postgresql.org/docs/17/catalog-pg-policy.html),
[default ACL semantics](https://www.postgresql.org/docs/17/catalog-pg-default-acl.html),
[index catalog](https://www.postgresql.org/docs/17/catalog-pg-index.html), and
[privilege information functions](https://www.postgresql.org/docs/17/functions-info.html).
The Supabase changelog was checked before implementation; no client/dependency or
CLI upgrade is part of this change.
