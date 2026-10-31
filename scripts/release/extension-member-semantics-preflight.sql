-- READ-ONLY PREFLIGHT ONLY. This does not establish extension equivalence.
-- Execute inside the operator's explicit REPEATABLE READ READ ONLY transaction
-- with search_path=pg_catalog and a bounded statement timeout. No table data,
-- function bodies, ACLs, comments, options or object names leave this query.
--
-- Cross-server inventory addresses use PostgreSQL's complete machine-readable
-- object address and are round-tripped locally. Never replace this with bare
-- names, pg_describe_object(), OID cutoffs or regular-expression OID stripping.
-- Ordinary catalog payload adapters and opaque tree adapters are deliberately
-- not implemented here: qualificationReady and semanticEqualityProven remain
-- FALSE even when both inventory hashes match.
WITH RECURSIVE
  extension_owned(extension,classid,objid,objsubid) AS (
    SELECT e.extname::text,d.classid,d.objid,d.objsubid
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjid=e.oid AND d.deptype='e'
    UNION
    SELECT o.extension,d.classid,d.objid,d.objsubid
    FROM pg_catalog.pg_depend d
    JOIN extension_owned o ON d.refclassid=o.classid AND d.refobjid=o.objid
      AND d.refobjsubid=o.objsubid
    WHERE d.deptype='i'
  ),
  relation_scope(extension,relid) AS (
    SELECT extension,objid FROM extension_owned WHERE classid='pg_catalog.pg_class'::regclass
    UNION
    SELECT o.extension,i.indexrelid FROM extension_owned o
    JOIN pg_catalog.pg_index i ON o.classid='pg_catalog.pg_class'::regclass AND i.indrelid=o.objid
  ),
  -- A new column/default/constraint/index/policy/trigger/rule on a member is a
  -- change to that member's surface, even if it is not itself an extension
  -- member. Ordinary application objects merely depending on members are not
  -- pulled into scope by a blanket reverse normal-dependency traversal.
  associated(extension,classid,objid,objsubid) AS (
    SELECT r.extension,'pg_catalog.pg_class'::regclass,r.relid,a.attnum::integer
      FROM relation_scope r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.relid
      WHERE a.attnum>0 AND NOT a.attisdropped
    UNION SELECT r.extension,'pg_catalog.pg_class'::regclass,r.relid,0 FROM relation_scope r
    UNION SELECT r.extension,'pg_catalog.pg_attrdef'::regclass,a.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_attrdef a ON a.adrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_constraint'::regclass,c.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.relid
    UNION SELECT o.extension,'pg_catalog.pg_constraint'::regclass,c.oid,0
      FROM extension_owned o JOIN pg_catalog.pg_constraint c
        ON o.classid='pg_catalog.pg_type'::regclass AND c.contypid=o.objid
    UNION SELECT r.extension,'pg_catalog.pg_trigger'::regclass,t.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_policy'::regclass,p.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_policy p ON p.polrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_rewrite'::regclass,w.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_rewrite w ON w.ev_class=r.relid
  ),
  scope AS (SELECT * FROM extension_owned UNION SELECT * FROM associated),
  addressable_catalogs AS (
    SELECT unnest(ARRAY[
      'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_type'::regclass,
      'pg_catalog.pg_class'::regclass,'pg_catalog.pg_operator'::regclass,
      'pg_catalog.pg_am'::regclass,'pg_catalog.pg_opfamily'::regclass,
      'pg_catalog.pg_opclass'::regclass,'pg_catalog.pg_amop'::regclass,
      'pg_catalog.pg_amproc'::regclass,'pg_catalog.pg_cast'::regclass,
      'pg_catalog.pg_transform'::regclass,'pg_catalog.pg_ts_config'::regclass,
      'pg_catalog.pg_ts_dict'::regclass,'pg_catalog.pg_ts_parser'::regclass,
      'pg_catalog.pg_ts_template'::regclass,'pg_catalog.pg_language'::regclass,
      'pg_catalog.pg_conversion'::regclass,'pg_catalog.pg_collation'::regclass,
      'pg_catalog.pg_namespace'::regclass,'pg_catalog.pg_constraint'::regclass,
      'pg_catalog.pg_trigger'::regclass,'pg_catalog.pg_policy'::regclass,
      'pg_catalog.pg_rewrite'::regclass,'pg_catalog.pg_attrdef'::regclass
    ]::oid[]) AS classid
  ),
  raw_addresses AS (
    SELECT classid,objid,objsubid FROM scope
    UNION
    SELECT d.refclassid,d.refobjid,d.refobjsubid
      FROM pg_catalog.pg_depend d JOIN scope s
        ON d.classid=s.classid AND d.objid=s.objid AND d.objsubid=s.objsubid
  ),
  -- Referenced objects may include roles, extensions, tablespaces and other
  -- built-in object classes. Let PostgreSQL resolve them; any unresolved or
  -- non-roundtrippable address is a hard unsupported result.
  identities AS (
    SELECT a.*,
      CASE WHEN a.objid<>0 THEN
        to_jsonb(pg_catalog.pg_identify_object_as_address(a.classid,a.objid,a.objsubid))
        ELSE NULL END AS identity
    FROM raw_addresses a
  ),
  roundtrips AS (
    SELECT i.*,
      -- Some machine identities (notably generated TOAST/index columns) have
      -- no SQL-address inverse. Keep them visible but unsupported; do not call
      -- the inverse on an unknown type and lose the bounded coverage receipt.
      CASE WHEN i.identity->>'type' IN (
        'aggregate','function','procedure','type','table','table column',
        'index','view','materialized view','sequence','foreign table',
        'foreign table column','table constraint','type constraint',
        'trigger','rule','policy','operator','operator class','operator family',
        'access method','access method operator','access method function',
        'cast','transform','text search configuration','text search dictionary',
        'text search parser','text search template','language','conversion',
        'collation','schema','extension','role','tablespace')
        AND jsonb_typeof(i.identity->'object_names')='array'
        AND jsonb_typeof(i.identity->'object_args')='array'
      THEN to_jsonb(pg_catalog.pg_get_object_address(
        i.identity->>'type',
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_names')),
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_args'))))
      ELSE NULL END AS resolved
    FROM identities i
  ),
  checked_addresses AS (
    SELECT r.*,coalesce(r.resolved=jsonb_build_object(
      'classid',r.classid,'objid',r.objid,'objsubid',r.objsubid),false) AS roundtrip_ok
    FROM roundtrips r
  ),
  member_inventory AS (
    SELECT s.extension,a.identity,a.roundtrip_ok
    FROM scope s JOIN checked_addresses a USING(classid,objid,objsubid)
  ),
  dependency_inventory AS (
    SELECT s.extension,own.identity AS dependent,ref.identity AS referenced,d.deptype::text,
      own.roundtrip_ok AND ref.roundtrip_ok AS roundtrip_ok
    FROM pg_catalog.pg_depend d JOIN scope s
      ON d.classid=s.classid AND d.objid=s.objid AND d.objsubid=s.objsubid
    JOIN checked_addresses own ON own.classid=d.classid AND own.objid=d.objid AND own.objsubid=d.objsubid
    JOIN checked_addresses ref ON ref.classid=d.refclassid AND ref.objid=d.refobjid AND ref.objsubid=d.refobjsubid
  ),
  -- This enumerates every opaque tree column touched by these catalog classes.
  -- Do not substitute a pretty-printed/deparsed definition and call it exact.
  opaque_fields(kind,object_count) AS (
    SELECT 'pg_proc.proargdefaults',count(*) FROM scope s JOIN pg_catalog.pg_proc p
      ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.proargdefaults IS NOT NULL
    UNION ALL SELECT 'pg_proc.prosqlbody',count(*) FROM scope s JOIN pg_catalog.pg_proc p
      ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.prosqlbody IS NOT NULL
    UNION ALL SELECT 'pg_type.typdefaultbin',count(*) FROM scope s JOIN pg_catalog.pg_type t
      ON s.classid='pg_catalog.pg_type'::regclass AND t.oid=s.objid WHERE t.typdefaultbin IS NOT NULL
    UNION ALL SELECT 'pg_class.relpartbound',count(*) FROM relation_scope r JOIN pg_catalog.pg_class c
      ON c.oid=r.relid WHERE c.relpartbound IS NOT NULL
    UNION ALL SELECT 'pg_attrdef.adbin',count(*) FROM scope s JOIN pg_catalog.pg_attrdef a
      ON s.classid='pg_catalog.pg_attrdef'::regclass AND a.oid=s.objid WHERE a.adbin IS NOT NULL
    UNION ALL SELECT 'pg_constraint.conbin',count(*) FROM scope s JOIN pg_catalog.pg_constraint c
      ON s.classid='pg_catalog.pg_constraint'::regclass AND c.oid=s.objid WHERE c.conbin IS NOT NULL
    UNION ALL SELECT 'pg_trigger.tgqual',count(*) FROM scope s JOIN pg_catalog.pg_trigger t
      ON s.classid='pg_catalog.pg_trigger'::regclass AND t.oid=s.objid WHERE t.tgqual IS NOT NULL
    UNION ALL SELECT 'pg_policy.polqual',count(*) FROM scope s JOIN pg_catalog.pg_policy p
      ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polqual IS NOT NULL
    UNION ALL SELECT 'pg_policy.polwithcheck',count(*) FROM scope s JOIN pg_catalog.pg_policy p
      ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polwithcheck IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_action',count(*) FROM scope s JOIN pg_catalog.pg_rewrite w
      ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_action IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_qual',count(*) FROM scope s JOIN pg_catalog.pg_rewrite w
      ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_qual IS NOT NULL
    UNION ALL SELECT 'pg_index.indexprs',count(*) FROM relation_scope r JOIN pg_catalog.pg_index i
      ON i.indexrelid=r.relid WHERE i.indexprs IS NOT NULL
    UNION ALL SELECT 'pg_index.indpred',count(*) FROM relation_scope r JOIN pg_catalog.pg_index i
      ON i.indexrelid=r.relid WHERE i.indpred IS NOT NULL
    UNION ALL SELECT 'pg_partitioned_table.partexprs',count(*) FROM relation_scope r
      JOIN pg_catalog.pg_partitioned_table p ON p.partrelid=r.relid WHERE p.partexprs IS NOT NULL
    UNION ALL SELECT 'pg_attribute.attmissingval',count(*) FROM relation_scope r
      JOIN pg_catalog.pg_attribute a ON a.attrelid=r.relid WHERE a.attmissingval IS NOT NULL
  ),
  class_counts AS (
    SELECT c.relname::text AS catalog,count(*) AS object_count,
      bool_and(s.classid IN (SELECT classid FROM addressable_catalogs)) AS inventoried_class
    FROM scope s JOIN pg_catalog.pg_class c ON c.oid=s.classid GROUP BY c.relname
  ),
  -- These rows carry semantics but are not independent extension addresses.
  -- Their presence is reported, never silently treated as covered by the
  -- parent object's identity. No row-derived pg_statistic/statistic_ext_data
  -- or extension application-table contents are read.
  companion_counts(catalog,object_count) AS (
    SELECT 'pg_attribute',count(*) FROM relation_scope r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.relid
    UNION ALL SELECT 'pg_index',count(*) FROM relation_scope r JOIN pg_catalog.pg_index i ON i.indexrelid=r.relid
    UNION ALL SELECT 'pg_partitioned_table',count(*) FROM relation_scope r JOIN pg_catalog.pg_partitioned_table p ON p.partrelid=r.relid
    UNION ALL SELECT 'pg_sequence',count(*) FROM relation_scope r JOIN pg_catalog.pg_sequence q ON q.seqrelid=r.relid
    UNION ALL SELECT 'pg_inherits',count(*) FROM pg_catalog.pg_inherits i
      WHERE i.inhrelid IN (SELECT relid FROM relation_scope) OR i.inhparent IN (SELECT relid FROM relation_scope)
    UNION ALL SELECT 'pg_aggregate',count(*) FROM scope s JOIN pg_catalog.pg_aggregate a
      ON s.classid='pg_catalog.pg_proc'::regclass AND a.aggfnoid=s.objid
    UNION ALL SELECT 'pg_enum',count(*) FROM scope s JOIN pg_catalog.pg_enum e
      ON s.classid='pg_catalog.pg_type'::regclass AND e.enumtypid=s.objid
    UNION ALL SELECT 'pg_range',count(*) FROM scope s JOIN pg_catalog.pg_range r
      ON s.classid='pg_catalog.pg_type'::regclass AND r.rngtypid=s.objid
    UNION ALL SELECT 'pg_ts_config_map',count(*) FROM scope s JOIN pg_catalog.pg_ts_config_map m
      ON s.classid='pg_catalog.pg_ts_config'::regclass AND m.mapcfg=s.objid
    UNION ALL SELECT 'pg_amop',count(*) FROM scope s JOIN pg_catalog.pg_amop a
      ON s.classid='pg_catalog.pg_opfamily'::regclass AND a.amopfamily=s.objid
    UNION ALL SELECT 'pg_amproc',count(*) FROM scope s JOIN pg_catalog.pg_amproc a
      ON s.classid='pg_catalog.pg_opfamily'::regclass AND a.amprocfamily=s.objid
    UNION ALL SELECT 'pg_foreign_table',count(*) FROM relation_scope r JOIN pg_catalog.pg_foreign_table f ON f.ftrelid=r.relid
    UNION ALL SELECT 'pg_init_privs',count(*) FROM scope s JOIN pg_catalog.pg_init_privs p
      ON p.classoid=s.classid AND p.objoid=s.objid AND p.objsubid=s.objsubid
    UNION ALL SELECT 'pg_description',count(*) FROM scope s JOIN pg_catalog.pg_description d
      ON d.classoid=s.classid AND d.objoid=s.objid AND d.objsubid=s.objsubid
    UNION ALL SELECT 'pg_seclabel',count(*) FROM scope s JOIN pg_catalog.pg_seclabel l
      ON l.classoid=s.classid AND l.objoid=s.objid AND l.objsubid=s.objsubid
    UNION ALL SELECT 'pg_shdepend',count(*) FROM scope s JOIN pg_catalog.pg_shdepend d
      ON d.classid=s.classid AND d.objid=s.objid AND d.objsubid=s.objsubid
      WHERE d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
  ),
  physical_names AS (
    SELECT count(*) AS object_count FROM relation_scope r
      JOIN pg_catalog.pg_class c ON c.oid=r.relid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='t' OR n.nspname='pg_toast'
  )
SELECT jsonb_build_object(
  'operation','extension-member-semantics-coverage-preflight',
  'format',1,'serverVersionNum',current_setting('server_version_num')::integer,
  'requiredServerVersionNum',170006,
  'qualified',false,'qualificationReady',false,'semanticEqualityProven',false,
  'catalogPayloadAdaptersImplemented',false,'deparsedDdlTreatedAsExact',false,
  'customerRowsRead',false,'rawMetadataReturned',false,'productionMutated',false,
  'memberInventorySha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(
    jsonb_build_object('extension',extension,'identity',identity) ORDER BY extension,identity),'[]'::jsonb)::text,'UTF8')),'hex') FROM member_inventory),
  'dependencyInventorySha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(
    jsonb_build_object('extension',extension,'dependent',dependent,'referenced',referenced,'type',deptype)
    ORDER BY extension,dependent,referenced,deptype),'[]'::jsonb)::text,'UTF8')),'hex') FROM dependency_inventory),
  'counts',jsonb_build_object(
    'scopedObjects',(SELECT count(*) FROM scope),
    'dependencyEdges',(SELECT count(*) FROM dependency_inventory),
    'unresolvedOrNonRoundtrippableAddresses',(SELECT count(*) FROM checked_addresses WHERE NOT roundtrip_ok),
    'unsupportedInventoryClasses',(SELECT count(*) FROM class_counts WHERE NOT inventoried_class),
    'unimplementedPayloadObjects',(SELECT count(*) FROM scope),
    'opaqueFieldOccurrences',(SELECT coalesce(sum(object_count),0) FROM opaque_fields),
    'unstablePhysicalNames',(SELECT object_count FROM physical_names)),
  'classCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('catalog',catalog,'count',object_count,
    'inventorySupported',inventoried_class) ORDER BY catalog),'[]'::jsonb) FROM class_counts),
  'opaqueFieldCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('field',kind,'count',object_count)
    ORDER BY kind),'[]'::jsonb) FROM opaque_fields WHERE object_count>0),
  'companionCatalogCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('catalog',catalog,'count',object_count,
    'payloadImplemented',false) ORDER BY catalog),'[]'::jsonb) FROM companion_counts WHERE object_count>0),
  'nonRoundtrippableTypeCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',kind,'count',object_count)
    ORDER BY kind),'[]'::jsonb) FROM (
      SELECT coalesce(identity->>'type','unresolved') AS kind,count(*) AS object_count
      FROM checked_addresses WHERE NOT roundtrip_ok GROUP BY identity->>'type') unsupported)
)::text;
