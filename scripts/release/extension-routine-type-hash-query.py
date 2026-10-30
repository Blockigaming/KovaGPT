#!/usr/bin/env python3
"""Generate read-only PG17.6 catalog payload queries.

The public build_query() returns hashes/counts only: object identities, source/
configuration bytes, ACL values and raw node text remain inside PostgreSQL.
The separate build_private_wire_query() API is exclusively for the approved
private GHA capture and must never be used through a source connector or log.
Opaque hashes are raw bindings, never normalized proof. This generator neither
connects to a database nor performs any SQL operation.
"""
import argparse
import importlib.util
import inspect
import json
from pathlib import Path
import re

CATALOGS=("pg_proc","pg_type","pg_aggregate","pg_enum","pg_range")
SEND={"name":"namesend","text":"textsend","bool":"boolsend","char":"charsend",
      "int2":"int2send","int4":"int4send","float4":"float4send",
      "int8":"int8send","float8":"float8send","xid":"xidsend","cid":"cidsend","pg_lsn":"pg_lsn_send",
      "oid":"oidsend","bytea":"byteasend"}
ARRAY_ELEMENT={"_text":"text","_char":"char","int2vector":"int2","_int2":"int2","_int4":"int4",
               "_float4":"float4","_float8":"float8","_bool":"bool","_name":"name"}
ALL_CATALOGS=frozenset({*CATALOGS,"pg_extension","pg_class","pg_attribute","pg_index","pg_partitioned_table","pg_sequence",
    "pg_inherits","pg_constraint","pg_attrdef","pg_trigger","pg_policy","pg_rewrite","pg_am","pg_amop",
    "pg_amproc","pg_opclass","pg_opfamily","pg_operator","pg_cast","pg_language","pg_namespace",
    "pg_description","pg_init_privs","pg_seclabel","pg_shdepend","pg_depend","pg_foreign_table",
    "pg_ts_config_map","pg_collation","pg_conversion","pg_transform","pg_ts_config","pg_ts_dict",
    "pg_ts_parser","pg_ts_template"})
REFERENCE_CATALOGS=ALL_CATALOGS|{"pg_authid","pg_database","pg_tablespace","pg_extension","pg_foreign_server",
    "pg_foreign_data_wrapper","pg_publication","pg_subscription","pg_largeobject","pg_largeobject_metadata"}
INVERSE_TYPES=("aggregate","function","procedure","type","table","table column","index","view",
               "materialized view","sequence","foreign table","foreign table column","table constraint",
               "type constraint","trigger","rule","policy","operator","operator class","operator family",
               "access method","access method operator","access method function","cast","transform",
               "text search configuration","text search dictionary","text search parser","text search template",
               "language","conversion","collation","schema","extension","role","tablespace","database",
               "default value","domain constraint","operator of access method","function of access method")


def require(value):
    if not value:raise ValueError("public_catalog_manifest_unqualified")


def q(value):
    require(isinstance(value,str) and re.fullmatch(r"[a-z_][a-z0-9_]*",value))
    return '"'+value+'"'


def s(value):return "'"+value.replace("'","''")+"'"


def hash_sql(expression):
    return "encode(pg_catalog.sha256(pg_catalog.convert_to(("+expression+")::text,'UTF8')),'hex')"


def identity(catalog,value):
    return "(SELECT a.identity FROM checked_addresses a WHERE a.classid='pg_catalog."+q(catalog)+"'::regclass AND a.objid=("+value+")::oid AND a.objsubid=0)"


def ordinary_roundtrip_sql(alias):
    q(alias)
    return "("+alias+".inverse=jsonb_build_object('classid',"+alias+".classid::oid,'objid',"+alias+".objid,'objsubid',"+alias+".objsubid) OR ("+alias+".classid='pg_catalog.pg_class'::regclass AND "+alias+".objsubid=0 AND "+alias+".identity->>'type'='composite type' AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_type t ON t.oid=c.reltype AND t.typrelid=c.oid CROSS JOIN LATERAL (SELECT to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,t.oid,0)) AS value) type_key WHERE c.oid="+alias+".objid AND c.relkind='c' AND to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_class'::regclass,c.oid,0))="+alias+".identity AND to_jsonb(pg_catalog.pg_get_object_address(type_key.value->>'type',ARRAY(SELECT jsonb_array_elements_text(type_key.value->'object_names')),ARRAY(SELECT jsonb_array_elements_text(type_key.value->'object_args'))))=jsonb_build_object('classid','pg_catalog.pg_type'::regclass::oid,'objid',t.oid,'objsubid',0))))"


def dimensions(value):
    return "coalesce((SELECT jsonb_agg(jsonb_build_object('lower',array_lower("+value+",d),'length',array_length("+value+",d)) ORDER BY d) FROM generate_series(1,coalesce(array_ndims("+value+"),0)) d),'[]'::jsonb)"


def scalar(value,typ):
    require(typ in SEND)
    return "jsonb_build_object('kind','scalar','type',"+s(typ)+",'isNull',("+value+") IS NULL,'bytesHex',encode(pg_catalog."+SEND[typ]+"("+value+"),'hex'))"


def reference(value,desc):
    return "jsonb_build_object('kind','reference','type',"+s(desc["type"])+",'isNull',("+value+") IS NULL,'value',CASE WHEN ("+value+") IS NULL THEN NULL WHEN ("+value+")::oid=0 THEN jsonb_build_object('kind','zero-reference','catalog',"+s(desc["ref"])+") ELSE "+identity(desc["ref"],value)+" END)"


def array(value,desc):
    if desc["kind"]=="array_ref":item=reference("u.value",{**desc,"type":"oid"})
    else:
        require(desc["type"] in {"_text","_char"})
        item=scalar("u.value",desc["type"][1:])
    source="("+value+")::oid[]" if desc["kind"]=="array_ref" else value
    return "jsonb_build_object('kind',"+s(desc["kind"])+",'type',"+s(desc["type"])+",'isNull',("+value+") IS NULL,'dimensions',CASE WHEN ("+value+") IS NULL THEN NULL ELSE "+dimensions(source)+" END,'items',CASE WHEN ("+value+") IS NULL THEN NULL ELSE coalesce((SELECT jsonb_agg("+item+" ORDER BY u.ordinality) FROM unnest("+source+") WITH ORDINALITY u(value,ordinality)),'[]'::jsonb) END)"


def acl(value):
    # Text input/output equality proves the text representation retained every
    # aclitem bit. Keep ordered array items, nulls, bounds, exact text and the
    # complete role identities of each decomposed privilege in the SQL payload.
    entries="coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',"+identity("pg_authid","e.grantor")+",'grantee',CASE WHEN e.grantee=0 THEN jsonb_build_object('kind','PUBLIC') ELSE "+identity("pg_authid","e.grantee")+" END,'privilege',e.privilege_type,'grantable',e.is_grantable) ORDER BY e.privilege_type COLLATE \"C\",e.is_grantable) FROM aclexplode(ARRAY[u.value]::aclitem[]) e),'[]'::jsonb)"
    item="CASE WHEN u.value IS NULL THEN NULL ELSE jsonb_build_object('roundtrip',((u.value::text)::aclitem=u.value),'textBytesHex',encode(convert_to(u.value::text,'UTF8'),'hex'),'privileges',"+entries+") END"
    return "jsonb_build_object('kind','acl','type','_aclitem','isNull',("+value+") IS NULL,'dimensions',CASE WHEN ("+value+") IS NULL THEN NULL ELSE "+dimensions(value)+" END,'items',CASE WHEN ("+value+") IS NULL THEN NULL ELSE coalesce((SELECT jsonb_agg("+item+" ORDER BY u.ordinality) FROM unnest("+value+") WITH ORDINALITY u(value,ordinality)),'[]'::jsonb) END)"


