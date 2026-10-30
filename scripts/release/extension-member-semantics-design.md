# Extension-member comparison candidate

This is a local design and inventory prototype. No production query, native
PG17 execution, customer-data restore, publication or workflow dispatch has
occurred. The SQL deliberately reports `qualificationReady=false`,
`semanticEqualityProven=false`, and the number of unimplemented payloads.
Matching its inventory hashes does **not** establish that a function body,
ACL, expression, type, relation or other extension member is unchanged.

## Ready-to-review read-only preflight

Run `extension-member-semantics-preflight.sql` only through a separately
reviewed metadata reader, with the existing exact source/image pins, an
explicit `REPEATABLE READ READ ONLY` transaction, `search_path=pg_catalog`,
bounded statement/connection/outer timeouts, and no application-table reads.
The source credential stays in that reader. It never enters the restore
client. Run the identical query against both fresh image baselines.

The query provides complete machine addresses for direct extension members,
recursive internal dependants, and attached columns, indexes, defaults,
constraints, triggers, policies and rules. It round-trips supported addresses
through `pg_get_object_address`. It hashes full identities and dependency
edges rather than names or catalog OIDs. It separately reports unsupported
inverse-address types, opaque trees, generated TOAST identities and companion
catalog rows requiring adapters. It returns only fixed catalog/type labels,
counts and aggregate digests; bodies, ACLs, names, literals and settings are
never returned.

Any SQL error, unknown catalog/type, unresolved identity, unsupported field,
missing coverage, version mismatch, or changed source snapshot is a failed
qualification. An operational reader must map errors to fixed codes and must
not upload driver exceptions containing source SQL or parameters.

## Exact comparison design

Each object key must be the complete `pg_identify_object_as_address` tuple
`(type, object_names[], object_args[])`, plus extension identity and attachment
kind. Require local inverse resolution to the original `(classid,objid,objsubid)`;
require equal key sets, unique keys, and counts across source and both baselines.
Use the same canonical serialization in all three environments.

For every catalog field, a PG17.6-specific manifest must assign exactly one
adapter. Validate the actual `pg_attribute` layout and
`pg_get_catalog_foreign_keys()` metadata against that manifest. A new or
unclassified field fails; it is not removed from a JSON row.

- Own OIDs become the full object key. Ordinary reference OIDs and ordered
  OID arrays/vectors become full referenced object keys, retaining null,
  optional-zero, order, dimensions and multiplicity distinctions.
- Polymorphic references, such as `pg_depend`/`pg_shdepend`, use the associated
  catalog and subobject field. Include dependency type and all shared role,
  owner, ACL and tablespace dependency semantics.
- Scalar fields, `prosrc`, `probin`, configuration arrays, dictionary options,
  comments and security labels retain exact bytes/types and null distinctions.
  Do not rewrite numbers inside SQL bodies or other strings as if they were
  OIDs. Qualified overload/type identities must stay complete.
- ACLs retain null versus explicit empty, and every grantor, grantee, privilege
  and grant-option tuple. Resolve role identities; sort a multiset without
  losing duplicates. Include `pg_init_privs` independently.
- Runtime storage locators, transaction-age counters and optimizer statistics
  require an explicit nonsemantic exclusion policy, separately recorded in the
  receipt. A field is never excluded merely because its value differs. Schema
  options, ownership, security/RLS flags, replica identity and access methods
  remain semantic. No row-derived `pg_statistic` data is needed.
- SQL deparsers may provide an additional diagnostic digest. They are not
  substitutes for typed catalog coverage. Avoid invoking unverified extension
  output/typmod functions while canonicalizing source metadata.

## Catalog coverage required before a real comparison

