# Migration schema fingerprint contract

`migration-schema-fingerprint.mjs` turns one already-sanitized, explicitly scoped catalog snapshot into the four SHA-256 values consumed by the existing migration schema-proof gate:

- `schemaSha256`
- `aclSha256`
- `rlsSha256`
- `functionSha256`

The utility does not connect to a database, decide which objects belong in a proof scope, collect user/application rows, repair migration history, or promote any lineage entry. Those remain separate reviewed steps.

## Snapshot shape

The input has `schemaVersion: 1`, a `scope` object containing a stable `proofId` and a non-empty, duplicate-free `objects` array of trimmed object identities, and four row arrays under `categories`: `schema`, `acl`, `rls`, and `function`. The capture layer must resolve unstable database identifiers such as OIDs to stable names before hashing. Function bodies should be hashed at capture time and represented by their digest plus the non-secret identity/security metadata needed to interpret that digest.

Top-level category rows and object keys are canonicalized before hashing. Nested arrays are deliberately **not sorted** because some arrays represent semantic sequences such as function argument order. Capture code must sort set-valued arrays such as unordered role sets while preserving sequence-valued arrays.

Every category hash includes the complete declared scope as well as the category rows. Two captures using different proof scopes therefore cannot accidentally produce matching proof fingerprints merely because a category happens to be empty or identical.

`digestMigrationSchemaSnapshot()` separately computes the canonical SHA-256 of the complete sanitized snapshot. The version-2 proof gate uses that digest to bind each proof entry to the snapshot stored in its reviewed source or remote artifact. Object keys are canonicalized; array order remains exact because it may carry sequence semantics.

`digestMigrationSchemaScope()` hashes the canonical `scope` object independently. A `schema_proven` lineage entry pins that scope digest and the reviewed collector-query digest, preventing an artifact for a narrower or different object family from satisfying the mapping accidentally.

Run locally against an already-captured snapshot with:

```bash
KOVA_MIGRATION_SCHEMA_SNAPSHOT_FILE=/path/to/snapshot.json \
  node scripts/release/migration-schema-fingerprint.mjs
```

A matching source/rehearsal and remote fingerprint is necessary but not sufficient to promote a lineage entry. The proof scope, capture queries, source checkpoint, remote target, ledger count, subsequent writers, synthetic compatibility tests, backup/restore evidence, and independent review still need to satisfy the reconciliation contract before `requires_schema_proof` may become `schema_proven`.

Rows must be non-empty plain JSON objects. Non-finite numbers (including JSON numeric overflow), undefined values, sparse arrays, cycles, accessors, and non-JSON objects are rejected instead of silently becoming null, disappearing, or hashing as empty objects. Explicit null values and explicitly empty category arrays remain valid; an empty array is not proof of absence without a separately reviewed successful capture. Duplicate rows are retained, and policy strings and nested sequence order remain unchanged. Scope objects and category rows still require completeness/provenance review: this utility validates the data shape, not whether the collector selected every required object.