def row_key(catalog,alias):
    if catalog=="pg_enum":
        return "jsonb_build_object('derived','enum-label','type',"+identity("pg_type",alias+".enumtypid")+",'labelHex',encode(namesend("+alias+".enumlabel),'hex'))"
    if catalog=="pg_aggregate":return identity("pg_proc",alias+".aggfnoid")
    if catalog=="pg_range":return identity("pg_type",alias+".rngtypid")
    return identity(catalog,alias+".oid")


def cell(catalog,name,desc,alias="r"):
    value=alias+"."+q(name);kind=desc["kind"]
    if kind=="scalar":return scalar(value,desc["type"])
    if kind=="self":return "jsonb_build_object('kind','self','identity',"+row_key(catalog,alias)+")"
    if kind=="ref":return reference(value,desc)
    if kind in {"array_ref","array_scalar"}:return array(value,desc)
    if kind=="acl":return acl(value)
    if kind=="node":
        return "jsonb_build_object('kind','opaque-node-raw-binding','type','pg_node_tree','isNull',("+value+") IS NULL,'rawNodeSha256',CASE WHEN ("+value+") IS NULL THEN NULL ELSE "+hash_sql(value+"::text")+" END,'canonicalized',("+value+") IS NULL)"
    raise ValueError("public_catalog_adapter_unimplemented")


def foreign_keys(manifests):
    return sorted([{"catalog":cat,"column_names":[name],"referenced_catalog":d["ref"],
                    "referenced_columns":["oid"],"is_array":d["kind"]=="array_ref","is_opt":d["optional"]}
                   for cat,fields in manifests.items() for name,d in fields.items()
                   if d["kind"] in {"ref","array_ref"}],key=lambda r:(r["catalog"],r["column_names"]))


