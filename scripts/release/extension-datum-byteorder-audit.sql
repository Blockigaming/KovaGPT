-- READONLY aggregate: no constant values, names, DDL or bytes are returned.
-- A positive proof needs at least one non-ambiguous complete single built-in
-- integer CONST. Zero candidates/32-bit Datums never become platform evidence.
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
  candidates(tree) AS (
    SELECT p.proargdefaults FROM scope s JOIN pg_catalog.pg_proc p
      ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid
      WHERE p.pronargdefaults=1 AND p.proargdefaults IS NOT NULL
    UNION ALL SELECT a.adbin FROM scope s JOIN pg_catalog.pg_attrdef a
      ON s.classid='pg_catalog.pg_attrdef'::regclass AND a.oid=s.objid
  ),
  shaped AS (
    SELECT tree,m FROM candidates,LATERAL regexp_matches(tree::text,
      '^\(?\{CONST :consttype ([0-9]+) :consttypmod -?[0-9]+ :constcollid 0 :constlen ([248]) :constbyval true :constisnull false :location -?[0-9]+ :constvalue [248] \[ ([^][]*) \]\}\)?$') m
  ),
  safe_types AS MATERIALIZED (
    SELECT s.* FROM shaped s JOIN pg_catalog.pg_type t ON t.oid=s.m[1]::oid
      JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='pg_catalog' AND t.typname IN ('int2','int4','int8')
      AND t.typtype='b' AND t.typbyval AND t.typlen=s.m[2]::integer
  ),
  decoded AS (
    -- The deparser is called only on a complete single integer CONST whose
    -- type is a built-in integer. No extension output function or SQL executes.
    SELECT m,pg_catalog.pg_get_expr(tree,0,false) AS value_text FROM safe_types
  ),
  values_internal AS (
    SELECT m,
      CASE WHEN value_text ~ '^\(?-?[0-9]+\)?$'
        THEN trim(both '()' from value_text)::numeric
        WHEN value_text ~ '^''-?[0-9]+''::(smallint|integer|bigint)$'
        THEN split_part(value_text,'''',2)::numeric
        ELSE NULL END AS expected,
      regexp_split_to_array(trim(m[3]),'[[:space:]]+') AS bytes
    FROM decoded
  ),
  words AS (
    SELECT expected,
      CASE WHEN array_length(bytes,1)=8 AND NOT EXISTS(
        SELECT 1 FROM unnest(bytes) b WHERE b !~ '^-?[0-9]+$' OR b::integer NOT BETWEEN -128 AND 255)
      THEN (SELECT sum((b::integer & 255)::numeric * power(256::numeric,i-1))
        FROM unnest(bytes) WITH ORDINALITY x(b,i)) ELSE NULL END AS little,
      CASE WHEN array_length(bytes,1)=8 AND NOT EXISTS(
        SELECT 1 FROM unnest(bytes) b WHERE b !~ '^-?[0-9]+$' OR b::integer NOT BETWEEN -128 AND 255)
      THEN (SELECT sum((b::integer & 255)::numeric * power(256::numeric,8-i))
        FROM unnest(bytes) WITH ORDINALITY x(b,i)) ELSE NULL END AS big
    FROM values_internal
  ),
  matches AS (
    SELECT *,CASE WHEN expected<0 THEN expected+18446744073709551616::numeric ELSE expected END AS expected_unsigned
    FROM words
  ),
  proofs AS (
    SELECT little=expected_unsigned AS little_ok,big=expected_unsigned AS big_ok
    FROM matches WHERE expected IS NOT NULL AND little IS NOT NULL AND big IS NOT NULL
  )
SELECT jsonb_build_object(
  'operation','extension-single-integer-constant-datum-byteorder-audit','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'customerRowsRead',false,'constantValuesReturned',false,'rawDdlReturned',false,
  'productionMutated',false,'qualificationReady',false,
  'candidateCount',(SELECT count(*) FROM candidates),
  'pureIntegerShapeCount',(SELECT count(*) FROM safe_types),
  'validEightByteDatumCount',(SELECT count(*) FROM proofs),
  'nonAmbiguousCaseCount',(SELECT count(*) FROM proofs WHERE little_ok<>big_ok),
  'littleEndianEveryCaseMatches',(SELECT coalesce(bool_and(little_ok),false) FROM proofs),
  'bigEndianEveryCaseMatches',(SELECT coalesce(bool_and(big_ok),false) FROM proofs),
  'nonAmbiguousLittleEndianProven',(SELECT count(*)>0 AND coalesce(bool_and(little_ok),false)
    FROM proofs WHERE little_ok<>big_ok),
  'nonAmbiguousBigEndianProven',(SELECT count(*)>0 AND coalesce(bool_and(big_ok),false)
    FROM proofs WHERE little_ok<>big_ok)
)::text;
COMMIT;
