# Scheduled-execution routine evidence

## Scope, not an equivalence declaration

This collector advances the routine portion of the two unresolved scheduled-execution
entries, `20260823092107` and `20260823092450`. Both still require schema proof.
Their recorded statements differ; shared names do not establish identical effects.
All 19 structural lineage requirements remain unpromoted.

The broader workload has four practical capture groups: scheduling (2 entries),
workspace changes (9), privileges (7), and temporary-export removal (1). These are
work batches, not four substitute proofs or a new release score. Keep each entry's
individual source candidates, object scope, later-writer review and obligations.

For scheduling, source candidate `20260822143000` is not the last writer.
`20260823113000` adds atomic settlement and changes recurrence volatility, while
`20260905005111` replaces claim, recovery and settlement functions for activation.
That later migration also changes scheduled-task table columns and policies.
Therefore before/after routine hashes can legitimately differ. Record the exact
differences; never erase them to manufacture an equivalence result.

## Read-only catalog query

`upgrade-database-scheduled-catalog.mjs` exports a single bounded query. It uses a
repeatable-read, read-only transaction, a catalog-only search path, a 10-second
statement timeout and a 1-second lock timeout. It does not invoke an application
RPC, read task/run contents, start a scheduler, enable runtime, or obtain secrets.

It captures all schemas and overloads of these seven case-insensitive families:

- `claim_due_scheduled_tasks`, `recover_expired_scheduled_task_leases`;
- `complete_scheduled_task_execution`, `fail_scheduled_task_execution`;
- `next_scheduled_task_occurrence`;
- `settle_scheduled_task_success`, `settle_scheduled_task_failure`.

Each row records identity, return type, ownership, language, security mode,
volatility, strictness, parallel/leakproof/set-return flags, default-argument count,
body size/hash, full-definition hash, search path and a hash of all configuration.
Raw function bodies and argument defaults are not returned; the definition hash
covers them without disclosing their contents.

ACLs include resolved grantor/grantee names and implicit defaults when the catalog
ACL is null. Effective function EXECUTE and schema USAGE are observed separately
for `anon`, `authenticated` and `service_role`. The collector does not assume the
recurrence helper must share the service-only access model of mutating routines.
Nor do these catalog observations prove authorization checks inside a function.

Sentinels check that `public` and a known built-in function are visible. The full
ordered migration-version set must match the expected checkpoint exactly. The
validator requires all seven public family names, preserves additional matching
schemas/overloads, rejects malformed inventory/metadata and requires PostgreSQL 17.
It resolves no catalog OIDs into unstable numerical identities in the receipt.

References: [PostgreSQL 17 pg_proc](https://www.postgresql.org/docs/17/catalog-pg-proc.html)
and [privilege/catalog information functions](https://www.postgresql.org/docs/17/functions-info.html).
The collector uses catalog metadata, not a new Supabase client/API feature.

## Isolated integration and artifacts

The existing current-history CLI captures this inventory after the exact baseline
history assertion and before synthetic seeding, then again after the final history
assertion. Its existing local Docker socket, generated project name, credential
stripping, SQL assertions and cleanup remain in force. No remote-target flag was
introduced. The programmatic API remains opt-in via `captureScheduledCatalog: true`
with `currentHistory: true`; historical CLI mode performs no new capture.

Only after both captures validate and the existing upgrade and cleanup succeed
is `upgrade-scheduled-execution-catalog.json` written. The main
`upgrade-database.json` links it with its byte and query SHA-256 values. The existing
CI upload glob includes it without any workflow change. Full runs remove stale
scheduled evidence before preflight; dry runs neither execute SQL nor alter files.
The temporary-export collector and its evidence continue independently.

The receipt binds both observations to the source commit and tree. It computes
routine and ACL hashes and reports added/removed signatures and exact changed
fields. `routineCatalogMatch: false` is descriptive evidence of change, not a
suppressed execution error and not permission to reconcile migration history.
Missing/invalid observations and SQL errors still fail the rehearsal.

Every report retains `schemaProofPromoted: false`, `liveCatalogCompared: false`,
`canonicalHistoryReconciled: false`, `productionReleaseReady: false` and
`productionRowsRestored: false`. It explicitly marks table schema/ACL/RLS as
uncaptured. These are not the four complete per-entry schema-proof fingerprints.

## Evidence still required

Scheduled-task columns/defaults, indexes, constraints, table/column grants, RLS,
role inheritance, intermediate historical effects, whole scoped later-writer
analysis and synthetic cross-user/concurrency/settlement behavior remain separate
obligations. Fresh-source and independently bound live comparisons, an actual-backup
restore, recovery completeness and independent review are not established by this
routine collector. No lineage or deployment guard is modified.

## Verification

```bash
node --test tests/unit/upgrade-database-scheduled-catalog.test.mjs \
  tests/unit/upgrade-database.test.mjs \
  tests/unit/upgrade-database-current-history.test.mjs \
  tests/unit/upgrade-database-temp-export-proof.test.mjs
node scripts/release/upgrade-database.mjs --dry-run
```

Local unit tests use synthetic receipts and mocked process calls; they cover exact
inventory/history, semantic differences, inherited privilege observations, both
collectors together, source binding, artifact hash linkage and failure cleanup.
The real hosted PostgreSQL run and its downloadable new-head artifact remain the
execution evidence. A separately retained live read-only receipt is not a
substitute for that run or permission to change production.

## Committed-source provenance for every evidence-producing run

Every full rehearsal, including historical mode and the default programmatic API,
requires a clean committed checkout before reading the manifest, migrations, seed,
or assertions. This check is independent of the optional catalog collectors.
Dry runs remain observational and return `executed: false`, including when planning
uncommitted changes.

`upgrade-source-provenance.mjs` binds the initial commit and tree, checks staged,
unstaged and visible untracked changes, and verifies all tracked regular-file bytes
and executable modes against their Git blob identities. It does not rely solely
on `git status`: `assume-unchanged`, `skip-worktree`, disabled file-mode reporting,
and ignored additional SQL must not hide a mismatch. Symlink and submodule source
entries fail closed. The inspector removes inherited Git redirection/configuration
variables and disables optional index updates, filesystem monitors and untracked
caches; it performs no checkout, stash, reset, commit, repair or network operation.

The source-bound reader also checks each buffer actually consumed by the planner
or SQL execution against that initial tree. An input edited and then restored
between the initial and final observations cannot silently pass through this
reader. Ignored or otherwise untracked migration inputs are rejected. The existing
receipt labels must match the initial identity, and another complete source check
runs after database cleanup and before any success artifact is written. Source
failure removes stale success evidence and reports bounded errors, not file contents.

The `inspectSource` parameter is a programmatic test seam, analogous to the existing
mockable database executor; there is no CLI flag or environment bypass. Existing
orchestration tests declare synthetic source inspectors explicitly. Separate tests
exercise actual temporary Git repositories and the real source reader, including
historical/default runs, hidden edits, late commits and post-cleanup changes.
Only database process calls are mocked in those integration tests.

Use a dedicated checkout without concurrent editors. This is source-byte binding,
not an immutable filesystem sandbox or attestation of Node, installed dependencies,
external tools, or JavaScript loaded before inspection. The dependency lockfile and
hosted runner evidence remain separate inputs. No production or lineage authorization
is granted, and all formal proof/readiness flags remain unchanged.

Git behavior references: [status](https://git-scm.com/docs/git-status),
[index flags](https://git-scm.com/docs/git-update-index), and
[tree entries](https://git-scm.com/docs/git-ls-tree).