def build_query(manifests, *, transaction_wrapper=True):
    require(type(transaction_wrapper) is bool)
    require(set(manifests)==set(CATALOGS))
    for catalog,fields in manifests.items():
        q(catalog);require(fields)
        for name,desc in fields.items():
            q(name);require(set(desc)==({"type","dimensions","not_null","kind","ref","optional"}
                if desc["kind"] in {"ref","array_ref"} else {"type","dimensions","not_null","kind"}))
            require(type(desc["dimensions"]) is int and type(desc["not_null"]) is bool)
            if "ref" in desc:q(desc["ref"]);require(type(desc["optional"]) is bool)
            require(desc["type"] in ({"scalar":set(SEND),"self":{"oid"},"ref":{"oid","regproc"},
                    "array_ref":{"_oid","oidvector"},"array_scalar":{"_text","_char"},
                    "acl":{"_aclitem"},"node":{"pg_node_tree"}}.get(desc["kind"],set())))
    columns=[]
    for catalog in CATALOGS:
        for name,d in sorted(manifests[catalog].items()):
            columns.append("("+",".join([s(catalog),s(name),s(d["type"]),str(d["dimensions"]),str(d["not_null"]).lower()])+")")
    expected_fks="'"+json.dumps(foreign_keys(manifests),sort_keys=True,separators=(",",":")).replace("'","''")+"'::jsonb"
    address_queries=["SELECT 'pg_catalog.pg_extension'::regclass AS classid,extensionoid AS objid,0 AS objsubid FROM extension_owned"]
    invalid=[];acl_invalid=[];opaque=[];payloads=[];nodes=[]
    for catalog in CATALOGS:
        table=catalog+"_scope"
        if catalog in {"pg_proc","pg_type"}:
            address_queries.append("SELECT 'pg_catalog."+catalog+"'::regclass,oid,0 FROM "+table)
        scalar_pairs=[]
        for name,d in sorted(manifests[catalog].items()):
            value="r."+q(name)
            if d["kind"]!="node":scalar_pairs += [s(name),cell(catalog,name,d)]
            if d["kind"]=="ref":
                address_queries.append("SELECT 'pg_catalog."+d["ref"]+"'::regclass,"+value+"::oid,0 FROM "+table+" r WHERE "+value+"::oid<>0")
                if not d["optional"]:invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r WHERE "+value+"::oid=0 OR "+value+" IS NULL")
            elif d["kind"]=="array_ref":
                address_queries.append("SELECT 'pg_catalog."+d["ref"]+"'::regclass,u.value,0 FROM "+table+" r CROSS JOIN LATERAL unnest(("+value+")::oid[]) u(value) WHERE u.value<>0")
                invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL unnest(("+value+")::oid[]) u(value) WHERE u.value IS NULL"+(" OR u.value=0" if not d["optional"] else ""))
            elif d["kind"]=="acl":
                for role in ["grantor","grantee"]:
                    address_queries.append("SELECT 'pg_catalog.pg_authid'::regclass,e."+role+",0 FROM "+table+" r CROSS JOIN LATERAL aclexplode("+value+") e WHERE e."+role+"<>0")
                invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL aclexplode("+value+") e WHERE e.grantor=0")
                acl_invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL unnest("+value+") u(value) WHERE u.value IS NOT NULL AND (NOT ((u.value::text)::aclitem=u.value) OR NOT EXISTS(SELECT 1 FROM aclexplode(ARRAY[u.value]::aclitem[])))")
            elif d["kind"]=="node":
                opaque.append("SELECT count(*)::bigint AS n FROM "+table+" r WHERE "+value+" IS NOT NULL")
                nodes.append("SELECT "+s(catalog)+" AS catalog,"+s(name)+" AS field,jsonb_build_object('extension',"+identity("pg_extension","r.extensionoid")+",'object',"+row_key(catalog,"r")+",'field',"+s(name)+",'rawNodeSha256',"+hash_sql(value+"::text")+") AS binding FROM "+table+" r WHERE "+value+" IS NOT NULL")
        payloads.append("SELECT "+s(catalog)+" AS catalog,jsonb_build_object('extension',"+identity("pg_extension","r.extensionoid")+",'object',"+row_key(catalog,"r")+",'columns',jsonb_build_object("+",".join(scalar_pairs)+")) AS non_opaque_payload FROM "+table+" r")
    invtypes=",".join(s(x) for x in INVERSE_TYPES)
    text="""-- GENERATED by extension-routine-type-hash-query.py from public PG17.6 manifests.
-- Hash-only READONLY source metadata. No raw names, bodies/config/ACL/node values
-- leave PostgreSQL. Raw node bindings are NOT cross-server canonical hashes.
-- Other extension classes remain uncovered; this cannot qualify a restore.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
WITH RECURSIVE
  extension_owned(extensionoid,classid,objid,objsubid) AS (
    SELECT e.oid,d.classid,d.objid,d.objsubid FROM pg_depend d
    JOIN pg_extension e ON d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjid=e.oid AND d.deptype='e'
    UNION
    SELECT o.extensionoid,d.classid,d.objid,d.objsubid FROM pg_depend d
    JOIN extension_owned o ON d.refclassid=o.classid AND d.refobjid=o.objid
      AND d.refobjsubid=o.objsubid WHERE d.deptype='i'
  ),
  pg_proc_scope AS (SELECT o.extensionoid,p.* FROM extension_owned o JOIN pg_proc p
    ON o.classid='pg_catalog.pg_proc'::regclass AND o.objid=p.oid AND o.objsubid=0),
  pg_type_scope AS (SELECT o.extensionoid,t.* FROM extension_owned o JOIN pg_type t
    ON o.classid='pg_catalog.pg_type'::regclass AND o.objid=t.oid AND o.objsubid=0),
  pg_aggregate_scope AS (SELECT DISTINCT p.extensionoid,a.* FROM pg_proc_scope p JOIN pg_aggregate a ON a.aggfnoid=p.oid),
  pg_enum_scope AS (SELECT DISTINCT t.extensionoid,e.* FROM pg_type_scope t JOIN pg_enum e ON e.enumtypid=t.oid),
  pg_range_scope AS (SELECT DISTINCT t.extensionoid,r.* FROM pg_type_scope t JOIN pg_range r
    ON r.rngtypid=t.oid OR r.rngmultitypid=t.oid),
  expected_columns(catalog,column_name,type,dimensions,not_null) AS (VALUES
    """+",\n    ".join(columns)+"""),
  actual_columns AS (
    SELECT c.relname::text AS catalog,a.attname::text AS column_name,t.typname::text AS type,
      a.attndims::integer AS dimensions,a.attnotnull AS not_null FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='pg_catalog'
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid=a.atttypid WHERE c.relname IN ("""+",".join(s(c) for c in CATALOGS)+""")),
  column_differences AS (
    (SELECT * FROM expected_columns EXCEPT ALL SELECT * FROM actual_columns)
    UNION ALL (SELECT * FROM actual_columns EXCEPT ALL SELECT * FROM expected_columns)),
  expected_foreign_keys AS (SELECT value FROM jsonb_array_elements("""+expected_fks+""")),
  actual_foreign_keys AS (
    SELECT jsonb_build_object('catalog',c.relname,'column_names',f.fkcols,
      'referenced_catalog',p.relname,'referenced_columns',f.pkcols,'is_array',f.is_array,'is_opt',f.is_opt) AS value
    FROM pg_get_catalog_foreign_keys() f JOIN pg_class c ON c.oid=f.fktable JOIN pg_class p ON p.oid=f.pktable
    WHERE c.relname IN ("""+",".join(s(c) for c in CATALOGS)+""")),
  foreign_key_differences AS (
    (SELECT value FROM expected_foreign_keys EXCEPT ALL SELECT value FROM actual_foreign_keys)
    UNION ALL (SELECT value FROM actual_foreign_keys EXCEPT ALL SELECT value FROM expected_foreign_keys)),
  raw_addresses(classid,objid,objsubid) AS (
    """+"\n    UNION\n    ".join(address_queries)+"""),
  identities AS (
    SELECT a.*,to_jsonb(pg_identify_object_as_address(a.classid,a.objid,a.objsubid)) AS identity
    FROM raw_addresses a WHERE a.objid<>0),
  inverse_addresses AS (
    SELECT i.*,CASE WHEN i.identity->>'type' IN ("""+invtypes+""")
      AND jsonb_typeof(i.identity->'object_names')='array' AND jsonb_typeof(i.identity->'object_args')='array'
      THEN to_jsonb(pg_get_object_address(i.identity->>'type',
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_names')),
        ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_args')))) ELSE NULL END AS inverse
    FROM identities i),
  checked_addresses AS (
    SELECT i.*,coalesce("""+ordinary_roundtrip_sql("i")+""",false) AS roundtrip_ok
    FROM inverse_addresses i),
  invalid_reference_values AS ("""+" UNION ALL ".join(invalid or ["SELECT 0::bigint AS n"])+"""),
  invalid_acl_values AS ("""+" UNION ALL ".join(acl_invalid or ["SELECT 0::bigint AS n"])+"""),
  opaque_occurrences AS ("""+" UNION ALL ".join(opaque or ["SELECT 0::bigint AS n"])+"""),
  node_bindings AS ("""+" UNION ALL ".join(nodes or ["SELECT NULL::text AS catalog,NULL::text AS field,NULL::jsonb AS binding WHERE false"])+"""),
  payload_rows AS (
    """+"\n    UNION ALL\n    ".join(payloads)+"""),
  class_hashes AS (
    SELECT catalog,count(*) AS object_count,
      encode(sha256(convert_to(coalesce(jsonb_agg(non_opaque_payload ORDER BY non_opaque_payload::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS non_opaque_payload_sha256
    FROM payload_rows GROUP BY catalog),
  known_catalogs(catalog) AS (VALUES """+",".join("("+s(c)+")" for c in CATALOGS)+"""),
  guards AS (
    SELECT current_setting('server_version_num')::integer=170006 AS version_ok,
      current_setting('server_encoding')='UTF8' AS encoding_ok,
      current_setting('transaction_read_only')='on' AS read_only_ok,
      current_setting('transaction_isolation')='repeatable read' AS repeatable_read_ok,
      current_setting('search_path')='pg_catalog' AS search_path_ok,
      NOT EXISTS(SELECT 1 FROM column_differences) AS columns_ok,
      NOT EXISTS(SELECT 1 FROM foreign_key_differences) AS foreign_keys_ok,
      NOT EXISTS(SELECT 1 FROM checked_addresses WHERE NOT roundtrip_ok) AS addresses_ok,
      coalesce((SELECT sum(n) FROM invalid_reference_values),0)=0 AS references_ok,
      coalesce((SELECT sum(n) FROM invalid_acl_values),0)=0 AS acls_ok,
      NOT EXISTS(SELECT 1 FROM pg_enum_scope GROUP BY extensionoid,enumtypid,enumlabel HAVING count(*)<>1) AS enum_keys_ok,
      NOT EXISTS(SELECT 1 FROM pg_type_scope WHERE NOT typisdefined) AS types_defined)
SELECT jsonb_build_object(
  'operation','extension-routine-type-hash-only-payloads','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,'requiredServerVersionNum',170006,
  'customerRowsRead',false,'productionMutated',false,'rawMetadataReturned',false,
  'sourceSnapshotSha256',encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'),
  'captureSnapshotBound',false,
  'qualificationReady',false,'semanticEqualityProven',false,'otherExtensionClassesCovered',false,
  'scalarPayloadsComparable',(SELECT version_ok AND encoding_ok AND read_only_ok AND repeatable_read_ok AND search_path_ok AND columns_ok AND foreign_keys_ok
    AND addresses_ok AND references_ok AND acls_ok AND enum_keys_ok AND types_defined FROM guards),
  'nodeCanonicalizationComplete',coalesce((SELECT sum(n) FROM opaque_occurrences),0)=0,
  'opaqueNodeHashesAreRawBindings',true,
  'guardResults',(SELECT to_jsonb(g) FROM guards g),
  'counts',jsonb_build_object('catalogColumnDifferences',(SELECT count(*) FROM column_differences),
    'catalogForeignKeyDifferences',(SELECT count(*) FROM foreign_key_differences),
    'nonRoundtrippableAddresses',(SELECT count(*) FROM checked_addresses WHERE NOT roundtrip_ok),
    'invalidReferenceValues',coalesce((SELECT sum(n) FROM invalid_reference_values),0),
    'invalidAclValues',coalesce((SELECT sum(n) FROM invalid_acl_values),0),
    'uncanonicalizedOpaqueNodeOccurrences',coalesce((SELECT sum(n) FROM opaque_occurrences),0)),
  'catalogPayloadHashes',(SELECT jsonb_agg(jsonb_build_object('catalog',k.catalog,'objectCount',coalesce(h.object_count,0),
    'nonOpaquePayloadSha256',coalesce(h.non_opaque_payload_sha256,encode(sha256(convert_to('[]','UTF8')),'hex')))
    ORDER BY k.catalog COLLATE "C") FROM known_catalogs k LEFT JOIN class_hashes h USING(catalog)),
  'rawNodeBindingSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(binding ORDER BY binding::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') FROM node_bindings),
  'rawNodeFieldCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('catalog',catalog,'field',field,'count',n)
    ORDER BY catalog COLLATE "C",field COLLATE "C"),'[]'::jsonb) FROM (SELECT catalog,field,count(*) AS n FROM node_bindings GROUP BY catalog,field) rows)
)::text;
COMMIT;
"""
    if not transaction_wrapper:
        start=text.index("WITH RECURSIVE\n")
        text=text[:text.index("BEGIN ISOLATION LEVEL")]+text[start:]
        require(text.endswith("COMMIT;\n"))
        text=text[:-len("COMMIT;\n")]
    return text


