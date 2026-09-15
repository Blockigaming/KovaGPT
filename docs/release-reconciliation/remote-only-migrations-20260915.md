# Remote-only migration reconciliation: September 15, 2026

## Decision and scope

**No additional equivalence is proven.** Keep all 19 structural entries at
`requires_schema_proof`; preserve the existing five content-equivalent mappings.
This review is source/evidence work, not authorization to change production history,
apply migrations, enable execution, deploy, reset, replay, or modify application data.

Initial source reviewed: `Blockigaming/KovaGPT` main
`eaf32b57786b7f11cb257d2a15d7e4f02103e6ca`, tree
`3477df57f6f0dbc6e06e55005f8c9a3ffc3c64d6`.
The original lineage file's Git blob is
`3f1556800f23f3c51177f846b2d49f20168fb651`; its retrieved bytes were independently
checked against that blob before preparing the patch.

The changes supplement candidate pointers for six privilege entries and nine
workspace entries with reconciliation migrations already in source. They do not
create a migration, edit any SQL, promote an entry, change an equivalence hash,
change release logic, or mark a source migration applied. The historical
`observedSourceCommit` and `observedSourceMigrationCount: 93` remain historical;
they are not relabeled as the initial 154-file snapshot.

## Final source checkpoint

Before publication, main advanced to `96999ccb7b770629ac91f372a5616a17617df371`
(tree `af3e889d1593d73a78978cd8b5aff3133a9adc58`) by merging PR #335.
Its manifest contains **157** source migrations. The compare from the initial
reviewed head adds three migration files and changes no earlier migration SQL,
lineage inventory, or migration-preflight implementation:

- `20260915011500_retire_deep_research_workspace_search.sql`;
- `20260915012500_maps_provider_throttle.sql`;
- `20260915120000_maps_geocoder_cache.sql`.

The new retirement migration changes research rows, policies, a search trigger,
and a search view; the Maps files add service-scoped throttle/cache structures.
They are separate forward changes, not equivalence proof for these 19 entries.
They must be included as later writers wherever a proposed proof scope overlaps.
None was executed in this review.

Relative to the published 98-row ledger, this final source checkpoint has
**74 shared timestamps, 83 source-only timestamps, and 24 remote-only timestamps**.
The five existing equivalents still cover three distinct source versions, giving
**80 conditional source candidates**, not an execution queue. This comparison
uses the recorded ledger, not a successful new live capture. The 154/80/77 counts
below describe the initial source checkpoint and must not be presented as the
final main counts. The source-only patch is based on this final main tree.

## Evidence provenance and limits

