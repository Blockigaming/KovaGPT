# Isolated scheduled-candidate checkpoint

The two unresolved scheduled migration entries are `20260823092107` and
`20260823092450`. Their proposed source candidate is `20260822143000`. The
complete 157-version fresh source state and the 98-version production state
cannot be compared as if they were the same checkpoint: later source migrations
change scheduled-task columns, policies, and routines. Both entries remain
`requires_schema_proof`.

The current-history upgrade rehearsal can now capture an **intermediate,
disposable** checkpoint. After the verified 98-version historical baseline and
synthetic seed, it applies exactly the first two pending source files in order:
`20260822122000` (the already-recorded goals body) and
`20260822143000` (the scheduled candidate). It asserts the exact 100-version
ledger, then collects the existing read-only whole catalog and the detailed
scheduled-table and seven-family routine catalogs. Only afterward does it copy
and apply the remaining source migrations and check the final ledger. No
application rows, raw function definitions, remote credentials, production
connection, or new SQL migration are exported.

CI opts into this checkpoint with
`npm run release:db:upgrade -- --capture-scheduled-candidate`. The output
`upgrade-scheduled-candidate-checkpoint.json` binds the source commit/tree,
the two candidate migration digests, exact intermediate ledger, three catalog
query digests, and all three read-only captures. `upgrade-database.json` pins
its byte SHA-256. Both artifacts are written only after the ordinary upgrade,
cleanup, and final committed-source checks succeed. Full runs remove any stale
checkpoint first; dry runs report the plan without executing a database
command. A missing or reordered pending prefix fails before starting Docker.

This checkpoint tests what those two source bodies do **when applied on top of
the 98-version historical baseline**. It is not a fresh source installation
at the early candidate version, a reconstruction of the state after the first
remote scheduled statement, or a live 100-version production state. Later
writer review, production ACL drift, scoped four-category snapshots, source
and remote capture provenance, synthetic authorization behavior, and separate
acceptance are still needed for each of the two proofs. The artifact explicitly
reports zero accepted proofs and production readiness false. No lineage or
release gate changes.
