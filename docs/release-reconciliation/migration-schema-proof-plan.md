# Migration schema proof plan

The production migration lineage intentionally fails closed while any remote-only migration remains `requires_schema_proof`.

Generate the deterministic proof workload from the reviewed lineage and current migration manifest with:

```bash
node scripts/release/migration-schema-proof-plan.mjs
```

Optional environment overrides:

- `KOVA_MIGRATION_LINEAGE_FILE` for the reviewed lineage JSON.
- `KOVA_MIGRATION_MANIFEST` for the current generated migration manifest.

The command is source-only and read-only. It does not connect to Supabase, repair migration history, apply DDL, alter production, or mark any lineage entry proven. Its version-2 output lists every unresolved remote version, the candidate source versions that must be rehearsed, the required provenance fields, and the four fingerprint categories required by the preflight contract: schema, ACL, RLS, and functions.

A lineage entry may move to `schema_proven` only after an isolated source-state rehearsal and the reviewed remote state produce equal normalized fingerprints accepted by `validateSchemaProofEvidence()` in `scripts/release/migration-preflight.mjs`. Version-1 proof files are rejected.

## Version-2 proof binding

The proof file must bind all entries to one reviewed source checkpoint and one reviewed remote checkpoint. It records:

- the exact source commit and tree, source and remote artifact SHA-256 values, artifact creation timestamps, and ledger-version SHA-256 values;
- for every proof, the exact capture timestamp, collector-query SHA-256, canonical capture SHA-256, ledger-version SHA-256, and four normalized fingerprints;
- the target project, complete observed source and remote migration counts, remote version, candidate source versions, and stable proof ID.

The promoted lineage entry itself pins the reviewed collector query and canonical object-scope SHA-256 values. The validator independently derives the remote ledger digest from `KOVA_REMOTE_MIGRATION_FILE`, resolves the lineage's `observedSourceCommit` from the local Git object database, and requires the source artifact's tree and complete ordered migration ledger to exactly match that commit. It also requires both captures to match the lineage's query and scope digests, rejects captures created after their artifacts, and compares all four fingerprints. Self-reported equal hashes are not sufficient. Ready mode therefore fails closed when the declared source commit is unavailable, including in a shallow checkout that does not contain it.

Ready mode also requires these exact reviewed artifact files:

```bash
KOVA_MIGRATION_SCHEMA_PROOF_FILE=/path/to/proof-v2.json \
KOVA_MIGRATION_SCHEMA_SOURCE_ARTIFACT=/path/to/source-captures.json \
KOVA_MIGRATION_SCHEMA_REMOTE_ARTIFACT=/path/to/remote-captures.json \
  npm run release:migration-preflight:ready
```

The source artifact is an exact JSON record with `artifactKind: "migration-schema-source-captures"`, its source commit/tree, creation timestamp, complete ordered ledger versions plus their digest, and one capture per proof. The remote artifact uses `artifactKind: "migration-schema-remote-captures"`, the target project ref, creation timestamp, complete ordered ledger versions plus their digest, and the same proof inventory. Each capture contains its proof ID, remote version, timestamp, query digest, ledger digest, and sanitized schema snapshot.

Preflight hashes the supplied artifact bytes, parses the artifacts, recomputes both ledger digests, every canonical scope and snapshot digest, and all four fingerprints, and requires those values to match the proof file and promoted lineage entry. Every mapped source/remote version must occur in its artifact ledger. Extra, missing, malformed, duplicate, wrong-scope, or unreferenced captures fail closed. The 64 MiB per-artifact ceiling prevents an evidence file from becoming an unbounded release input.

This binding proves that the reviewed proof references the supplied capture artifacts; it does not decide whether a collector's object scope is complete. Scope review, later-writer analysis, compatibility tests, independent approval, production history repair, backup/restore evidence, and forward migration remain separate gates.