| Object family                    | Required main and companion catalogs                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routines and aggregates          | `pg_proc`, `pg_aggregate`; all argument/result/support/transition/final/combine/serialization function and type references, role/language, flags, cost/rows/config/body                                                                          |
| Types                            | `pg_type`, `pg_enum`, `pg_range`; I/O, receive/send, analyze, subscript, base/element/array/composite, collation, owner, constraints and defaults                                                                                                |
| Relations                        | `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_index`, `pg_constraint`, `pg_inherits`, `pg_partitioned_table`, `pg_sequence`, `pg_rewrite`, `pg_trigger`, `pg_policy`; complete attached surface including additions outside extension membership |
| Operators and access methods     | `pg_operator`, `pg_am`, `pg_opfamily`, `pg_opclass`, every associated `pg_amop`/`pg_amproc` row; ordered operand/result/key types and all implementation/support references                                                                      |
| Casts and transforms             | `pg_cast`, `pg_transform`; types/language/functions and cast context/method                                                                                                                                                                      |
| Text search                      | `pg_ts_config`, `pg_ts_config_map`, `pg_ts_dict`, `pg_ts_parser`, `pg_ts_template`; token sequence/order, referenced dictionaries/templates/functions and exact options                                                                          |
| Languages/conversions/collations | `pg_language`, `pg_conversion`, `pg_collation`; handlers/validators, encodings, provider/determinism/locale/version and ACLs                                                                                                                     |
| Common object metadata           | `pg_namespace`, `pg_depend`, `pg_shdepend`, `pg_description`, `pg_seclabel`, `pg_init_privs`; complete owner/privilege/extension/dependency semantics                                                                                            |
| Optional or new object families  | Any foreign-data, event-trigger, publication/subscription, statistics-object, transform or other class absent from the approved manifest is explicitly unsupported until its adapter is reviewed                                                 |

The preflight currently inventories addressable families and reports companion
counts; **no payload adapter in this table is implemented yet**. It must not be
used to waive the source-vs-image semantic gate.

## Explicit hard cases and blockers

1. `pg_node_tree`: `proargdefaults`, `prosqlbody`, `typdefaultbin`, `relpartbound`,
   `adbin`, `conbin`, `tgqual`, policy quals, rule actions/quals, index
   expressions/predicates and partition expressions require a typed parser of
   the exact PG17.6 node representation. Every embedded reference must carry
   its correct object class. Typed constants must preserve bytes and collation;
   an OID-typed constant needs semantic resolution, not numeric deletion.
   Unknown node tags/fields/types fail. Deparsing alone can discard details.
2. `pg_attribute.attmissingval` can contain typed values and invoke extension
   output functions during generic JSON/text conversion. A reviewed typed
   value adapter is required; generic `to_jsonb` is insufficient.
3. TOAST relation/index names can embed instance OIDs and some machine
   identities have no inverse SQL address. A physical-object adapter must bind
   them to their unique owning relation and structural role, prove uniqueness
   and preserve all relevant structure. Blindly stripping numeric name suffixes
   is unsafe. The prototype exposes them as unsupported.
4. No-OID companion rows need complete parent/composite keys. OID changes in
   aggregate/range/enum/index/attribute/TS-map/opfamily-map rows must not cause
   rows or semantic references to disappear.
5. Extension configuration-table data, sequence positions, role passwords and
   customer rows are outside this metadata comparison. They still require the
   independent encrypted capture and complete restore/content verification.
6. C/shared-library behavior is not established by SQL catalog equivalence.
   Final trusted-image/library digests and version/runtime compatibility remain
   independent requirements. Matching `probin` paths alone proves no code hash.

## Privacy and receipts

Keep any future canonical private payload in a new owned `0700` workspace and
`0600` files or bounded private pipes, never command arguments, public logs or
artifacts. Compare within the authorized runner and erase after comparison.
Use a per-run random private HMAC key if comparison digests might expose
guessable private values. Upload only coarse fixed class counts, full-coverage
flags, final match/fail codes, pinned source/image/query/tool hashes and opaque
aggregate keyed digests. Do not upload per-object hashes or the HMAC key.

The current SQL digest output is an inventory preflight, not a private-payload
HMAC implementation. Root must review its exact recipient/receipt handling
before a live metadata workflow incorporates it.

## Synthetic evidence and next operation

The candidate tests use embedded PostgreSQL 18.3, report that actual version,
and never imply native PG17 proof. They establish that shifted routine OIDs
produce matching inventory/dependency digests, added members change digests,
and a changed function body can leave inventory unchanged while all semantic
readiness flags remain false. Parsed SQL bodies, member-table defaults,
policies and generated TOAST surfaces are counted without returning literals.

The next useful live operation is this bounded read-only coverage preflight in
the reviewed source metadata reader and the two pinned-image instances. Its
counts identify the concrete PG17 adapter work; no successful inventory or
passing test can authorize decryption, migration, adoption or cutover.

Primary references: PostgreSQL 17
[object addressing functions](https://www.postgresql.org/docs/17/functions-info.html),
[catalog overview](https://www.postgresql.org/docs/17/catalogs-overview.html),
[extension dependencies](https://www.postgresql.org/docs/17/catalog-pg-depend.html),
and [catalog declarations](https://www.postgresql.org/docs/17/bki.html).
