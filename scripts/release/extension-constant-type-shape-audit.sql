-- Root-reviewed READONLY metadata audit: no bodies, node values, DDL, object
-- names, customer rows, credentials or private field-like strings are returned.
-- Node TAGs are unescaped structural tokens. Field-like tokens are restricted
-- to public PG17.6 header names: this scan is deliberately not claimed to parse
-- fields exactly (a cstring value can itself start with a colon). Unknown keys
-- are counted only. Catalog layout/FK names are PostgreSQL public metadata.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
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
  trees(field,body) AS (
    SELECT 'pg_proc.proargdefaults',p.proargdefaults::text FROM scope s JOIN pg_catalog.pg_proc p ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.proargdefaults IS NOT NULL
    UNION ALL SELECT 'pg_proc.prosqlbody',p.prosqlbody::text FROM scope s JOIN pg_catalog.pg_proc p ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.prosqlbody IS NOT NULL
    UNION ALL SELECT 'pg_type.typdefaultbin',t.typdefaultbin::text FROM scope s JOIN pg_catalog.pg_type t ON s.classid='pg_catalog.pg_type'::regclass AND t.oid=s.objid WHERE t.typdefaultbin IS NOT NULL
    UNION ALL SELECT 'pg_class.relpartbound',c.relpartbound::text FROM relation_scope r JOIN pg_catalog.pg_class c ON c.oid=r.relid WHERE c.relpartbound IS NOT NULL
    UNION ALL SELECT 'pg_attrdef.adbin',a.adbin::text FROM scope s JOIN pg_catalog.pg_attrdef a ON s.classid='pg_catalog.pg_attrdef'::regclass AND a.oid=s.objid WHERE a.adbin IS NOT NULL
    UNION ALL SELECT 'pg_constraint.conbin',c.conbin::text FROM scope s JOIN pg_catalog.pg_constraint c ON s.classid='pg_catalog.pg_constraint'::regclass AND c.oid=s.objid WHERE c.conbin IS NOT NULL
    UNION ALL SELECT 'pg_policy.polqual',p.polqual::text FROM scope s JOIN pg_catalog.pg_policy p ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polqual IS NOT NULL
    UNION ALL SELECT 'pg_policy.polwithcheck',p.polwithcheck::text FROM scope s JOIN pg_catalog.pg_policy p ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polwithcheck IS NOT NULL
    UNION ALL SELECT 'pg_trigger.tgqual',t.tgqual::text FROM scope s JOIN pg_catalog.pg_trigger t ON s.classid='pg_catalog.pg_trigger'::regclass AND t.oid=s.objid WHERE t.tgqual IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_action',w.ev_action::text FROM scope s JOIN pg_catalog.pg_rewrite w ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_action IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_qual',w.ev_qual::text FROM scope s JOIN pg_catalog.pg_rewrite w ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_qual IS NOT NULL
    UNION ALL SELECT 'pg_index.indexprs',i.indexprs::text FROM relation_scope r JOIN pg_catalog.pg_index i ON i.indexrelid=r.relid WHERE i.indexprs IS NOT NULL
    UNION ALL SELECT 'pg_index.indpred',i.indpred::text FROM relation_scope r JOIN pg_catalog.pg_index i ON i.indexrelid=r.relid WHERE i.indpred IS NOT NULL
    UNION ALL SELECT 'pg_partitioned_table.partexprs',p.partexprs::text FROM relation_scope r JOIN pg_catalog.pg_partitioned_table p ON p.partrelid=r.relid WHERE p.partexprs IS NOT NULL
  ),
  direct_types AS (
    SELECT m[1]::oid AS oid,count(*) AS occurrence_count
    FROM trees t,LATERAL regexp_matches(t.body,'\{CONST :consttype ([0-9]+)[[:space:]]','g') m
    GROUP BY m[1]::oid
  ),
  type_scope(oid) AS (
    SELECT oid FROM direct_types
    UNION
    SELECT next.oid FROM type_scope own JOIN pg_catalog.pg_type t ON t.oid=own.oid
    CROSS JOIN LATERAL (VALUES(t.typelem),(t.typbasetype)) next(oid)
    WHERE next.oid<>0
  ),
  layouts AS (
    SELECT t.oid AS source_type_oid,to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,t.oid,0)) AS identity,
      t.typtype AS kind,t.typcategory AS category,t.typlen AS length,t.typbyval AS by_value,
      t.typalign AS alignment,t.typstorage AS storage,t.typelem AS element_type_oid,
      t.typbasetype AS base_type_oid,t.typtypmod AS type_modifier,t.typndims AS dimensions,
      t.typrelid<>0 AS is_composite,t.typdefaultbin IS NOT NULL AS has_parsed_default,
      coalesce(d.occurrence_count,0) AS constant_occurrences
    FROM type_scope s JOIN pg_catalog.pg_type t ON t.oid=s.oid LEFT JOIN direct_types d ON d.oid=t.oid
  )
SELECT jsonb_build_object(
  'operation','extension-constant-type-public-layout-audit','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'customerRowsRead',false,'constantValuesReturned',false,'rawDdlReturned',false,
  'productionMutated',false,'qualificationReady',false,
  'compiledForX86_64',position('x86_64' in version())>0,
  'littleEndianInferredFromArchitectureOnly',position('x86_64' in version())>0,
  'datumEncodingIndependentlyVerified',false,
  'versionTextSha256',encode(sha256(convert_to(version(),'UTF8')),'hex'),
  'typeLayouts',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY identity),'[]'::jsonb) FROM layouts l)
)::text;
COMMIT;
