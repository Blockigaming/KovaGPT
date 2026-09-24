# Single-checkpoint production privilege catalog observation

At `2026-09-24T11:31:14.635672+00:00`, the read-only Supabase connector
returned [one bounded JSON result](evidence/privilege-single-checkpoint-live-capture-20260924.json)
from project `mfbycmbjygcfkrsuepxf`. This was one `REPEATABLE READ`,
`READ ONLY` transaction containing the seven-mapping privilege aggregate,
helper/policy metadata, and all 98 ordered migration versions with statement
counts and SHA-256 digests. It selected no application rows and returned no
migration statement text. The version/statement/digest triples match the
separate `2026-09-24T11:27:18.246545+00:00` ledger observation exactly.

Recreate the exact SQL sent to the connector from reviewed source with
`node scripts/release/combined-privilege-catalog-capture.mjs`. Its SHA-256 is
`800ef2c8b1552c4872a17bff246c6dfa5d9be22b7c41d02ee27c8a874fd7b472`;
it incorporates privilege query SHA-256
`aa4471fa29191ea6f6a43536f2888529ae9927a04af276928ab942a3a2f965a8`
and helper query SHA-256
`8ed14a40925b85e24ef52a524da42e48237f2bb06084c677d00125bcdec1a16c`.
The source inputs were read at commit `5977becee97477a8266a317e55f598ccd1c72d7b`
(tree `c29c21ca9d14722898f1359926cc0ff0f9425da9`). The complete
98-row ordered digest ledger is in the JSON receipt, not this summary.

| Catalog scope                  | Same-checkpoint observation                                                                                                                               | Source reconciliation consequence                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration ledger               | 98 versions, 1,043 statements; last `20260906024459`                                                                                                      | No new production migration or history repair observed.                                                                                                  |
| Server-only policies           | 16 permissive false-deny policies; zero of 16 required restrictive false-deny policies                                                                    | Source P requires restrictive policies. This is a real policy-mode difference.                                                                           |
| Trigger routines               | Seven present with bindings and client EXECUTE denial; seven candidate search-path mismatches, six historical matches                                     | Inspect all full function definitions and the subsequent family-member writer.                                                                           |
| Function defaults              | One global PUBLIC EXECUTE default; no schema-local function client default                                                                                | Source P revokes global PUBLIC EXECUTE; schema-local revocation alone cannot cancel the global default.                                                  |
| Public table/sequence defaults | Eight effective public-schema table and four sequence client grants; zero global table/sequence client grants                                             | Source P removes public-schema client defaults.                                                                                                          |
| Client table/column grants     | Zero violations for the scoped server-only tables; zero connector matrix mismatches and client column-grant findings                                      | Final aggregate matches do not establish historical identity or every policy/column dependency.                                                          |
| Policy/helper metadata         | 209 public policies, policy digest `85ee85d9eb297f7e67fbaaa39a5e8544a3470f4bb5c09df2fb160347b5173c81`; three scoped helper definitions captured by digest | Lexical direct-auth count zero is only an index. Compare every policy and helper with an isolated source-state capture and run synthetic behavior tests. |

The first September 23 comparison used separate checkpoints and its original
privilege query changed after review; see
[`privilege-live-comparison-20260923.md`](privilege-live-comparison-20260923.md).
This capture fixes the **same-live-checkpoint** issue for those bounded
aggregates, but it is not a complete object-by-object source-versus-remote
snapshot. The current live privilege and search-path differences actively
prevent claiming equality with the proposed source checkpoint. All seven
privilege mappings, and all 19 structural mappings overall, remain
`requires_schema_proof`. No proof-v2 artifact is accepted, no canonical
history decision is approved, and no production mutation was performed.
