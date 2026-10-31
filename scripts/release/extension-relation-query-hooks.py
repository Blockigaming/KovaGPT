#!/usr/bin/env python3
"""Reviewed-local metadata SQL hooks; never accept SQL from source values.

The builder's private gate/snapshot checks and exact query hash still apply.
Only native catalogs are read. Generated TOAST names are normalized only after
unique ownership, expected physical name and native parent inverse proof.
"""
import re


def checked_alias(value):
    if not isinstance(value,str) or not re.fullmatch(r"[a-z][a-z0-9_]*",value):
        raise ValueError("relation_query_alias_unqualified")
    return value


STRUCTURAL_CTES=r"""requested_relations AS MATERIALIZED (
  SELECT DISTINCT objid AS oid FROM raw_addresses WHERE classid='pg_catalog.pg_class'::regclass AND objid<>0
), relation_interest AS MATERIALIZED (
  SELECT oid FROM requested_relations
  UNION SELECT i.indrelid FROM pg_catalog.pg_index i JOIN requested_relations r ON i.indexrelid=r.oid
  UNION SELECT p.oid FROM pg_catalog.pg_class p WHERE p.reltoastrelid IN (
    SELECT oid FROM requested_relations
    UNION SELECT i.indrelid FROM pg_catalog.pg_index i JOIN requested_relations r ON i.indexrelid=r.oid)
), native_relation_names AS MATERIALIZED (
  SELECT c.oid,c.relkind,n.nspname,c.relname,
    to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_class'::regclass,c.oid,0)) AS identity
  FROM relation_interest wanted JOIN pg_catalog.pg_class c ON c.oid=wanted.oid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
), native_relation_inverses AS MATERIALIZED (
  SELECT r.*,CASE WHEN identity->>'type' IN ('table','index','view','materialized view','sequence','foreign table')
    THEN to_jsonb(pg_catalog.pg_get_object_address(identity->>'type',
      ARRAY(SELECT jsonb_array_elements_text(identity->'object_names')),
      ARRAY(SELECT jsonb_array_elements_text(identity->'object_args')))) ELSE NULL END AS inverse
  FROM native_relation_names r
), ordinary_relation_proofs AS MATERIALIZED (
  SELECT r.*,coalesce(inverse=jsonb_build_object('classid','pg_catalog.pg_class'::regclass::oid,
    'objid',r.oid,'objsubid',0),false) AS proven
  FROM native_relation_inverses r
), owned_toast_tables AS MATERIALIZED (
  SELECT toast.oid,jsonb_build_object('derived','owned-toast-relation','owner',owner.identity,'kind','table') AS identity,
    owner.proven AS proven
  FROM pg_catalog.pg_class parent JOIN ordinary_relation_proofs owner ON owner.oid=parent.oid
  JOIN pg_catalog.pg_class toast ON toast.oid=parent.reltoastrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=toast.relnamespace
  WHERE parent.relkind IN ('r','m') AND toast.relkind='t' AND n.nspname='pg_toast'
    AND toast.relname='pg_toast_'||parent.oid::text
    AND (SELECT count(*) FROM pg_catalog.pg_class p WHERE p.reltoastrelid=toast.oid)=1
), owned_toast_indexes AS MATERIALIZED (
  SELECT idx.oid,jsonb_build_object('derived','owned-toast-relation','owner',toast.identity->'owner','kind','index') AS identity,
    toast.proven AS proven
  FROM owned_toast_tables toast JOIN pg_catalog.pg_class t ON t.oid=toast.oid
  JOIN pg_catalog.pg_index i ON i.indrelid=toast.oid
  JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
  WHERE idx.relkind='i' AND idx.relnamespace=t.relnamespace AND idx.relname=t.relname||'_index'
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND (SELECT count(*) FROM pg_catalog.pg_index other WHERE other.indrelid=toast.oid)=1
), composite_relation_types AS MATERIALIZED (
  SELECT c.oid,t.oid AS typeoid,
    to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,t.oid,0)) AS type_identity
  FROM relation_interest wanted JOIN pg_catalog.pg_class c ON c.oid=wanted.oid
    JOIN pg_catalog.pg_type t ON t.typrelid=c.oid AND c.reltype=t.oid AND t.typtype='c'
    AND t.typnamespace=c.relnamespace AND t.typname=c.relname
  WHERE c.relkind='c' AND (SELECT count(*) FROM pg_catalog.pg_type other WHERE other.typrelid=c.oid)=1
), composite_relation_proofs AS MATERIALIZED (
  SELECT c.oid,jsonb_build_object('derived','composite-relation','type',c.type_identity) AS identity,
    coalesce(to_jsonb(pg_catalog.pg_get_object_address('type',
      ARRAY(SELECT jsonb_array_elements_text(c.type_identity->'object_names')),
      ARRAY(SELECT jsonb_array_elements_text(c.type_identity->'object_args'))))
      =jsonb_build_object('classid','pg_catalog.pg_type'::regclass::oid,'objid',c.typeoid,'objsubid',0),false) AS proven
  FROM composite_relation_types c WHERE c.type_identity->>'type'='type'
), relation_identity_map AS MATERIALIZED (
  SELECT r.oid,
    CASE WHEN t.oid IS NOT NULL THEN t.identity WHEN i.oid IS NOT NULL THEN i.identity
      WHEN r.nspname='pg_toast' AND r.relkind IN ('t','i') THEN NULL
      WHEN c.oid IS NOT NULL THEN c.identity ELSE r.identity END AS identity,
    CASE WHEN t.oid IS NOT NULL THEN t.proven WHEN i.oid IS NOT NULL THEN i.proven
      WHEN r.nspname='pg_toast' AND r.relkind IN ('t','i') THEN false
      WHEN c.oid IS NOT NULL THEN c.proven ELSE r.proven END AS proven
  FROM ordinary_relation_proofs r LEFT JOIN owned_toast_tables t USING(oid)
    LEFT JOIN owned_toast_indexes i USING(oid) LEFT JOIN composite_relation_proofs c USING(oid)
), column_identity_map AS MATERIALIZED (
  SELECT a.attrelid AS oid,a.attnum::integer AS subid,
    jsonb_build_object('derived','relation-column','relation',r.identity,'number',a.attnum,
      'nameHex',encode(pg_catalog.namesend(a.attname),'hex')) AS identity,
    r.proven AND NOT a.attisdropped AND a.attnum BETWEEN -6 AND 32767 AND a.attnum<>0
      AND octet_length(pg_catalog.namesend(a.attname)) BETWEEN 1 AND 63
      AND (SELECT count(*) FROM pg_catalog.pg_attribute other
        WHERE other.attrelid=a.attrelid AND other.attnum=a.attnum)=1 AS proven
  FROM pg_catalog.pg_attribute a JOIN relation_identity_map r ON r.oid=a.attrelid
  WHERE a.attnum<>0
)"""


