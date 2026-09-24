# Single-checkpoint production privilege catalog observation

At `2026-09-24T11:31:14.635672+00:00`, the read-only Supabase connector
returned [one bounded JSON result](evidence/privilege-single-checkpoint-live-capture-20260924.json)
after the operator selected project `mfbycmbjygcfkrsuepxf`. This was one
`REPEATABLE READ`, `READ ONLY` transaction containing the seven-mapping
privilege aggregate, helper/policy metadata, and all 98 ordered migration
versions. Its LF-joined statement digests match the separate
`2026-09-24T11:27:18.246545+00:00` ledger observation. **Those digests are
ambiguous across embedded-newline array boundaries and cannot prove exact
statement-array identity.** The original artifact now labels its query/project
identity as unverified operator assertions.

At `2026-09-24T12:24:38.955633+00:00`, a new
[single-checkpoint result](evidence/privilege-single-checkpoint-live-capture-v2-20260924.json)
returned the same 98 version/count/legacy LF digest triples, plus
`statementsJsonSha256` for **every** row. This new digest hashes the UTF-8
PostgreSQL `to_jsonb(statements)::text` representation (using literal `null`
for a NULL array); JSON boundaries distinguish `["a\nb", "c"]` from
`["a", "b\nc"]` and preserve NULL elements. The result also includes the
privilege and helper aggregates in one read-only repeatable-read checkpoint.
It selected no application rows or migration statement text. The v2 JSON
file SHA-256 is `7f83761fb8b7714e00bcfcb1b263dfd2112d0450b53fe0e23d2a77ffebaf60ef`.

`node scripts/release/combined-privilege-catalog-capture.mjs` reconstructs
the proposed SQL with SHA-256
`644423256ff10f926e508cd16fbf4efcc456b666afdf8488a57ee4a68a9440b8`;
it incorporates privilege query SHA-256
`aa4471fa29191ea6f6a43536f2888529ae9927a04af276928ab942a3a2f965a8`
and helper query SHA-256
`8ed14a40925b85e24ef52a524da42e48237f2bb06084c677d00125bcdec1a16c`.
The generator bytes SHA-256 are
`f60edf40eadbef1b1f662b760f71d16c49c35e66fec71d80b4036ede2cb1e24b`.
The source privilege/helper inputs were pinned earlier at commit
`5977becee97477a8266a317e55f598ccd1c72d7b`
(tree `c29c21ca9d14722898f1359926cc0ff0f9425da9`). **The query hash is
operator asserted**: this repository has no independently signed raw connector
request/response receipt that binds the exact SQL bytes, source commit, or
selected project ref to the returned database result. The result itself reports
`databaseName: postgres`, which does not uniquely identify a Supabase project.
The new artifact records `liveQueryIdentityVerified:false` and
`liveProjectIdentityVerified:false`. The new digest improves statement-array
encoding; it does not authenticate target identity or establish proof-v2.

| Catalog scope                  | Same-checkpoint observation                                                                                                                               | Source reconciliation consequence                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration ledger               | 98 versions, 1,043 statements; last `20260906024459`; 98 canonical JSON statement-array digests in the 12:24 observation                                  | The legacy LF digests remain for comparison; the new JSON hashes avoid boundary collisions. Neither proves applied effects or independently authenticates the selected project. |
| Server-only policies           | 16 permissive false-deny policies; zero of 16 required restrictive false-deny policies                                                                    | Source P requires restrictive policies. This is a real policy-mode difference.                                                                                                  |
| Trigger routines               | Seven present with bindings and client EXECUTE denial; seven candidate search-path mismatches, six historical matches                                     | Inspect all full function definitions and the subsequent family-member writer.                                                                                                  |
| Function defaults              | One global PUBLIC EXECUTE default; no schema-local function client default                                                                                | Source P revokes global PUBLIC EXECUTE; schema-local revocation alone cannot cancel the global default.                                                                         |
| Public table/sequence defaults | Eight effective public-schema table and four sequence client grants; zero global table/sequence client grants                                             | Source P removes public-schema client defaults.                                                                                                                                 |
| Client table/column grants     | Zero violations for the scoped server-only tables; zero connector matrix mismatches and client column-grant findings                                      | Final aggregate matches do not establish historical identity or every policy/column dependency.                                                                                 |
| Policy/helper metadata         | 209 public policies, policy digest `85ee85d9eb297f7e67fbaaa39a5e8544a3470f4bb5c09df2fb160347b5173c81`; three scoped helper definitions captured by digest | Lexical direct-auth count zero is only an index. Compare every policy and helper with an isolated source-state capture and run synthetic behavior tests.                        |

The first September 23 comparison used separate checkpoints and its original
privilege query changed after review; see
[`privilege-live-comparison-20260923.md`](privilege-live-comparison-20260923.md).
The 12:24 capture fixes the **same-live-checkpoint** issue for those bounded
aggregates and records unambiguous per-row statement-array digests, but it is
not a complete object-by-object source-versus-remote
snapshot. The current live privilege and search-path differences actively
prevent claiming equality with the proposed source checkpoint. All seven
privilege mappings, and all 19 structural mappings overall, remain
`requires_schema_proof`. No proof-v2 artifact is accepted, no canonical
history decision is approved, and no production mutation was performed.