def private_scalar(value,typ):
    require(typ in SEND)
    return "jsonb_build_object('isNull',("+value+") IS NULL,'bytesHex',encode(pg_catalog."+SEND[typ]+"("+value+"),'hex'))"


def private_cell(name,desc,alias="r"):
    """Wire cells for the private adapter; NEVER returned by build_query()."""
    value=alias+"."+q(name);kind=desc["kind"]
    if kind in {"scalar","excluded_physical","conditional_owned_name"}:return private_scalar(value,desc["type"])
    if kind in {"ref","self","raw_oid","polymorphic_ref"}:return "("+value+")::oid::bigint"
    if kind=="node":return "("+value+")::text"
    if kind=="unsupported_nullable":
        return "CASE WHEN ("+value+") IS NULL THEN NULL ELSE jsonb_build_object('unsupportedNonNull',true) END"
    if kind in {"array_ref","array_scalar"}:
        if kind=="array_ref":source="("+value+")::oid[]";item="u.value::bigint"
        else:
            require(desc["type"] in ARRAY_ELEMENT)
            source="("+value+")::int2[]" if desc["type"]=="int2vector" else value
            item=private_scalar("u.value",ARRAY_ELEMENT[desc["type"]])
    elif kind=="acl":
        source=value
        entries="coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',e.grantor::bigint,'grantee',e.grantee::bigint,'privilege',e.privilege_type,'isGrantable',e.is_grantable) ORDER BY e.privilege_type COLLATE \"C\",e.is_grantable) FROM aclexplode(ARRAY[u.value]::aclitem[]) e),'[]'::jsonb)"
        item="CASE WHEN u.value IS NULL THEN NULL ELSE jsonb_build_object('textHex',encode(convert_to(u.value::text,'UTF8'),'hex'),'roundtrip',((u.value::text)::aclitem=u.value),'entries',"+entries+") END"
    else:raise ValueError("public_catalog_adapter_unimplemented")
    return "CASE WHEN ("+value+") IS NULL THEN NULL ELSE jsonb_build_object('dimensions',"+dimensions(source)+",'items',coalesce((SELECT jsonb_agg("+item+" ORDER BY u.ordinality) FROM unnest("+source+") WITH ORDINALITY u(value,ordinality)),'[]'::jsonb)) END"


def build_private_wire_query(manifests):
    """Single SELECT for an approved private GHA reader's existing snapshot.

    NEVER execute this through a source connector or log its response. The
    caller must keep the exporter alive for later AST/type/address resolution,
    bind exact query bytes/hash and snapshot proof, and store only in its owned
    private memory/0600 workspace or the explicitly approved encrypted envelope.
    The custom GUC is an accidental-use guard, not a substitute for the private
    caller's credential, source, custody and execution-policy validation.
    """
    body=build_query(manifests,transaction_wrapper=False)
    start=body.index("WITH RECURSIVE\n")
    end=body.index("\nSELECT jsonb_build_object(\n",start)
    common=body[start:end]
    gate="""WITH RECURSIVE
  private_wire_gate AS MATERIALIZED (
    SELECT current_setting('kova.private_extension_wire',true)='PRIVATE_GHA_CAPTURE_ONLY'
      AND current_setting('server_version_num')::integer=170006
      AND current_setting('server_encoding')='UTF8'
      AND current_setting('transaction_read_only')='on'
      AND current_setting('transaction_isolation')='repeatable read'
      AND current_setting('search_path')='pg_catalog' AS allowed),
"""
    common=common.replace("WITH RECURSIVE\n",gate,1)
    common=common.replace("AND d.refobjid=e.oid AND d.deptype='e'",
        "AND d.refobjid=e.oid AND d.deptype='e' AND (SELECT allowed FROM private_wire_gate)",1)
    rows=[]
    for catalog in CATALOGS:
        pairs=[]
        for name,field in sorted(manifests[catalog].items()):pairs += [s(name),private_cell(name,field)]
        rows.append("SELECT "+s(catalog)+" AS catalog,jsonb_build_object('catalog',"+s(catalog)+",'extensionOid',r.extensionoid::bigint,'values',jsonb_build_object("+",".join(pairs)+")) AS wire FROM "+catalog+"_scope r")
    private=""",
  private_rows AS (
    """+"\n    UNION ALL\n    ".join(rows)+"""),
  private_reference_rows AS (
    SELECT c.relname::text AS catalog,a.objid::bigint AS oid,a.objsubid AS subid,a.identity,a.roundtrip_ok AS roundtrip
      FROM checked_addresses a JOIN pg_class c ON c.oid=a.classid
    UNION
    SELECT 'pg_enum',e.oid::bigint,0,"""+row_key("pg_enum","e")+""",
      (SELECT count(*)=1 FROM pg_enum other WHERE other.enumtypid=e.enumtypid AND other.enumlabel=e.enumlabel)
      FROM pg_enum_scope e
  )
SELECT CASE WHEN (SELECT allowed FROM private_wire_gate)
  AND (SELECT version_ok AND encoding_ok AND read_only_ok AND repeatable_read_ok AND search_path_ok
    AND columns_ok AND foreign_keys_ok AND addresses_ok AND references_ok AND acls_ok AND enum_keys_ok AND types_defined FROM guards)
THEN jsonb_build_object('operation','PRIVATE_GHA_ONLY-extension-routine-type-wire','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'sourceSnapshotSha256',encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'),
  'captureSnapshotBound',false,'querySha256MustBeBoundByPrivateWrapper',true,
  'privateRawWire',true,'rawValuesAllowedOnlyInApprovedPrivateGha',true,
  'customerRowsRead',false,'productionMutated',false,'qualificationReady',false,
  'astEmbeddedReferencesComplete',false,'typeDatumLayoutsComplete',false,
  'nodeReferenceCoverageComplete',false,'typeLayoutsComplete',false,
  'catalogColumns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY catalog COLLATE "C",column_name COLLATE "C") FROM actual_columns a),
  'catalogForeignKeys',(SELECT jsonb_agg(value ORDER BY value::text COLLATE "C") FROM actual_foreign_keys),
  'rows',(SELECT coalesce(jsonb_agg(wire ORDER BY catalog COLLATE "C",wire::text COLLATE "C"),'[]'::jsonb) FROM private_rows),
  'resolvedReferences',(SELECT coalesce(jsonb_agg(jsonb_build_object('catalog',catalog,'oid',oid,'subid',subid,
    'identity',identity,'roundtrip',roundtrip) ORDER BY catalog COLLATE "C",oid,subid),'[]'::jsonb) FROM private_reference_rows))
ELSE jsonb_build_object('operation','PRIVATE_GHA_ONLY-extension-routine-type-wire','format',1,
  'ok',false,'error','private_wire_context_or_layout_denied','privateRawWire',false,
  'qualificationReady',false,'productionMutated',false,'customerRowsRead',false) END::text;
"""
    return "-- PRIVATE_GHA_ONLY generated query; NEVER source connector, log or plaintext artifact.\n"+common+private