def common_ctes(generator):
    return generator.DEFAULT_ALL_COMMON_CTES+",\n"+STRUCTURAL_CTES


def address_identity_sql(alias,ordinary_sql):
    a=checked_alias(alias)
    return ("CASE WHEN "+a+".classid='pg_catalog.pg_class'::regclass THEN CASE WHEN "+a+".objsubid=0 "
        "THEN (SELECT m.identity FROM relation_identity_map m WHERE m.oid="+a+".objid) "
        "ELSE (SELECT m.identity FROM column_identity_map m WHERE m.oid="+a+".objid AND m.subid="+a+".objsubid) END "
        "ELSE "+ordinary_sql+" END")


def address_roundtrip_sql(alias,ordinary_sql):
    a=checked_alias(alias)
    return ("CASE WHEN "+a+".classid='pg_catalog.pg_class'::regclass THEN CASE WHEN "+a+".objsubid=0 "
        "THEN (SELECT m.proven FROM relation_identity_map m WHERE m.oid="+a+".objid) "
        "ELSE (SELECT m.proven FROM column_identity_map m WHERE m.oid="+a+".objid AND m.subid="+a+".objsubid) END "
        "ELSE "+ordinary_sql+" END")


def polymorphic_identity(alias,column,class_field,subid_field):
    a=checked_alias(alias)
    for field in [column,class_field]+([subid_field] if subid_field is not None else []):checked_alias(field)
    subid=a+'."'+subid_field+'"' if subid_field is not None else "0"
    catalog_identity="(SELECT x.identity FROM checked_addresses x WHERE x.classid='pg_catalog.pg_class'::regclass AND x.objid="+a+'."'+class_field+'"::oid AND x.objsubid=0)'
    object_identity=("(SELECT x.identity FROM checked_addresses x WHERE x.classid="+a+'."'+class_field+'"::oid '
        "AND x.objid="+a+'."'+column+'"::oid AND x.objsubid='+subid+")")
    return "jsonb_build_object('kind','polymorphic-reference','catalog',"+catalog_identity+",'object',"+object_identity+")"


