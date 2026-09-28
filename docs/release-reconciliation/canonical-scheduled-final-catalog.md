# Proposed canonical sequence: scheduled routine final catalog

The earlier 108-body plus three history-only local rehearsal recorded
`20260823113000_day14_atomic_settlement.sql` without running it, while it
executes the earlier `20260822143000_day14_scheduled_execution.sql`. The earlier
body replaces `public.next_scheduled_task_occurrence(timestamptz,text)` with an
`IMMUTABLE` definition. The later source body explicitly changes it to
`STABLE`. Both source files have the hashes pinned in
the earlier inventory; it is an unsafe synthetic control, not
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
drift occurred. The previous 108+3 artifact reports `STABLE` → `IMMUTABLE`
with unchanged body hash. The revised conditional 107+4 local proposal omits
that duplicate source body and keeps `STABLE`; the runner now fails if the
recurrence volatility changes. Neither result approves a production sequence.

The `--canonical-history` rehearsal now uses a fourth history-only sentinel
for source `20260822143000`. It checks that deleting exactly one blank line before the settlement
marker in that pinned source matches both the saved SHA-256 and MD5 of the
second recorded scheduled entry (`20260823092450`). This verifies only the
bounded statement-byte relationship; the first remote entry, data, grants,
full schema scope, later writers and authorization still need review.
This conditional proposal replays 107 other source bodies, checks the exact 209-version
ledger and captures the same seven routine families at baseline and final.
The opt-in `--scheduled-record-only-hypothesis` remains as a separate control
receipt for comparison. The revised action inventory marks the scheduled
record-only action pending both remote proofs. Even if the isolated result
remains `STABLE`, no history action or schema proof becomes accepted.

Review the actual final `volatility`, `definitionSha256` and later writers in
that artifact before accepting the proposed action for either source version.
This collector does not decide whether recording the scheduled candidate
without execution, reordering approved actions, or another reviewed repair is
safe. Both scheduled mappings remain `requires_schema_proof`; all 19 proofs
and production history changes remain blocked. No production connection,
history repair, restore, deployment or scheduled task execution is performed.