DEFAULT_ALL_COMMON_CTES="""extension_roots(extensionoid,classid,objid,objsubid) AS (
  SELECT e.oid,'pg_catalog.pg_extension'::regclass,e.oid,0 FROM pg_catalog.pg_extension e
    WHERE (SELECT allowed FROM private_wire_gate)
), extension_owned(extensionoid,classid,objid,objsubid) AS (
  SELECT e.oid,d.classid,d.objid,d.objsubid FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_extension e ON d.refclassid='pg_catalog.pg_extension'::regclass
    AND d.refobjid=e.oid AND d.deptype='e' AND (SELECT allowed FROM private_wire_gate)
  UNION
  SELECT o.extensionoid,d.classid,d.objid,d.objsubid FROM pg_catalog.pg_depend d
  JOIN extension_owned o ON d.refclassid=o.classid AND d.refobjid=o.objid
    AND d.refobjsubid=o.objsubid WHERE d.deptype='i'
), base_relation_scope(extensionoid,relid) AS (
  SELECT extensionoid,objid FROM extension_owned WHERE classid='pg_catalog.pg_class'::regclass
  UNION SELECT o.extensionoid,i.indexrelid FROM extension_owned o JOIN pg_catalog.pg_index i
    ON o.classid='pg_catalog.pg_class'::regclass AND i.indrelid=o.objid
), owned_sequence_candidates AS MATERIALIZED (
  SELECT r.extensionoid,d.objid AS seqid,d.objsubid,d.refobjid,d.refobjsubid,d.deptype
  FROM base_relation_scope r JOIN pg_catalog.pg_depend d
    ON d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=r.relid
      AND d.classid='pg_catalog.pg_class'::regclass
  LEFT JOIN pg_catalog.pg_class c ON c.oid=d.objid
  WHERE c.relkind='S' OR EXISTS(SELECT 1 FROM pg_catalog.pg_sequence s WHERE s.seqrelid=d.objid)
), owned_sequence_proofs AS MATERIALIZED (
  SELECT candidate.*,coalesce(candidate.deptype IN ('a','i') AND candidate.objsubid=0
    AND candidate.refobjsubid>0
    AND (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=candidate.refobjid
      AND a.attnum=candidate.refobjsubid AND a.attnum>0 AND NOT a.attisdropped)=1
    AND (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid=candidate.seqid AND c.relkind='S')=1
    AND (SELECT count(*) FROM pg_catalog.pg_sequence s WHERE s.seqrelid=candidate.seqid)=1
    AND (SELECT count(*) FROM pg_catalog.pg_depend owner WHERE owner.classid='pg_catalog.pg_class'::regclass
      AND owner.objid=candidate.seqid AND owner.refclassid='pg_catalog.pg_class'::regclass
      AND owner.deptype IN ('a','i'))=1,false) AS proven
  FROM owned_sequence_candidates candidate
), sequence_ownership_failures AS MATERIALIZED (
  SELECT * FROM owned_sequence_proofs WHERE NOT proven
), owned_sequences(extensionoid,relid) AS (
  SELECT DISTINCT extensionoid,seqid FROM owned_sequence_proofs WHERE proven
), relation_scope(extensionoid,relid) AS (
  SELECT * FROM base_relation_scope UNION SELECT * FROM owned_sequences
), associated(extensionoid,classid,objid,objsubid) AS (
  SELECT r.extensionoid,'pg_catalog.pg_class'::regclass,r.relid,a.attnum::integer
    FROM relation_scope r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.relid
    WHERE a.attnum>0 AND NOT a.attisdropped
  UNION SELECT r.extensionoid,'pg_catalog.pg_class'::regclass,r.relid,0 FROM relation_scope r
  UNION SELECT r.extensionoid,'pg_catalog.pg_attrdef'::regclass,a.oid,0 FROM relation_scope r JOIN pg_catalog.pg_attrdef a ON a.adrelid=r.relid
  UNION SELECT r.extensionoid,'pg_catalog.pg_constraint'::regclass,c.oid,0 FROM relation_scope r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.relid
  UNION SELECT o.extensionoid,'pg_catalog.pg_constraint'::regclass,c.oid,0 FROM extension_owned o JOIN pg_catalog.pg_constraint c ON o.classid='pg_catalog.pg_type'::regclass AND c.contypid=o.objid
  UNION SELECT r.extensionoid,'pg_catalog.pg_trigger'::regclass,t.oid,0 FROM relation_scope r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.relid
  UNION SELECT r.extensionoid,'pg_catalog.pg_policy'::regclass,p.oid,0 FROM relation_scope r JOIN pg_catalog.pg_policy p ON p.polrelid=r.relid
  UNION SELECT r.extensionoid,'pg_catalog.pg_rewrite'::regclass,w.oid,0 FROM relation_scope r JOIN pg_catalog.pg_rewrite w ON w.ev_class=r.relid
), scope AS (SELECT * FROM extension_roots UNION SELECT * FROM extension_owned UNION SELECT * FROM associated)"""