def row_identity_sql(catalog,alias,ordinary_identity):
    a=checked_alias(alias)
    if catalog in {"pg_proc","pg_type"}:return ordinary_identity(catalog,a+".oid")
    if catalog=="pg_enum":
        return "jsonb_build_object('derived','enum-label','type',"+ordinary_identity("pg_type",a+".enumtypid")+",'labelHex',encode(pg_catalog.namesend("+a+".enumlabel),'hex'))"
    if catalog=="pg_aggregate":return ordinary_identity("pg_proc",a+".aggfnoid")
    if catalog=="pg_range":return ordinary_identity("pg_type",a+".rngtypid")
    if catalog=="pg_attribute":
        return ("jsonb_build_object('derived','relation-column','relation',"+ordinary_identity("pg_class",a+".attrelid")+
            ",'number',"+a+".attnum,'nameHex',encode(pg_catalog.namesend("+a+".attname),'hex'))")
    parent={"pg_index":"indexrelid","pg_sequence":"seqrelid","pg_partitioned_table":"partrelid"}
    if catalog in parent:return ordinary_identity("pg_class",a+"."+parent[catalog])
    if catalog=="pg_inherits":
        return ("jsonb_build_object('child',"+ordinary_identity("pg_class",a+".inhrelid")+
            ",'parent',"+ordinary_identity("pg_class",a+".inhparent")+",'sequence',"+a+".inhseqno)")
    if catalog in {"pg_description","pg_init_privs","pg_seclabel"}:
        key="jsonb_build_object('object',"+polymorphic_identity(a,"objoid","classoid","objsubid")+",'subid',"+a+".objsubid"
        if catalog=="pg_init_privs":key+=",'privilegeType',encode(pg_catalog.charsend("+a+".privtype),'hex')"
        if catalog=="pg_seclabel":key+=",'provider',encode(pg_catalog.textsend("+a+".provider),'hex')"
        return key+")"
    if catalog in {"pg_depend","pg_shdepend"}:
        key=("jsonb_build_object('dependent',"+polymorphic_identity(a,"objid","classid","objsubid")+
            ",'referenced',"+polymorphic_identity(a,"refobjid","refclassid","refobjsubid" if catalog=="pg_depend" else None)+
            ",'dependencyType',encode(pg_catalog.charsend("+a+".deptype),'hex')")
        if catalog=="pg_shdepend":key+=",'database',CASE WHEN "+a+".dbid=0 THEN jsonb_build_object('catalog','pg_database','state','zero') ELSE jsonb_build_object('catalog','pg_database','state','object','identity',"+ordinary_identity("pg_database",a+".dbid")+") END"
        return key+")"
    return ordinary_identity(catalog,a+".oid")


def query_options(generator,core,relations):
    options=relations.adapter_options(core)
    return {"common_ctes":common_ctes(generator),"catalog_foreign_keys":options["expected_foreign_keys"],
            "identity_sql":row_identity_sql,"address_identity_sql":address_identity_sql,
            "address_roundtrip_sql":address_roundtrip_sql}


