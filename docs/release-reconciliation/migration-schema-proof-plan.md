# Migration schema proof plan

The production migration lineage intentionally fails closed while any remote-only migration remains `requires_schema_proof`.

Generate the deterministic proof workload from the reviewed lineage and current migration manifest with:

```bash
node scripts/release/migration-schema-proof-plan.mjs
```

Optional environment overrides:

- `KOVA_MIGRATION_LINEAGE_FILE` for the reviewed lineage JSON.
- `KOVA_MIGRATION_MANIFEST` for the current generated migration manifest.

The command is source-only and read-only. It does not connect to Supabase, repair migration history, apply DDL, alter production, or mark any lineage entry proven. Its output lists every unresolved remote version, the candidate source versions that must be rehearsed, and the four fingerprint categories required by the existing preflight contract: schema, ACL, RLS, and functions.

A lineage entry may move to `schema_proven` only after an isolated source-state rehearsal and the reviewed remote state produce equal normalized fingerprints accepted by `validateSchemaProofEvidence()` in `scripts/release/migration-preflight.mjs`. Production history repair and forward migration remain separate, explicitly approved operations.
