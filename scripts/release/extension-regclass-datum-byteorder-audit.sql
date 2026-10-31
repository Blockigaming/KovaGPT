-- READONLY: no OIDs, constant bytes/values, names, DDL or rows returned.
-- Require exactly pure nextval(regclass CONST), one authoritative normal
-- dependency on a sequence, and a nonambiguous full Datum byte-order match.
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
  nextval_candidates AS (
    SELECT a.oid,a.adbin::text AS tree,m
    FROM scope s JOIN pg_catalog.pg_attrdef a ON s.classid='pg_catalog.pg_attrdef'::regclass AND a.oid=s.objid,
    LATERAL regexp_matches(a.adbin::text,
      '^\{FUNCEXPR :funcid ([0-9]+) :funcresulttype [0-9]+ :funcretset false :funcvariadic false :funcformat [0-9]+ :funccollid 0 :inputcollid 0 :args \(\{CONST :consttype ([0-9]+) :consttypmod -1 :constcollid 0 :constlen 4 :constbyval true :constisnull false :location -?[0-9]+ :constvalue 4 \[ ((?:-?[0-9]+[[:space:]]*)+)\]\}\) :location -?[0-9]+\}$') m
    WHERE m[1]::oid='pg_catalog.nextval(regclass)'::regprocedure
      AND m[2]::oid='pg_catalog.regclass'::regtype
  ),
  sequence_links AS (
    SELECT c.oid,c.m,min(d.refobjid::bigint)::numeric AS sequence_oid
    FROM nextval_candidates c JOIN pg_catalog.pg_depend d
      ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=c.oid AND d.objsubid=0
      AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjsubid=0 AND d.deptype='n'
    JOIN pg_catalog.pg_class sequence ON sequence.oid=d.refobjid AND sequence.relkind='S'
    GROUP BY c.oid,c.m HAVING count(DISTINCT d.refobjid)=1
  ),
  byte_arrays AS (
    SELECT sequence_oid,regexp_split_to_array(trim(m[3]),'[[:space:]]+') AS bytes FROM sequence_links
  ),
  words AS (
    SELECT sequence_oid,array_length(bytes,1) AS width,
      CASE WHEN array_length(bytes,1) IN (4,8) AND NOT EXISTS(
        SELECT 1 FROM unnest(bytes) b WHERE b::integer NOT BETWEEN -128 AND 255)
      THEN (SELECT sum((b::integer & 255)::numeric * power(256::numeric,i-1))
        FROM unnest(bytes) WITH ORDINALITY x(b,i)) ELSE NULL END AS little,
      CASE WHEN array_length(bytes,1) IN (4,8) AND NOT EXISTS(
        SELECT 1 FROM unnest(bytes) b WHERE b::integer NOT BETWEEN -128 AND 255)
      THEN (SELECT sum((b::integer & 255)::numeric * power(256::numeric,array_length(bytes,1)-i))
        FROM unnest(bytes) WITH ORDINALITY x(b,i)) ELSE NULL END AS big
    FROM byte_arrays
  ),
  proofs AS (
    SELECT width,little=sequence_oid AS little_ok,big=sequence_oid AS big_ok
    FROM words WHERE little IS NOT NULL AND big IS NOT NULL
  )
SELECT jsonb_build_object(
  'operation','extension-nextval-regclass-datum-byteorder-audit','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'customerRowsRead',false,'constantValuesReturned',false,'rawDdlReturned',false,
  'productionMutated',false,'qualificationReady',false,
  'pureNextvalCandidateCount',(SELECT count(*) FROM nextval_candidates),
  'uniqueAuthoritativeSequenceLinkCount',(SELECT count(*) FROM sequence_links),
  'validDatumCount',(SELECT count(*) FROM proofs),
  'nonAmbiguousCaseCount',(SELECT count(*) FROM proofs WHERE little_ok<>big_ok),
  'allObservedDatumsEightBytes',(SELECT count(*)>0 AND coalesce(bool_and(width=8),false) FROM proofs),
  'littleEndianEveryCaseMatches',(SELECT coalesce(bool_and(little_ok),false) FROM proofs),
  'bigEndianEveryCaseMatches',(SELECT coalesce(bool_and(big_ok),false) FROM proofs),
  'nonAmbiguousLittleEndianProven',(SELECT count(*) FILTER (WHERE little_ok<>big_ok)>0 AND coalesce(bool_and(little_ok),false) FROM proofs),
  'nonAmbiguousBigEndianProven',(SELECT count(*) FILTER (WHERE little_ok<>big_ok)>0 AND coalesce(bool_and(big_ok),false) FROM proofs),
  'eightByteLittleEndianProven',(SELECT count(*)=(SELECT count(*) FROM nextval_candidates) AND count(*)>0
    AND count(*) FILTER (WHERE little_ok<>big_ok)>0 AND coalesce(bool_and(width=8 AND little_ok),false) FROM proofs),
  'eightByteBigEndianProven',(SELECT count(*)=(SELECT count(*) FROM nextval_candidates) AND count(*)>0
    AND count(*) FILTER (WHERE little_ok<>big_ok)>0 AND coalesce(bool_and(width=8 AND big_ok),false) FROM proofs)
)::text;
COMMIT;
