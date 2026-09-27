# Proposed canonical sequence: scheduled routine final catalog

The proposed 108-body plus three history-only local rehearsal records
`20260823113000_day14_atomic_settlement.sql` without running it, while it
executes the earlier `20260822143000_day14_scheduled_execution.sql`. The earlier
body replaces `public.next_scheduled_task_occurrence(timestamptz,text)` with an
`IMMUTABLE` definition. The later source body explicitly changes it to
`STABLE`. Both source files have the hashes pinned in
`canonical-history-actions-20260923.json`; this is an unapproved proposal, not
an executable production plan.

The isolated 100-version intermediate checkpoint in CI run `36327982471`
(artifact `10935670237`, ZIP SHA-256
`cf7de9e85a7fd144780ca852f26937f33095ee9e4d2e5453c919fff188f2260c`)
shows the replay changes that routine from `STABLE` to `IMMUTABLE` without
changing its body hash. The ordinary 208-version control sequence later runs
the atomic-settlement source body and restores `STABLE`. A fresh read-only
query of the selected 98-version production project on September 27 also
returned `STABLE`; the project selection is not independently attested by
the SQL response. PostgreSQL 17 [documents that `CREATE OR REPLACE FUNCTION`
assigns the specified function properties](https://www.postgresql.org/docs/17/sql-createfunction.html).
An `IMMUTABLE` promise for a helper that uses `now()` can allow incorrect
constant folding in saved plans; see the [volatility categories](https://www.postgresql.org/docs/17/xfunc-volatility.html).

The canonical-history CLI now captures the existing seven-family scheduled
routine catalog at both the exact 98-version baseline and the exact 209-version
final ledger in disposable PostgreSQL. The unchanged read-only query collects
routine metadata, body/definition hashes, grants and effective API-role
privileges, but no routine bodies or application rows. The parser requires the
full ordered ledger and expected routine inventory. After successful cleanup
and committed-source checks, `upgrade-canonical-scheduled-catalog.json`
contains the two validated captures, normalized hashes and field-level
differences; `upgrade-canonical-history.json` pins its byte SHA-256 and the
collector query SHA-256. Failure removes stale success artifacts. The existing
CI upload glob includes both files.

The same validated 98/209 captures now yield a receipt-bound recurrence
assessment. It requires exactly one `public.next_scheduled_task_occurrence`
routine with the reviewed signature at each checkpoint and requires the
baseline volatility to be `STABLE`. The receipt and artifact explicitly report
the final volatility, whether the body hash changed, and whether volatility
drift occurred. On the observed canonical proposal the assessment reports
`STABLE` → `IMMUTABLE`, unchanged body hash, drift detected, and production
sequence approval false. An unexpected baseline or missing routine fails the
rehearsal; a matching `STABLE` value never itself approves the production plan.

Review the actual final `volatility`, `definitionSha256` and later writers in
that artifact before changing the proposed action for either source version.
This collector does not decide whether recording the scheduled candidate
without execution, reordering approved actions, or another reviewed repair is
safe. Both scheduled mappings remain `requires_schema_proof`; all 19 proofs
and production history changes remain blocked. No production connection,
history repair, restore, deployment or scheduled task execution is performed.
