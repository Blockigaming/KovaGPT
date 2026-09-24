# August 23 privilege lineage: live catalog checkpoint

Captured 2026-09-23 21:27–21:56 UTC from Supabase project `mfbycmbjygcfkrsuepxf`,
PostgreSQL 17.6, 98 recorded migrations, with `REPEATABLE READ`, `READ ONLY`.
The queries read PostgreSQL catalogs and migration history only; no application
rows, messages, customer identifiers, or function results were requested. The
output is bounded catalog metadata and aggregate violation counts.

The reproducible queries are
[`scripts/release/privilege-live-violation-counts.sql`](../../scripts/release/privilege-live-violation-counts.sql)
(SHA-256 `9bed2bdf36bdff8db229a890455a1e8d00a67536b4198c0bbb87cefb42b2c561`)
and [`scripts/release/rls-helper-live-aggregate.sql`](../../scripts/release/rls-helper-live-aggregate.sql)
(SHA-256 `8ed14a40925b85e24ef52a524da42e48237f2bb06084c677d00125bcdec1a16c`).
These are **independent catalog snapshots**. The revised privilege query ran in
its own read-only transaction at 21:56 UTC; the helper/policy query ran at 21:27
UTC. Both observed a 98-version ledger, which does not prove the catalog stayed
unchanged between runs. Each result below supports only its own scoped
observation. A combined catalog-parity conclusion requires a single
`REPEATABLE READ`, `READ ONLY` transaction for both collectors and comparison
with the isolated final-source checkpoint.

The comparison baseline is the checkpoint immediately after existing source migration
`20260904230329_production_privilege_lineage_reconciliation.sql` (P), plus H
(`20260823220903_client_privilege_hardening.sql`) and R
(`20260903145843_remediate_security_advisor_warnings.sql`) where applicable.
The recorded remote-only SQL lives under
`tests/fixtures/production-migration-history-20260904/` and is historical
evidence, not an instruction to replay it on production. P is a **later source
candidate**; this report does not presume it already ran on the 98-version
target. Subsequent source writers must be included before asserting final
source equivalence. In particular, `20260905001217_family_atomic_membership.sql`
redefines `public.enforce_family_member_cap()` as SECURITY INVOKER with an empty
search path after P changes that path. The live routine is also SECURITY
INVOKER, but retains `search_path=public, pg_temp`; both the intermediate P
checkpoint and the later source state differ from live.

| Remote version   | Observed live scope                                                                                                                                                                                                                                                                                                                  | Source checkpoint distinction and remaining proof                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260823215044` | Across 118 public table-like relations, including the relation kinds covered by `ON ALL TABLES IN SCHEMA public`, zero effective anon/authenticated TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN privileges; zero effective sequence UPDATE grants.                                                                                    | P also revokes from PUBLIC and covers sequence UPDATE and version-appropriate MAINTAIN. The aggregate current-state match cannot reconstruct which historical revoke occurred or certify later writer effects.                                                                                                                                                                            |
| `20260823215132` | Three expected scoped functions exist. The private family implementation is postgres-owned, STABLE and SECURITY DEFINER; both public facades are SECURITY INVOKER. Anonymous EXECUTE is denied and authenticated/service EXECUTE allowed. The private family implementation and plan helper contain caller-scope rejection.          | Live `public.user_plan_tier(uuid)` retains `search_path=public, pg_temp`; P sets `pg_catalog, public, pg_temp`. The stored definition hashes and guarded behavior need exact source comparison and isolated two-user tests at the final checkpoint.                                                                                                                                       |
| `20260823215222` | Seven named trigger routines exist, postgres-owned, return `trigger`, have actual trigger bindings, and deny client EXECUTE. Six retain historical `search_path=public, pg_temp`; `validate_agent_dependency_edge()` retains `search_path=public` and SECURITY DEFINER.                                                              | **Seven of seven** differ from the immediate P checkpoint's `search_path=pg_catalog, public, pg_temp`. A later family-membership writer changes one of those paths to empty in source, while live still retains the historical path. Compare full definitions, later writers and bindings to the isolated final-source capture; presence and EXECUTE denial alone are not complete proof. |
| `20260823215259` | All 16 listed server-only tables exist, have RLS, have full service privileges, and have zero effective client table/column grants. All 16 named false-deny policies are **PERMISSIVE**.                                                                                                                                             | P creates **RESTRICTIVE** false-deny policies. Thus 16/16 required restrictive policies are missing. An additional permissive policy could override a permissive false-deny if a future grant were added. This is genuine policy-mode drift, not mere formatting.                                                                                                                         |
| `20260823215454` | Postgres-owner global function defaults still have one PUBLIC EXECUTE grant; global table and sequence defaults have zero effective client grants. Public-schema table defaults have eight effective client grants and sequence defaults have four. Public-schema function service EXECUTE is present.                               | P explicitly revokes global PUBLIC EXECUTE and public-schema table/sequence client defaults. Existing schema-local function revocations cannot subtract the global PUBLIC default. Owner-specific inheritance, grant options, and the actual fresh-object behavior still need an isolated final-state comparison.                                                                         |
| `20260823215619` | All 17 scoped connector tables exist; zero effective anon grants, zero authenticated table-operation mismatches against P's explicit matrix, zero effective client column-only grant findings including inherited roles, and complete service table grants. `google_oauth_tokens` has no authenticated operations under this matrix. | H previously granted authenticated DELETE on `google_oauth_tokens`; P revokes it. A final operation matrix match does not prove the sequence of historical effects, function grants, policy visibility, or later writers.                                                                                                                                                                 |
| `20260823215848` | The public catalog has 209 policies; 168 reference `auth.uid()`, nine `auth.role()`, and two `auth.jwt()`. A lexical scan excluding scalar SELECT wrappers found zero remaining unwrapped direct calls. Scoped policy-catalog SHA-256: `85ee85d9eb297f7e67fbaaa39a5e8544a3470f4bb5c09df2fb160347b5173c81`.                           | The digest must be compared with the isolated source catalog at the same checkpoint. The lexical scan is insufficient to prove each policy's roles, command, permissive/restrictive mode, predicate, dependent helpers, or behavioral parity.                                                                                                                                             |

The source-only PGlite regression in `tests/unit/production-privilege-lineage.test.mjs`
now runs the **same aggregate SQL** before and after applying P in a disposable
fixture. It sees pre-reconciliation deny/default/search-path failures and
verifies that P clears those measured failures afterward. A negative control
adds inherited column-only grants, global table/sequence defaults, and DDL
grants on a view and materialized view; the same query detects every inserted
violation. All four tests in that file passed locally. The existing separate tests exercise caller-scope
denial with synthetic users; no live user-owned function was invoked.

## Acceptance status

All seven mappings above remain `requires_schema_proof`. This capture is
current-state evidence with real differences from the P checkpoint and later
family writer. The remaining work is a complete same-checkpoint isolated source
capture of table/column/default/function privileges and every policy; an
object-by-object comparison including dependencies, later writers and grant
options; synthetic two-user/RLS behavior; backup/restore verification; and
independent review under the proof-v2 contract. Do not repair remote history,
apply P to production, or promote any mapping from these counts alone.
