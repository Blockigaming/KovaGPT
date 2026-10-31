# Private routine/type payload codecs

This candidate supplies PostgreSQL17.6 field adapters for `pg_proc`, `pg_type`,
`pg_aggregate`, `pg_enum` and `pg_range`. These are complete field manifests for
those catalogs, including declared type, nullability, array dimensionality and
catalog foreign-key metadata. They do not cover other extension member classes
or relation/description/initial-privilege surfaces. Every receipt therefore
retains `qualificationReady=false` and `wholeExtensionSurfaceCovered=false`.
No native PG17 qualification, source query or restore has been executed by the
adapter implementation.

The public manifests come from PostgreSQL17.6 catalog definitions. A private
reader must validate the actual full column set and foreign-key metadata against
them. Unknown, missing, changed or newly added fields fail; a Python caller's
boolean cannot substitute for that comparison. The primitive scalar wire uses
the corresponding native send function, preserving exact bytes and nulls.
Float4 values retain their binary bits. Bodies, binary symbols, text defaults,
aggregate initial values and every configuration-array element remain literal
bytes; numeric substrings are never guessed to be OID references.

The shared core also accepts separately reviewed exact catalog manifests,
compound foreign-key metadata, custom field codecs and primary-identity
selectors for the remaining catalog families. These are local source-code
constants/callables, never a manifest or executable selector supplied by private
source rows. Primitive codecs cannot be replaced by custom callbacks. Derived
identity validators may recurse through complete normal/derived owner keys but
still require the reader's native unique-backlink/inverse proof. Signed system
column subobject numbers are allowed only for verified `pg_class` attributes
`-6..-1`; other negative subobject addresses reject.

The only value exclusions built into this core are the six exact reviewed
`pg_class` storage/statistics fields named in `PHYSICAL_REASONS`. The reader
still captures and validates their complete typed raw wire. The semantic
payload records the fixed field/type/reason instead of comparing a cluster-local
storage identifier, estimate or transaction horizon across fresh clusters. An
arbitrary field, alternate reason or primitive-override callback cannot obtain
this exclusion. An unsupported nullable type is accepted only when its actual
value is SQL null; a nonnull value fails rather than being silently omitted.

Every declared reference uses a complete machine object address with native
inverse resolution to the original class/OID/subobject. `VerifiedResolver`
accepts only the private reader's explicit identity/roundtrip proof. Optional
zero references, SQL null, ordered arrays, dimensionality, lower bounds and
multiplicity remain distinct. ACLs retain null/empty distinctions, bounds,
ordered items, exact textual bytes and complete grantor/grantee/privilege/grant
option entries. Each nonnull ACL item must round-trip through PostgreSQL text
input/output with native equality, so unsupported/lost privilege bits fail.

PostgreSQL does not expose an enum-label inverse address API. Enum row identity
uses the full parent type identity plus exact UTF8 label bytes, with a native
unique `(enumtypid,enumlabel)` inverse checked by the reader. The Python adapter
also checks that this identity agrees with the row's type and label fields.

Opaque defaults and SQL bodies require the strict separate PG17 node parser.
The adapter forwards the verified resolver, complete type layouts and reviewed
Datum ABI evidence (byte order,8-byte Datum,UTF8 encoding and bound evidence
hash). Unknown tags, fields, types or typed constants fail. A raw
node hash is only a source binding; it cannot substitute for OID-aware parsing
or establish cross-server equality.

## Two separate hash namespaces

`extension-routine-type-payload-hashes.sql` is the connector-safe diagnostic.
Its server-side payloads and node bindings return only aggregate digests,
counts and public catalog/field keys. No raw object identities, ACLs, source,
configuration or AST values leave PostgreSQL. Its nonopaque SQL hashes are
compared only against the identical SQL codec in the other environment. Raw
opaque bindings remain explicitly noncanonical, and the diagnostic never
qualifies a backup or restore.

`extension-routine-type-payloads.py` consumes a private typed wire inside the
approved private reader/client and hashes the complete normalized payload,
including strictly parsed nodes. Its Python hash format is separately named
`pg17.6-routine-type-payload-v1`; it is compared only to the identical Python
codec. SQL diagnostic hashes and Python canonical hashes are not interchangeable.
Only `hash_rows`' fixed catalog/count/hash receipt may leave that private caller.
The intermediate return from `canonicalize_row` contains private payload and
must never be printed, logged or uploaded in plaintext.

## Private wire contract

Each row has exactly `{catalog,extensionOid,values}`. Values must contain the
exact full catalog field set. Scalar cells are `{isNull,bytesHex}`. Reference
and self fields are raw native OID integers inside this private wire only.
Arrays are SQL null or `{dimensions:[{lower,length}],items:[...]}`, with scalar
cells or reference integers as appropriate. ACL items are null or
`{textHex,roundtrip,entries:[{grantor,grantee,privilege,isGrantable}]}`. Node fields
are SQL null or exact node text. No body or setting is redacted or rewritten and
then claimed equal.

Private-wire SQL is only for the separately reviewed GitHub capture process,
never the source connector. It must refuse raw projection unless the actual
transaction is read-only/repeatable-read, PG170006/UTF8/search_path match, and
the explicit private-capture mode is present. Keep wire files owned0700/0600 in
the approved private capture workspace and place them inside the authenticated
encrypted envelope, or canonicalize them before the exporter closes. No raw
wire, node, source, key or diagnostic is an Actions artifact.

Both public diagnostic and private wire expose a hash of the actual MVCC
snapshot. The final source proof must execute through the existing capture
exporter's open transaction, retain its exact exported snapshot binding and
be authenticated by the capture envelope/manifest. A later read-only catalog
query, even with matching scalar hashes, cannot qualify an earlier capture.
Single-statement body mode allows the capture owner to call the query through
that existing `Snapshot.query` without opening/committing another transaction.

The ordinary-reference map does not claim to cover references embedded in raw
ASTs. Resolve and capture every additional typed reference/type layout while
that same exporter remains alive. Later isolated normalization can use the
authenticated complete private cache; it must fail rather than reach back to
production or guess an identity from an OID. Role identities/flags come through
the existing safe `pg_roles`/address APIs; never select role passwords, read
`pg_authid` rows or access server OS files for this feature.