The September 15 [issue #197 evidence update][evidence] reports a read-only ledger
capture at `2026-09-15T18:46:07.400133Z` with 98 records. For the first 97, the
SHA-256 of ordered `version|statementCount|SHA256(LF-joined-statements)` lines is:

```text
a71993ce78c330de3a2eedde0161681ec34eeed93cf5761906f7a5b5ded22067
```

That update reports independent replay-file hash validation and a match to the
September 4 capture. This review relies on that published observation; it does
not represent it as a successful new database capture in this session. Two new
read-only Supabase requests returned upstream HTTP 502 errors, so no fresh
catalog, policy, default-privilege, or function snapshot was obtained here.

At the initial source checkpoint, the manifest declares 154 source versions. The published exact-set reconciliation
is 74 shared timestamps, 80 source-only timestamps, and 24 remote-only timestamps.
The five equivalent remote rows represent only three distinct source versions.
After separately proven and approved history reconciliation, 77 source files
would remain candidates. **Neither 80 nor 77 is an authorized execution queue.**

A timestamp match is not by itself content or schema proof. The structural-fixture
manifest separately describes its 74 matched-source files and 23 reviewed fixtures.
The current evidence does not establish complete production data compatibility.

### Existing content equivalents, unchanged

- Goals: remote `20260823092042` and `20260823092405` map by exact content to
  source `20260822122000`; remote `20260823100156` uses terminal-newline-only
  equivalence to the same source. Pinned source SHA-256:
  `f4bebe4290fd09ccc3398498874d25b2d92da74350374e36471ae0c660595d4e`.
- Atomic settlement: remote `20260823120804` maps by terminal-newline-only
  equivalence to source `20260823113000`. Pinned source SHA-256:
  `3f0e9a3ceb96c0354b1bc032df5a3b77cd02892e53c169c409c7edb303dd9189`.
- Security remediation: remote `20260906024459` maps by exact content to source
  `20260903145843`. The published one-statement digest and pinned source SHA-256
  are `7f479d52a2fddc859d1603932c8b59dbe8b481bcd77e3062b3b94427a631689d`.

These are content-equivalent history mappings, not permission to execute either
copy and not a claim that the current live schema equals all current source.

## All 19 unresolved entries

Candidate keys below identify source timestamps, not equivalence claims or an
execution/dependency order. Existing candidate pointers are retained; the new
pointers are **P** and **W**. Candidate sequences must be evaluated with subsequent
writers and the exact object scope, not as independent files.

- **S**: `20260822143000` scheduled execution.
- **A**: `20260823220701`; **B**: `20260823220805`; **C**: `20260824090000`;
  **D**: `20260824094500` (existing workspace reconciliation candidates).
- **H**: `20260823220903_client_privilege_hardening.sql`.
- **R**: `20260903145843_remediate_security_advisor_warnings.sql`.
- **P**: `20260904230329_production_privilege_lineage_reconciliation.sql`.
- **W**: `20260904230332_canonical_chat_workspace_lineage_reconciliation.sql`.

Every row below remains `requires_schema_proof`. The last column specifies what
must be established; it does not assert that the check passed or that an
uninspected production object has the proposed state.

| Remote version   | Recorded operation                   | Source candidates | Required evidence / unresolved distinction                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260823092107` | Scheduled execution                  | S                 | Compare lease columns, defaults, indexes, claim/recover/settlement signatures and bodies, service-only effective EXECUTE, and scheduled-task RLS at the agreed checkpoint. Later atomic settlement must be accounted for separately.                                                              |
| `20260823092450` | Scheduled execution, second record   | S                 | Same object scope, but its captured statement digest differs from the first record. Prove the ordered final effect; do not assume that matching names make the two records interchangeable.                                                                                                       |
| `20260823151901` | Edit/branch/rules/pinning schema     | A, B, C, D, W     | Compare `chat_custom_rules`, `chat_branches`, `chat_message_versions`, and `chat_pinned_files`: columns, defaults, constraints, indexes, foreign-key actions, grants, and owner/member policies. Include preservation of canonical `instruction`, `retry`, active pins, and long chat IDs.        |
| `20260823151927` | Chat feature hardening               | A, C, W           | Establish the feature constraints and ownership protections after the entire scoped sequence, including trigger definitions and accepted-version/active-branch uniqueness. This is an aggregate reconciliation, not a byte match.                                                                 |
| `20260823214802` | Workspace security hardening         | A, B, C, R, W     | Compare both public and private implementations where relevant: owner, invoker/definer mode, search path, effective grants, policy predicates, and callable overload inventory. Function existence alone is insufficient.                                                                         |
| `20260823215044` | Revoke client DDL table privileges   | H, P              | Compare PUBLIC plus inherited anon/authenticated privileges on all in-scope tables and sequences, including TRUNCATE, REFERENCES, TRIGGER, sequence UPDATE, and version-appropriate MAINTAIN. H is not a complete substitute for P.                                                               |
| `20260823215132` | User-scoped security-definer helpers | H, R, P           | Compare caller-scope enforcement in the private family-owner implementation and plan helper, their public facades, ownership, security modes, search paths, and effective EXECUTE. Separately rehearse cross-user denial with synthetic users.                                                    |
| `20260823215222` | Trigger-only function lockdown       | H, P              | Identify every affected trigger routine and compare return type, trigger binding, search path, owner, and client EXECUTE denial. P explicitly covers seven named trigger-only routines.                                                                                                           |
| `20260823215259` | Server-only table lockdown           | H, P              | Compare the actual table set, table/column grants, RLS flags, restrictive deny policies, service access, and any additional permissive policies. H and P enumerate different sets; RLS enabled alone does not prove equivalence.                                                                  |
| `20260823215454` | Postgres client default privileges   | H, P              | Compare owner-specific global and public-schema defaults, role inheritance, object-type grants, grant options, and implicit PUBLIC EXECUTE. Prove newly created synthetic functions remain private in an isolated database, never production.                                                     |
| `20260823215619` | Least-privilege connector grants     | H, R, P           | Compare table-by-table SELECT/INSERT/UPDATE/DELETE and effective function/column privileges against policy intent. H grants authenticated DELETE on `google_oauth_tokens`; P revokes client privileges there. Do not label this source evolution a byte-equivalent replacement.                   |
| `20260823215848` | RLS auth initplan optimization       | H, R              | The recorded operation rewrites policy expressions. Compare each policy's roles, command, permissive/restrictive mode, USING, WITH CHECK, and referenced helper dependencies. The inspected H/R candidates do not establish the complete rewrite; no new equivalence or P/W coverage is asserted. |
| `20260824081357` | Atomic workspace RPCs                | B, C, D, W        | Compare full argument types/order/names/defaults, return types, lock order, ownership, retention, and effective grants. W explicitly removes an obsolete positional overload; prove canonical PostgREST resolution and synthetic concurrency behavior.                                            |
| `20260824081812` | Message-version/branch integrity     | A, C, W           | Compare foreign keys, delete actions, owner/chat/branch consistency checks, relevant indexes and triggers; verify preserved synthetic versions after upgrade and rejection of cross-owner associations.                                                                                           |
| `20260824081926` | Workspace read model/context bounds  | A, C, W           | Compare read-model structures, relevant view security properties if present, visibility predicates, branch/message bounds and preservation of previously valid IDs and source/status labels.                                                                                                      |
| `20260824082127` | Selected-range version metadata      | A, C, W           | Compare selection columns/defaults/checks and RPC parameters, paired-null behavior, increasing offsets and bounds against the original content. Validate original-content preservation with synthetic history.                                                                                    |
| `20260824084005` | UTF-16 selection offsets             | A, C, W           | Compare the length helper's definition/security/configuration and all selection consumers. Rehearse supplementary-plane characters, exact boundaries, invalid ranges, and null pairing; character-count similarity is not UTF-16 proof.                                                           |
| `20260824085042` | Temporary export removal             | C                 | Fixture drops `public._kova_temp_export_day15(text)`. Obtain a live catalog absence result for that exact signature and check unexpected overloads/dependencies; source absence alone is insufficient. No broad cleanup or new DROP is proposed.                                                  |
| `20260824085444` | Workspace branch RPCs                | B, C, D, W        | Compare create/activate/update signatures and defaults, shared lock namespaces/order, ownership checks, message bounds, active-branch uniqueness, and effective grants; verify two-user isolation in the disposable rehearsal.                                                                    |

## Concrete source distinctions

The inspected H migration removes several privileges only from `anon` and
`authenticated`, uses schema-local defaults, and contains a smaller server-table
list. P additionally addresses PUBLIC, the global function EXECUTE default,
caller-scoped helpers, seven trigger-only functions, a 16-table server-only set,
and the explicit connector access matrix. Adding P as a candidate locates that
existing repair; it does not certify that production already has its final state.

W restores the canonical workspace API and explicitly handles the difference
between accepted-first and selection-first `kova_record_message_version`
overloads. It also defines UTF-16 length and selected-range validation. Its
existence is evidence of source coverage, not a successful comparison with the
live catalog or proof that all historical workspace effects are equivalent.

The existing rehearsal documentation already records synthetic-history checks
and an earlier source-only compatibility repair for canonical `instruction`,
`retry`, long chat IDs, and active pins. Preserve that work rather than creating
another baseline migration or editing the captured production fixtures.

## The current-state upgrade boundary

**The 97-version baseline is not the 98-version current-state baseline.**
The historical rehearsal does not include remote `20260906024459`. Its source
equivalent R contains unconditional moves from `public` into `kova_private`,
public facade creation, and a vector extension move. The September 15 catalog
observation at `2026-09-15T18:54:22.935077Z` already found the inspected public
facades and private implementations, and vector in `extensions`.

Therefore, replaying R under its earlier source timestamp can collide with
already-existing private functions/facades; its `public.vector` signature is also
incompatible with the recorded extension location. Do not copy the 98th row into
the rehearsal and blindly reuse `migration up --include-all`. That would still
select source R unless the separately reviewed lineage strategy prevents it.

An exact-current-state rehearsal needs a reviewed 98-row structural baseline and
an explicitly designed, isolated history-reconciliation strategy that avoids
re-executing already-applied content. Prove that strategy in a disposable target,
with provenance and synthetic data. Do not perform or infer production history
repair from this document, and do not replace the historical 97-row fixture.

## Evidence required before any promotion

Capture production only through bounded, repeatable-read, read-only catalog and
ledger queries. Do not invoke application functions, run synthetic writes in
production, print user rows, expose raw function bodies, or collect credentials.
Hash function definitions in the database; retain the non-secret identity and
security metadata needed to interpret each hash. Record target identity,
timestamp, PostgreSQL version, source SHA, scoped object set, query hash, and
ledger digest with each capture.

Compare schema/ACL/RLS/function evidence at explicit checkpoints and scopes.
Include columns/defaults, constraints/validation, index predicates, triggers,
view security, role membership, effective table/column/sequence/function grants,
owner-specific global/schema default ACLs, policy roles/commands/modes/expressions,
function signatures/returns/defaults/security/search paths, and extension schemas.
Resolve OIDs to stable names; order arrays deterministically; preserve string
literal semantics. Do not erase substantive policy differences by normalization.

A whole-schema difference between 98-row production and 154-file fresh source is
expected to include unrelated new features. It is neither an automatic failure
of each historical mapping nor a justification to ignore differences. Account
for scoped later writers and prove both historical effect and the proposed
forward end state. A green forward upgrade is not proof that an earlier source
file may safely be marked applied without executing it.

Only after the matching scoped fingerprints and executable compatibility checks
exist should an entry be considered for `schema_proven`, with the proof artifacts
required by `migration-preflight.mjs`. Backups/PITR, restore/rollback verification,
independent review, and explicit production authorization remain separate gates.

## Verification of this source-only patch

The local verification checkout contains the exact retrieved lineage blob and
these added review files, not a full application checkout. The five focused
Node tests verify the complete 19-entry blocked set, the six privilege and nine
workspace candidate additions, all preserved semantic content, and the document's
19-row/current-state-baseline contract. The semantic snapshot hash ensures that
removing only those 15 additions restores the original lineage content, including
all five equivalences, source hashes, historical counts, reasons, and safety notes.

```bash
node --test tests/unit/production-migration-reconciliation-review.test.mjs
```

These tests do not execute SQL, validate a live schema, replay a database, replace
the existing full-repository lineage tests, or establish a successful hosted
exact-head CI run. Full repository CI and the exact-current-state isolated
rehearsal still need their own successful evidence. Production remains unchanged.

[evidence]: https://github.com/Blockigaming/KovaGPT/issues/197#issuecomment-5686351674