def lazy_reference_query(requests,generator,manifests):
    """PRIVATE body for the live exporter's already imported read-only snapshot.

    Only known catalog labels and bounded decimal integers enter SQL. The
    source wrapper must bind these exact bytes and returned snapshot digest;
    do not execute/log this query through a source connector.
    """
    allowed=set(manifests)|{"pg_authid","pg_collation","pg_extension","pg_database","pg_tablespace"}
    if type(requests) not in {list,tuple} or not 0<len(requests)<=2048:
        raise ValueError("relation_lazy_batch_unqualified")
    items=[]
    for request in requests:
        if type(request) not in {list,tuple} or len(request)!=3:
            raise ValueError("relation_lazy_request_unqualified")
        catalog,oid,subid=request
        if (type(catalog) is not str or catalog not in allowed or not re.fullmatch(r"pg_[a-z0-9_]+",catalog)
            or type(oid) is not int or not 0<oid<2**32 or type(subid) is not int
            or not (0<=subid<=2147483647 or catalog=="pg_class" and -6<=subid<=-1)):
            raise ValueError("relation_lazy_request_unqualified")
        items.append("('"+catalog+"','pg_catalog."+catalog+"'::regclass::oid,"+str(oid)+"::oid,"+str(subid)+")")
    if len(set(items))!=len(items):raise ValueError("relation_lazy_duplicate_request")
    ordinary="to_jsonb(pg_catalog.pg_identify_object_as_address(a.classid,a.objid,a.objsubid))"
    enum_identity="""(SELECT jsonb_build_object('derived','enum-label',
      'type',to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,e.enumtypid,0)),
      'labelHex',encode(pg_catalog.namesend(e.enumlabel),'hex')) FROM pg_catalog.pg_enum e WHERE e.oid=a.objid)"""
    normalized="CASE WHEN a.classid='pg_catalog.pg_enum'::regclass THEN "+enum_identity+" ELSE "+address_identity_sql("a",ordinary)+" END"
    inverse_types=",".join("'"+value.replace("'","''")+"'" for value in generator.INVERSE_TYPES)
    ordinary_proof="coalesce(i.inverse=jsonb_build_object('classid',i.classid,'objid',i.objid,'objsubid',i.objsubid),false)"
    enum_proof="""EXISTS(SELECT 1 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
      WHERE e.oid=i.objid AND i.objsubid=0 AND t.typtype='e'
      AND (SELECT count(*) FROM pg_catalog.pg_enum other WHERE other.enumtypid=e.enumtypid AND other.enumlabel=e.enumlabel)=1
      AND to_jsonb(pg_catalog.pg_get_object_address('type',
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'type'->'object_names')),
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'type'->'object_args'))))
        =jsonb_build_object('classid','pg_catalog.pg_type'::regclass::oid,'objid',t.oid,'objsubid',0))"""
    proof="CASE WHEN i.classid='pg_catalog.pg_enum'::regclass THEN "+enum_proof+" ELSE "+address_roundtrip_sql("i",ordinary_proof)+" END"
    sql="""-- PRIVATE_GHA_ONLY lazy identities. No connector/log/plaintext artifact.
WITH RECURSIVE private_wire_gate AS MATERIALIZED (
  SELECT current_setting('kova.private_extension_wire',true)='PRIVATE_GHA_CAPTURE_ONLY'
    AND current_setting('server_version_num')::integer=170006 AND current_setting('server_encoding')='UTF8'
    AND current_setting('transaction_read_only')='on' AND current_setting('transaction_isolation')='repeatable read'
    AND current_setting('search_path')='pg_catalog' AS allowed),
"""+STRUCTURAL_CTES+""",
requests(catalog,classid,objid,objsubid) AS (VALUES """+",".join(items)+"""),
raw_addresses AS (SELECT classid,objid,objsubid FROM requests),
identities AS (SELECT a.*,"""+normalized+""" AS identity FROM requests a WHERE (SELECT allowed FROM private_wire_gate)),
inverse_addresses AS (SELECT i.*,CASE WHEN i.identity->>'type' IN ("""+inverse_types+""")
  THEN to_jsonb(pg_catalog.pg_get_object_address(i.identity->>'type',
    ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_names')),
    ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_args')))) ELSE NULL END AS inverse
  FROM identities i),
checked AS (SELECT i.*,coalesce("""+proof+""",false) AS roundtrip FROM inverse_addresses i)
SELECT CASE WHEN (SELECT allowed FROM private_wire_gate)
  AND (SELECT count(*) FROM checked)=(SELECT count(*) FROM requests)
  AND NOT EXISTS(SELECT 1 FROM checked WHERE identity IS NULL OR NOT roundtrip)
THEN jsonb_build_object('operation','PRIVATE_GHA_ONLY-lazy-extension-identities','format',1,
  'privateRawWire',true,'serverVersionNum',current_setting('server_version_num')::integer,
  'sourceSnapshotSha256',encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'),
  'captureSnapshotBound',false,'querySha256MustBeBoundByPrivateWrapper',true,
  'qualificationReady',false,'customerRowsRead',false,'productionMutated',false,
  'resolvedReferences',(SELECT jsonb_agg(jsonb_build_object('catalog',catalog,'oid',objid::bigint,'subid',objsubid,
    'identity',identity,'roundtrip',roundtrip) ORDER BY catalog,objid,objsubid) FROM checked))
ELSE jsonb_build_object('operation','PRIVATE_GHA_ONLY-lazy-extension-identities','format',1,
  'ok',false,'error','private_lazy_context_or_identity_denied','privateRawWire',false,
  'qualificationReady',false,'customerRowsRead',false,'productionMutated',false) END::text
"""
    return generator.checked_local_sql(sql)