def default_scope_queries(catalogs):
    """Public catalog selectors, never generated from source object names."""
    result={}
    for catalog in catalogs:
        require(catalog in ALL_CATALOGS)
        if catalog=="pg_extension":query="SELECT r.extensionoid,c.* FROM extension_roots r JOIN pg_catalog.pg_extension c ON c.oid=r.objid"
        elif catalog=="pg_attribute":query="SELECT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_attribute c ON c.attrelid=r.relid"
        elif catalog=="pg_index":query="SELECT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_index c ON c.indexrelid=r.relid"
        elif catalog=="pg_partitioned_table":query="SELECT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_partitioned_table c ON c.partrelid=r.relid"
        elif catalog=="pg_sequence":query="SELECT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_sequence c ON c.seqrelid=r.relid"
        elif catalog=="pg_foreign_table":query="SELECT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_foreign_table c ON c.ftrelid=r.relid"
        elif catalog=="pg_inherits":query="SELECT DISTINCT r.extensionoid,c.* FROM relation_scope r JOIN pg_catalog.pg_inherits c ON c.inhrelid=r.relid OR c.inhparent=r.relid"
        elif catalog=="pg_aggregate":query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog.pg_aggregate c ON s.classid='pg_catalog.pg_proc'::regclass AND c.aggfnoid=s.objid AND s.objsubid=0"
        elif catalog=="pg_enum":query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog.pg_enum c ON s.classid='pg_catalog.pg_type'::regclass AND c.enumtypid=s.objid AND s.objsubid=0"
        elif catalog=="pg_range":query="SELECT DISTINCT s.extensionoid,c.* FROM scope s JOIN pg_catalog.pg_range c ON s.classid='pg_catalog.pg_type'::regclass AND (c.rngtypid=s.objid OR c.rngmultitypid=s.objid) AND s.objsubid=0"
        elif catalog in {"pg_description","pg_init_privs","pg_seclabel"}:
            query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog."+q(catalog)+" c ON c.classoid=s.classid AND c.objoid=s.objid AND c.objsubid=s.objsubid"
        elif catalog in {"pg_depend","pg_shdepend"}:
            query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog."+q(catalog)+" c ON c.classid=s.classid AND c.objid=s.objid AND c.objsubid=s.objsubid"
            if catalog=="pg_shdepend":query+=" WHERE c.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())"
        elif catalog=="pg_ts_config_map":query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog.pg_ts_config_map c ON s.classid='pg_catalog.pg_ts_config'::regclass AND c.mapcfg=s.objid AND s.objsubid=0"
        elif catalog in {"pg_amop","pg_amproc"}:
            family="amopfamily" if catalog=="pg_amop" else "amprocfamily"
            query="SELECT DISTINCT s.extensionoid,c.* FROM scope s JOIN pg_catalog."+q(catalog)+" c ON (s.classid='pg_catalog."+q(catalog)+"'::regclass AND c.oid=s.objid AND s.objsubid=0) OR (s.classid='pg_catalog.pg_opfamily'::regclass AND c."+family+"=s.objid AND s.objsubid=0)"
        else:query="SELECT s.extensionoid,c.* FROM scope s JOIN pg_catalog."+q(catalog)+" c ON s.classid='pg_catalog."+q(catalog)+"'::regclass AND c.oid=s.objid AND s.objsubid=0"
        result[catalog]=query
    return result


def checked_local_sql(value):
    """Defense in depth for reviewed module constants; NOT a SQL sanitizer.

    These API inputs must never originate in database rows/JSON/source values.
    They are fixed local source expressions covered by the caller's reviewed
    query hash. There is deliberately no CLI accepting these expressions.
    """
    require(type(value) is str and value and len(value)<=256*1024 and ";" not in value and "\x00" not in value)
    require(not re.search(r"\b(?:insert|update|delete|copy|alter|create|drop|truncate|grant|revoke|do|call)\b",value,re.I))
    require(not re.search(r"\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|dblink|lo_import|lo_export|pg_statistic|pg_statistic_ext_data)\b",value,re.I))
    require(not re.search(r"\b(?:public|auth|storage|kova_private|net|cron)\s*\.",value,re.I))
    require(not re.search(r"\b(?:from|join)\s+(?:pg_catalog\s*\.\s*)?\"?pg_authid\"?\b",value,re.I))
    return value


def checked_local_callback(callback):
    require(inspect.isfunction(callback) and callback.__closure__ is None)
    path=Path(inspect.getsourcefile(callback) or "").resolve()
    root=Path(__file__).resolve().parents[2]
    require(path.is_file() and (path.is_relative_to(root/"scripts/release") or path.is_relative_to(root/"tests/unit")))
    return callback


def validate_capture_manifests(manifests):
    require(type(manifests) is dict and manifests and set(manifests)<=ALL_CATALOGS)
    for catalog,fields in manifests.items():
        q(catalog);require(type(fields) is dict and fields)
        for name,field in fields.items():
            q(name);require(type(field) is dict and {"type","dimensions","not_null","kind"}<=set(field)
                and type(field["dimensions"]) is int and type(field["not_null"]) is bool)
            kind=field["kind"];typ=field["type"]
            allowed={"scalar":set(SEND),"excluded_physical":set(SEND),"conditional_owned_name":{"name"},
                "self":{"oid"},"raw_oid":{"oid","regproc","regclass"},"polymorphic_ref":{"oid"},"ref":{"oid","regproc","regclass"},
                "array_ref":{"_oid","oidvector"},"array_scalar":set(ARRAY_ELEMENT),"acl":{"_aclitem"},
                "node":{"pg_node_tree"},"unsupported_nullable":{"anyarray"}}
            require(kind in allowed and typ in allowed[kind])
            if kind in {"ref","array_ref"}:
                require(set(field)=={"type","dimensions","not_null","kind","ref","optional"}
                    and field["ref"] in REFERENCE_CATALOGS and type(field["optional"]) is bool)
            elif kind=="polymorphic_ref":
                require(set(field)=={"type","dimensions","not_null","kind","class_field","subid_field"})
                q(field["class_field"]);require(field["class_field"] in fields)
                if field["subid_field"] is not None:q(field["subid_field"]);require(field["subid_field"] in fields)
            elif kind=="excluded_physical":
                physical={"relfilenode":"oid","relpages":"int4","reltuples":"float4","relallvisible":"int4",
                          "relfrozenxid":"xid","relminmxid":"xid"}
                require(catalog=="pg_class" and name in physical and typ==physical[name]
                    and set(field)=={"type","dimensions","not_null","kind","reason"}
                    and type(field["reason"]) is str and bool(field["reason"]))
            else:require(set(field)=={"type","dimensions","not_null","kind"})


