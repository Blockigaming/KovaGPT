# Read-only whole-catalog baseline comparison

Status on September 26 ET / September 27 UTC: **investigation for the 19 unresolved mappings; 0/19 accepted.** No production rows, SQL writes, migrations, restores or release operations were performed.

The isolated rehearsal run `36257008993` published artifact `10910973363` (`database-upgrade-evidence` ZIP SHA-256 `8fd441a653806665f49e85318ce01b2a5516dbe9ca1e797bf480d8358e2bcc69`). Its `upgrade-migration-proof-catalog.json` baseline was captured at source commit `24106a7c34d05c234f6d1040cc4bb339c26ed0ca`. The same [read-only catalog query](../../scripts/release/migration-proof-catalog.sql), SHA-256 `139c334f6fd55006bc81c9f3eeca6677ebe96bc2f2fb45f87f3c9dd6b421f452`, was run through the Supabase connector explicitly targeting production project `mfbycmbjygcfkrsuepxf` on 2026-09-27 at 00:51:50 UTC. Connector project selection is not independently authenticated by the SQL output.

Both captures have the **same ordered 98-version migration ledger**, 124 relation identities, two type identities, and two schema identities. All 124 relation `schema_sha256` values, both type hashes, and both schema ACL hashes matched. Their remaining whole-catalog differences are:

| Category           | Observed difference                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relation ACL       | 77 of 124 `acl_sha256` values differ, including the previously detailed scheduled-table grants.                                                                                                                                                                                                                                                                                                                       |
| RLS                | Only `public.integration_providers` has a different relation `rls_sha256`. A separate read-only live query shows RLS enabled and an `integration_providers_deny_clients` policy for `anon` and `authenticated` with false predicates. The baseline difference still requires review; this observation does not establish a bypass.                                                                                    |
| Functions          | Eight shared `function_sha256` values differ: `kova_private.accept_project_invite`, `decline_project_invite`, `family_owner_of`, `is_family_member`; `public.next_scheduled_task_occurrence`, `projects_add_owner_member`, `set_active_chat_branch`, and `update_agent_definition` (identities include signatures in the capture). Production also has `public.rls_auto_enable()`, absent from the isolated baseline. |
| Default privileges | The aggregate `defaultAclSha256` differs. A separate read-only production query for `postgres` defaults in `public` shows `anon` and `authenticated` have default SELECT/INSERT/UPDATE/DELETE grants on new tables and SELECT/USAGE on new sequences. These observations may help explain individual ACL differences; they do not prove their history or account for every mismatch.                                  |

This catalog returns hashes for `public` and `kova_private`, not per-entry v2 artifacts with independently reviewed object scopes and four normalized categories. The isolated fixture may differ from actual production history even when version strings match. In particular, the conditional source migration for `rls_auto_enable()` can leave different function inventories when the starting environment differs. Inspect each object family, default privileges, later writers, and captured SQL privately; do not equate a matching relation schema hash with migration equivalence. The release preflight and all 19 schema proofs remain blocked.

## September 27 refresh against the current source-head rehearsal

The #436 exact-head hosted isolated-database run `36337285127` recorded a
98-version structural baseline and 208-version source-final inventory at
commit `56c66d16dd8ae7e5310285608dda9ec61722d216`, tree
`91329495c0c8c1260140f5a5edb39f24aa3a59a7`. Its ZIP artifact
`10938038678` has SHA-256
`0de3c625ced5ff18faafe9171be8e4c208e417c3242bf0a9fb89f28256f6e835`.
Extract `upgrade-database.json` (SHA-256
`4a0b5fd36e57fb3d55e3737c6d9b93ece7a5279949d3ad050b89e3c268870a30`)
and `upgrade-migration-proof-catalog.json` (SHA-256
`bd87a54414bccbe04ac09a5949a2e19a9465b7a99294ac947bed2d2e57e0dc60`).
The receipt binds the latter artifact and the exported catalog query SHA-256
`139c334f6fd55006bc81c9f3eeca6677ebe96bc2f2fb45f87f3c9dd6b421f452`.

The [fresh live catalog](./evidence/migration-proof-catalog-live-20260927.json)
(SHA-256 `b42d2fc210a1f2f444469bde6213ae3679d532782ac61ea87b75db909d9658ea`)
was obtained through the read-only connector on selected project
`mfbycmbjygcfkrsuepxf` at `2026-09-27T18:26:04.818266+00:00`.
The source `parseMigrationProofCatalog()` accepted its 98 ordered versions,
19 remote-only single-statement rows, PostgreSQL 17 metadata, and read-only
repeatable-read flags. The [saved object-level comparison](./evidence/migration-proof-catalog-baseline-live-diff-20260927.json)
(SHA-256 `e4cc1f8f3a85d0afdb893d4f41aa783908a0403346419a9264ef817528c7792c`)
was generated after verifying the receipt's artifact hash and query hash,
exact ledger, capture chronology, and matched object identities. Its bounded
result reports the following.

| Baseline scope                         | Fresh live result                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two schemas and two types              | Same identities and digest fields.                                                                                                                                                                                                                                                                                                                             |
| 124 relations                          | Same identities and all 124 schema digests; 77 ACL digests differ and `public.integration_providers` alone differs in RLS digest.                                                                                                                                                                                                                              |
| 78 baseline functions                  | Eight shared definition/security digest differences; live alone also has `public.rls_auto_enable()`.                                                                                                                                                                                                                                                           |
| Default privileges                     | Aggregate digest differs.                                                                                                                                                                                                                                                                                                                                      |
| Nineteen recorded remote-only versions | Version IDs agree, but all nineteen statement-array JSON digests differ and sixteen statement counts differ. The live rows each contain one statement; the structural fixture often splits the captured SQL into multiple statements. This proves the fixture is **not an exact statement-array copy**, without deciding whether its effects match production. |

This refresh confirms the earlier catalog drift rather than clearing it. The
saved comparison includes changed object identities and fields, keeps
`liveQueryIdentityVerified`, `schemaProofPromoted`,
`canonicalHistoryReconciled`, and `productionReleaseReady` false, and
contains only metadata and hashes. The selected connector project and query
execution still require independent review; JSON fields alone cannot
authenticate them. The source-final guard policy and private-helper grant
described in the Day-15 refresh add later-writer dependencies. No one of the
19 version-2 proofs is accepted by this aggregate comparison.