def build_capture_all_private_wire_query(manifests, *, scope_queries=None, identity_sql=None,
        extra_address_queries=(), common_ctes=None, catalog_foreign_keys=None,
        address_identity_sql=None, address_roundtrip_sql=None):
    """Reviewed-local all-catalog private capture body; no connector/CLI route.

    scope_queries and common_ctes are reviewed LOCAL SQL constants, never row
    strings. identity_sql(catalog,alias,ordinary_identity_function) selects a
    complete row identity for compound/no-OID rows. Address hooks are reviewed
    Python functions (alias,ordinary_sql)->SQL, permitting only separately
    proved structural keys; the default adds just the narrow composite inverse.
    All runtime source values remain SQL values, never query interpolation.
    AST references/type layouts still need private lazy reads in this snapshot.
    """
    validate_capture_manifests(manifests)
    catalogs=tuple(sorted(manifests))
    scopes=default_scope_queries(catalogs) if scope_queries is None else scope_queries
    require(type(scopes) is dict and set(scopes)==set(catalogs))
    scopes={catalog:checked_local_sql(query) for catalog,query in scopes.items()}
    require(type(extra_address_queries) in {list,tuple})
    extras=[checked_local_sql(query) for query in extra_address_queries]
    common=checked_local_sql(DEFAULT_ALL_COMMON_CTES if common_ctes is None else common_ctes).strip().rstrip(",")
    if identity_sql is not None:checked_local_callback(identity_sql)
    if address_identity_sql is not None:checked_local_callback(address_identity_sql)
    if address_roundtrip_sql is not None:checked_local_callback(address_roundtrip_sql)
    columns=[]
    for catalog in catalogs:
        for name,d in sorted(manifests[catalog].items()):
            columns.append("("+",".join([s(catalog),s(name),s(d["type"]),str(d["dimensions"]),str(d["not_null"]).lower()])+")")
    fks=foreign_keys(manifests) if catalog_foreign_keys is None else catalog_foreign_keys
    require(type(fks) is list)
    for row in fks:
        require(type(row) is dict and set(row)=={"catalog","column_names","referenced_catalog","referenced_columns","is_array","is_opt"}
            and row["catalog"] in manifests and row["referenced_catalog"] in REFERENCE_CATALOGS
            and type(row["column_names"]) is list and type(row["referenced_columns"]) is list
            and len(row["column_names"])==len(row["referenced_columns"])>0
            and type(row["is_array"]) is bool and type(row["is_opt"]) is bool)
        for name in row["column_names"]:q(name);require(name in manifests[row["catalog"]])
        for name in row["referenced_columns"]:q(name)
    encoded_fks="'"+json.dumps(fks,sort_keys=True,separators=(",",":")).replace("'","''")+"'::jsonb"
    addresses=["SELECT classid::oid,objid::oid,objsubid FROM scope WHERE classid IN ("+",".join("'pg_catalog."+q(c)+"'::regclass" for c in sorted(REFERENCE_CATALOGS))+")",
        "SELECT 'pg_catalog.pg_extension'::regclass::oid,extensionoid,0 FROM extension_owned"]
    invalid=[];acls=[];unsupported=[];wire_rows=[]
    for catalog in catalogs:
        table=q(catalog+"_scope")
        fields=manifests[catalog]
        pairs=[]
        for name,d in sorted(fields.items()):
            value="r."+q(name);kind=d["kind"]
            pairs += [s(name),private_cell(name,d)]
            if kind=="self" and catalog!="pg_enum":addresses.append("SELECT 'pg_catalog."+q(catalog)+"'::regclass::oid,"+value+"::oid,0 FROM "+table+" r WHERE "+value+"::oid<>0")
            elif kind=="ref":
                addresses.append("SELECT 'pg_catalog."+q(d["ref"])+"'::regclass::oid,"+value+"::oid,0 FROM "+table+" r WHERE "+value+"::oid<>0")
                if not d["optional"]:invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r WHERE "+value+" IS NULL OR "+value+"::oid=0")
            elif kind=="array_ref":
                addresses.append("SELECT 'pg_catalog."+q(d["ref"])+"'::regclass::oid,u.value,0 FROM "+table+" r CROSS JOIN LATERAL unnest(("+value+")::oid[]) u(value) WHERE u.value<>0")
                invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL unnest(("+value+")::oid[]) u(value) WHERE u.value IS NULL"+(" OR u.value=0" if not d["optional"] else ""))
            elif kind=="polymorphic_ref":
                class_value="r."+q(d["class_field"])
                subid="r."+q(d["subid_field"]) if d["subid_field"] is not None else "0"
                addresses.append("SELECT "+class_value+"::oid,"+value+"::oid,"+subid+" FROM "+table+" r WHERE "+value+"::oid<>0")
                invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r WHERE "+value+" IS NULL OR "+value+"::oid=0 OR "+class_value+" IS NULL OR "+class_value+"::oid=0 OR "+subid+" IS NULL")
            elif kind=="acl":
                for role in ["grantor","grantee"]:addresses.append("SELECT 'pg_catalog.pg_authid'::regclass::oid,e."+role+",0 FROM "+table+" r CROSS JOIN LATERAL aclexplode("+value+") e WHERE e."+role+"<>0")
                invalid.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL aclexplode("+value+") e WHERE e.grantor=0")
                acls.append("SELECT count(*)::bigint AS n FROM "+table+" r CROSS JOIN LATERAL unnest("+value+") u(value) WHERE u.value IS NOT NULL AND (NOT ((u.value::text)::aclitem=u.value) OR NOT EXISTS(SELECT 1 FROM aclexplode(ARRAY[u.value]::aclitem[])))")
            elif kind=="unsupported_nullable":unsupported.append("SELECT count(*)::bigint AS n FROM "+table+" r WHERE "+value+" IS NOT NULL")
        if identity_sql is not None:key=identity_sql(catalog,"r",identity)
        elif catalog in CATALOGS:key=row_key(catalog,"r")
        elif "oid" in fields and fields["oid"]["kind"]=="self":key=identity(catalog,"r.oid")
        else:raise ValueError("compound_row_identity_callback_required")
        key=checked_local_sql(key)
        wire_rows.append("SELECT "+s(catalog)+" AS catalog,r.extensionoid::bigint AS extensionoid,"+key+" AS row_identity,jsonb_build_object('catalog',"+s(catalog)+",'extensionOid',r.extensionoid::bigint,'values',jsonb_build_object("+",".join(pairs)+")) AS wire FROM "+table+" r")
    addresses+=extras
    if "pg_class" in catalogs:
        unsupported.append("SELECT count(*)::bigint AS n FROM pg_class_scope r WHERE r.relkind NOT IN ('r','i','S','v','m','c','t') OR r.relispartition OR r.relrewrite<>0")
    if "pg_attribute" in catalogs:
        unsupported.append("SELECT count(*)::bigint AS n FROM pg_attribute_scope r WHERE r.attisdropped OR r.atthasmissing")
    if "pg_trigger" in catalogs:
        unsupported.append("SELECT count(*)::bigint AS n FROM pg_trigger_scope r WHERE r.tgisinternal")
    if "pg_partitioned_table" in catalogs:
        unsupported.append("SELECT count(*)::bigint AS n FROM pg_partitioned_table_scope")
    # Reusable polymorphic-address declarations; all are fixed catalog fields.
    for catalog in sorted({"pg_description","pg_init_privs","pg_seclabel"}&set(catalogs)):
        addresses.append("SELECT r.classoid::oid,r.objoid::oid,r.objsubid FROM "+q(catalog+"_scope")+" r WHERE r.objoid<>0")
    for catalog in sorted({"pg_depend","pg_shdepend"}&set(catalogs)):
        addresses += ["SELECT r.classid::oid,r.objid::oid,r.objsubid FROM "+q(catalog+"_scope")+" r WHERE r.objid<>0",
                      "SELECT r.refclassid::oid,r.refobjid::oid,"+("r.refobjsubid" if catalog=="pg_depend" else "0")+" FROM "+q(catalog+"_scope")+" r WHERE r.refobjid<>0"]
    native_identity="to_jsonb(pg_catalog.pg_identify_object_as_address(a.classid,a.objid,a.objsubid))"
    normalized=checked_local_sql(address_identity_sql("a",native_identity) if address_identity_sql else native_identity)
    proof=ordinary_roundtrip_sql("i")
    roundtrip=checked_local_sql(address_roundtrip_sql("i",proof) if address_roundtrip_sql else proof)
    enum_refs=""
    if "pg_enum" in catalogs:
        enum_refs=" UNION SELECT 'pg_enum',e.oid::bigint,0,"+row_key("pg_enum","e")+",(SELECT count(*)=1 FROM pg_catalog.pg_enum other WHERE other.enumtypid=e.enumtypid AND other.enumlabel=e.enumlabel) FROM pg_enum_scope e"
    inverse_types=",".join(s(x) for x in INVERSE_TYPES)
    selected_catalogs=",".join(s(c) for c in catalogs)
    text="""-- PRIVATE_GHA_ONLY merged catalog capture body. NEVER source connector/log/plaintext artifact.
WITH RECURSIVE private_wire_gate AS MATERIALIZED (
  SELECT current_setting('kova.private_extension_wire',true)='PRIVATE_GHA_CAPTURE_ONLY'
    AND current_setting('server_version_num')::integer=170006 AND current_setting('server_encoding')='UTF8'
    AND current_setting('transaction_read_only')='on' AND current_setting('transaction_isolation')='repeatable read'
    AND current_setting('search_path')='pg_catalog' AS allowed),
"""+common+",\n"+",\n".join(q(c+"_scope")+" AS MATERIALIZED (SELECT captured.* FROM ("+scopes[c]+") captured WHERE (SELECT allowed FROM private_wire_gate))" for c in catalogs)+""",
expected_columns(catalog,column_name,type,dimensions,not_null) AS (VALUES """+",".join(columns)+"""),
actual_columns AS (SELECT c.relname::text AS catalog,a.attname::text AS column_name,t.typname::text AS type,
  a.attndims::integer AS dimensions,a.attnotnull AS not_null FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='pg_catalog'
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  JOIN pg_catalog.pg_type t ON t.oid=a.atttypid WHERE c.relname IN ("""+selected_catalogs+""")),
column_differences AS ((SELECT * FROM expected_columns EXCEPT ALL SELECT * FROM actual_columns)
  UNION ALL (SELECT * FROM actual_columns EXCEPT ALL SELECT * FROM expected_columns)),
expected_foreign_keys AS (SELECT value FROM jsonb_array_elements("""+encoded_fks+""")),
actual_foreign_keys AS (SELECT jsonb_build_object('catalog',c.relname,'column_names',f.fkcols,
  'referenced_catalog',p.relname,'referenced_columns',f.pkcols,'is_array',f.is_array,'is_opt',f.is_opt) AS value
  FROM pg_catalog.pg_get_catalog_foreign_keys() f JOIN pg_catalog.pg_class c ON c.oid=f.fktable
  JOIN pg_catalog.pg_class p ON p.oid=f.pktable WHERE c.relname IN ("""+selected_catalogs+""")),
foreign_key_differences AS ((SELECT value FROM expected_foreign_keys EXCEPT ALL SELECT value FROM actual_foreign_keys)
  UNION ALL (SELECT value FROM actual_foreign_keys EXCEPT ALL SELECT value FROM expected_foreign_keys)),
raw_addresses(classid,objid,objsubid) AS ("""+" UNION ".join(addresses)+"""),
identities AS (SELECT a.*,"""+normalized+""" AS identity FROM raw_addresses a WHERE a.objid<>0),
inverse_addresses AS (SELECT i.*,CASE WHEN i.identity->>'type' IN ("""+inverse_types+""")
  AND jsonb_typeof(i.identity->'object_names')='array' AND jsonb_typeof(i.identity->'object_args')='array'
  THEN to_jsonb(pg_catalog.pg_get_object_address(i.identity->>'type',
    ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_names')),
    ARRAY(SELECT jsonb_array_elements_text(i.identity->'object_args')))) ELSE NULL END AS inverse FROM identities i),
checked_addresses AS (SELECT i.*,coalesce("""+roundtrip+""",false) AS roundtrip_ok FROM inverse_addresses i),
invalid_references AS ("""+" UNION ALL ".join(invalid or ["SELECT 0::bigint AS n"])+"""),
invalid_acls AS ("""+" UNION ALL ".join(acls or ["SELECT 0::bigint AS n"])+"""),
unsupported_values AS ("""+" UNION ALL ".join(unsupported or ["SELECT 0::bigint AS n"])+"""),
private_rows AS ("""+" UNION ALL ".join(wire_rows)+"""),
duplicate_row_keys AS (SELECT catalog,extensionoid,row_identity FROM private_rows
  GROUP BY catalog,extensionoid,row_identity HAVING count(*)<>1),
private_references AS (SELECT c.relname::text AS catalog,a.objid::bigint AS oid,a.objsubid AS subid,a.identity,a.roundtrip_ok AS roundtrip
  FROM checked_addresses a JOIN pg_catalog.pg_class c ON c.oid=a.classid"""+enum_refs+"""),
guards AS (SELECT NOT EXISTS(SELECT 1 FROM column_differences) AS columns_ok,
  NOT EXISTS(SELECT 1 FROM foreign_key_differences) AS foreign_keys_ok,
  NOT EXISTS(SELECT 1 FROM checked_addresses WHERE NOT roundtrip_ok OR identity IS NULL) AS addresses_ok,
  coalesce((SELECT sum(n) FROM invalid_references),0)=0 AS references_ok,
  coalesce((SELECT sum(n) FROM invalid_acls),0)=0 AS acls_ok,
  coalesce((SELECT sum(n) FROM unsupported_values),0)=0 AS unsupported_values_absent,
  NOT EXISTS(SELECT 1 FROM private_rows WHERE row_identity IS NULL) AS row_keys_present,
  NOT EXISTS(SELECT 1 FROM duplicate_row_keys) AS row_keys_unique,
  NOT EXISTS(SELECT 1 FROM sequence_ownership_failures) AS sequence_ownership_ok,
  NOT EXISTS(SELECT 1 FROM scope s JOIN pg_catalog.pg_class c ON c.oid=s.classid
    WHERE c.relname NOT IN ("""+selected_catalogs+""")) AS scoped_catalogs_covered)
SELECT CASE WHEN (SELECT allowed FROM private_wire_gate)
  AND (SELECT columns_ok AND foreign_keys_ok AND addresses_ok AND references_ok AND acls_ok
    AND unsupported_values_absent AND row_keys_present AND row_keys_unique AND sequence_ownership_ok AND scoped_catalogs_covered FROM guards)
THEN jsonb_build_object('operation','PRIVATE_GHA_ONLY-extension-all-catalog-wire','format',1,
  'privateRawWire',true,'serverVersionNum',current_setting('server_version_num')::integer,
  'sourceSnapshotSha256',encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'),
  'captureSnapshotBound',false,'querySha256MustBeBoundByPrivateWrapper',true,
  'qualificationReady',false,'customerRowsRead',false,'productionMutated',false,
  'nodeReferenceCoverageComplete',false,'typeLayoutsComplete',false,
  'catalogColumns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY catalog COLLATE "C",column_name COLLATE "C") FROM actual_columns a),
  'catalogForeignKeys',(SELECT jsonb_agg(value ORDER BY value::text COLLATE "C") FROM actual_foreign_keys),
  'catalogIdentities',(SELECT jsonb_agg(jsonb_build_object('catalog',c.relname,'oid',c.oid::bigint) ORDER BY c.relname COLLATE "C")
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='pg_catalog'
    WHERE c.oid IN (SELECT classid FROM raw_addresses) OR c.relname IN ("""+selected_catalogs+""")),
  'rows',(SELECT coalesce(jsonb_agg(wire ORDER BY catalog COLLATE "C",wire::text COLLATE "C"),'[]'::jsonb) FROM private_rows),
  'resolvedReferences',(SELECT coalesce(jsonb_agg(jsonb_build_object('catalog',catalog,'oid',oid,'subid',subid,'identity',identity,'roundtrip',roundtrip)
    ORDER BY catalog COLLATE "C",oid,subid),'[]'::jsonb) FROM private_references))
ELSE jsonb_build_object('operation','PRIVATE_GHA_ONLY-extension-all-catalog-wire','format',1,
  'ok',false,'error','private_wire_context_or_coverage_denied','privateRawWire',false,
  'qualificationReady',false,'customerRowsRead',false,'productionMutated',false) END::text;
"""
    return text


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",required=True)
    parser.add_argument("--existing-snapshot-body",action="store_true",
                        help="single WITH/SELECT for the caller's existing exported capture snapshot")
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location("routine_type_payloads",Path(__file__).with_name("extension-routine-type-payloads.py"))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    Path(args.output).write_text(build_query(module.MANIFESTS,transaction_wrapper=not args.existing_snapshot_body))


if __name__=="__main__":main()
