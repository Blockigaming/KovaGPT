#!/usr/bin/env python3
"""Strict PG17.6 routine/type/aggregate payload adapters for a private reader.

Catalog field/layout manifests are public PostgreSQL definitions. Actual object
names, ACLs, bodies, configuration and node text must remain in the independently
qualified private runner. Only aggregate hashes/counts may leave that process.
No SQL is executed here, no database is contacted, and no authority is granted.
"""
import hashlib
import json
import re

SERVER_VERSION_NUM=170006
FORMAT="pg17.6-routine-type-payload-v1"
HEX=re.compile(r"(?:[a-f0-9]{2})*\Z")
PHYSICAL_REASONS={"relfilenode":"cluster-local storage identifier","relpages":"planner storage page estimate",
 "reltuples":"planner row estimate","relallvisible":"visibility map page count",
 "relfrozenxid":"cluster-local transaction freeze horizon","relminmxid":"cluster-local multixact horizon"}
SCALAR_TYPES={"bool","char","int2","int4","int8","float4","float8","name","text","bytea",
              "xid","cid","xid8","pg_lsn","tid"}


class Stopped(Exception):pass


def require(ok,code):
    if not ok:raise Stopped(code)


def desc(type_name, *, nullable=False, kind="scalar", dimensions=0, ref=None, optional=False):
    value={"type":type_name,"dimensions":dimensions,"not_null":not nullable,"kind":kind}
    if ref is not None:value.update(ref=ref,optional=optional)
    return value


def ref(catalog, *, type_name="oid", optional=False):
    return desc(type_name,kind="ref",ref=catalog,optional=optional)


MANIFESTS={
 "pg_proc":{
    "oid":desc("oid",kind="self"),"proname":desc("name"),"pronamespace":ref("pg_namespace"),
    "proowner":ref("pg_authid"),"prolang":ref("pg_language"),"procost":desc("float4"),"prorows":desc("float4"),
    "provariadic":ref("pg_type",optional=True),"prosupport":ref("pg_proc",type_name="regproc",optional=True),
    "prokind":desc("char"),"prosecdef":desc("bool"),"proleakproof":desc("bool"),"proisstrict":desc("bool"),
    "proretset":desc("bool"),"provolatile":desc("char"),"proparallel":desc("char"),"pronargs":desc("int2"),
    "pronargdefaults":desc("int2"),"prorettype":ref("pg_type"),
    "proargtypes":desc("oidvector",kind="array_ref",dimensions=1,ref="pg_type"),
    "proallargtypes":desc("_oid",nullable=True,kind="array_ref",dimensions=1,ref="pg_type"),
    "proargmodes":desc("_char",nullable=True,kind="array_scalar",dimensions=1),
    "proargnames":desc("_text",nullable=True,kind="array_scalar",dimensions=1),
    "proargdefaults":desc("pg_node_tree",nullable=True,kind="node"),
    "protrftypes":desc("_oid",nullable=True,kind="array_ref",dimensions=1,ref="pg_type"),
    "prosrc":desc("text"),"probin":desc("text",nullable=True),
    "prosqlbody":desc("pg_node_tree",nullable=True,kind="node"),
    "proconfig":desc("_text",nullable=True,kind="array_scalar",dimensions=1),
    "proacl":desc("_aclitem",nullable=True,kind="acl",dimensions=1)},
 "pg_type":{
    "oid":desc("oid",kind="self"),"typname":desc("name"),"typnamespace":ref("pg_namespace"),
    "typowner":ref("pg_authid"),"typlen":desc("int2"),"typbyval":desc("bool"),"typtype":desc("char"),
    "typcategory":desc("char"),"typispreferred":desc("bool"),"typisdefined":desc("bool"),"typdelim":desc("char"),
    "typrelid":ref("pg_class",optional=True),"typsubscript":ref("pg_proc",type_name="regproc",optional=True),
    "typelem":ref("pg_type",optional=True),"typarray":ref("pg_type",optional=True),
    "typinput":ref("pg_proc",type_name="regproc"),"typoutput":ref("pg_proc",type_name="regproc"),
    "typreceive":ref("pg_proc",type_name="regproc",optional=True),"typsend":ref("pg_proc",type_name="regproc",optional=True),
    "typmodin":ref("pg_proc",type_name="regproc",optional=True),"typmodout":ref("pg_proc",type_name="regproc",optional=True),
    "typanalyze":ref("pg_proc",type_name="regproc",optional=True),"typalign":desc("char"),"typstorage":desc("char"),
    "typnotnull":desc("bool"),"typbasetype":ref("pg_type",optional=True),"typtypmod":desc("int4"),
    "typndims":desc("int4"),"typcollation":ref("pg_collation",optional=True),
    "typdefaultbin":desc("pg_node_tree",nullable=True,kind="node"),"typdefault":desc("text",nullable=True),
    "typacl":desc("_aclitem",nullable=True,kind="acl",dimensions=1)},
 "pg_aggregate":{
    "aggfnoid":ref("pg_proc",type_name="regproc"),"aggkind":desc("char"),"aggnumdirectargs":desc("int2"),
    "aggtransfn":ref("pg_proc",type_name="regproc"),"aggfinalfn":ref("pg_proc",type_name="regproc",optional=True),
    "aggcombinefn":ref("pg_proc",type_name="regproc",optional=True),"aggserialfn":ref("pg_proc",type_name="regproc",optional=True),
    "aggdeserialfn":ref("pg_proc",type_name="regproc",optional=True),"aggmtransfn":ref("pg_proc",type_name="regproc",optional=True),
    "aggminvtransfn":ref("pg_proc",type_name="regproc",optional=True),"aggmfinalfn":ref("pg_proc",type_name="regproc",optional=True),
    "aggfinalextra":desc("bool"),"aggmfinalextra":desc("bool"),"aggfinalmodify":desc("char"),"aggmfinalmodify":desc("char"),
    "aggsortop":ref("pg_operator",optional=True),"aggtranstype":ref("pg_type"),"aggtransspace":desc("int4"),
    "aggmtranstype":ref("pg_type",optional=True),"aggmtransspace":desc("int4"),
    "agginitval":desc("text",nullable=True),"aggminitval":desc("text",nullable=True)},
 "pg_enum":{
    "oid":desc("oid",kind="self"),"enumtypid":ref("pg_type"),"enumsortorder":desc("float4"),"enumlabel":desc("name")},
 "pg_range":{
    "rngtypid":ref("pg_type"),"rngsubtype":ref("pg_type"),"rngmultitypid":ref("pg_type"),
    "rngcollation":ref("pg_collation",optional=True),"rngsubopc":ref("pg_opclass"),
    "rngcanonical":ref("pg_proc",type_name="regproc",optional=True),
    "rngsubdiff":ref("pg_proc",type_name="regproc",optional=True)}
}
def foreign_keys_for(manifests):return sorted([
 {"catalog":catalog,"column_names":[column],"is_array":field["kind"]=="array_ref", "is_opt":field["optional"],
  "referenced_catalog":field["ref"],"referenced_columns":["oid"]}
 for catalog,fields in manifests.items() for column,field in fields.items() if field["kind"] in {"ref","array_ref"}
],key=lambda row:(row["catalog"],row["column_names"]))
FOREIGN_KEYS=foreign_keys_for(MANIFESTS)


def canonical_bytes(value):
    """Private canonical JSON; floats/bytes/custom objects are never coerced."""
    def valid(item):
        if item is None or type(item) in {bool,int,str}:return True
        if type(item) is list:return all(valid(x) for x in item)
        if type(item) is dict:return all(type(k) is str and valid(v) for k,v in item.items())
        return False
    require(valid(value),"canonical_payload_type_unqualified")
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")


def digest(value):return hashlib.sha256(canonical_bytes(value)).hexdigest()


def layout_columns(manifests=None):
    manifests=MANIFESTS if manifests is None else manifests
    return sorted([{"catalog":catalog,"column_name":name,**{k:field[k] for k in ["type","dimensions","not_null"]}}
                   for catalog,fields in manifests.items() for name,field in fields.items()],
                  key=lambda row:(row["catalog"],row["column_name"]))


def validate_layout(columns, foreign_keys, *, server_version_num,manifests=None,expected_foreign_keys=None):
    manifests=MANIFESTS if manifests is None else manifests
    require(server_version_num==SERVER_VERSION_NUM,"payload_pg17_patch_unqualified")
    require(type(columns) is list and type(foreign_keys) is list,"payload_catalog_layout_unqualified")
    require(all(type(row) is dict for row in columns+foreign_keys),"payload_catalog_layout_unqualified")
    expected=layout_columns(manifests);selected=[r for r in columns if r.get("catalog") in manifests]
    require(all(set(row)=={"catalog","column_name","type","dimensions","not_null"}
                and type(row["dimensions"]) is int and type(row["not_null"]) is bool for row in selected),
            "payload_catalog_layout_unqualified")
    require(sorted(selected,key=lambda row:(row["catalog"],row["column_name"]))==expected,
            "payload_catalog_columns_uncovered")
    actual=[r for r in foreign_keys if r.get("catalog") in manifests]
    expected_fks=foreign_keys_for(manifests) if expected_foreign_keys is None else expected_foreign_keys
    require(type(expected_fks) is list and all(type(row) is dict for row in expected_fks),
            "payload_catalog_foreign_keys_unqualified")
    expected_fks=[row for row in expected_fks if row.get("catalog") in manifests]
    def valid_fk(row):
        return set(row)=={"catalog","column_names","is_array","is_opt","referenced_catalog","referenced_columns"} \
            and type(row["catalog"]) is str and type(row["referenced_catalog"]) is str \
            and type(row["is_array"]) is bool and type(row["is_opt"]) is bool \
            and all(type(row[k]) is list and row[k] and all(type(v) is str and v for v in row[k])
                    for k in ["column_names","referenced_columns"]) \
            and len(row["column_names"])==len(row["referenced_columns"])
    require(all(valid_fk(row) for row in actual+expected_fks),"payload_catalog_foreign_keys_unqualified")
    require(sorted(actual,key=canonical_bytes)==sorted(expected_fks,key=canonical_bytes),
            "payload_catalog_foreign_keys_uncovered")
    return True


def identity(value):
    require(type(value) is dict and set(value)=={"type","object_names","object_args"}
            and type(value["type"]) is str and value["type"]
            and all(type(value[k]) is list and all(type(v) is str and "\x00" not in v for v in value[k])
                    for k in ["object_names","object_args"]),"payload_object_identity_unqualified")
    return json.loads(canonical_bytes(value))


class VerifiedResolver:
    """Wrap private native roundtrip evidence; never infer identity from a name.

    lookup(catalog,oid,subid) returns exactly {identity,roundtrip}. The latter
    must come from native inverse resolution to the original address. For
    pg_enum only, use the full parent-type/label identity and a native unique
    enumtypid+enumlabel inverse, since PostgreSQL has no enum-label address API.
    """
    def __init__(self,lookup,*,derived_validators=None):
        self.lookup=lookup;self.derived_validators={} if derived_validators is None else derived_validators
        require(type(self.derived_validators) is dict and all(type(k) is str and callable(v)
                for k,v in self.derived_validators.items()),"payload_derived_validators_unqualified")
    def __call__(self,catalog,oid,subid=0):
        require(type(catalog) is str and catalog.startswith("pg_") and type(oid) is int and 0<oid<=4294967295
                and type(subid) is int and subid<=2147483647
                and (subid>=0 or catalog=="pg_class" and -6<=subid<0),"payload_reference_address_unqualified")
        proof=self.lookup(catalog,oid,subid)
        require(type(proof) is dict and set(proof)=={"identity","roundtrip"} and proof["roundtrip"] is True,
                "payload_reference_roundtrip_missing")
        return self.canonical_identity(proof["identity"])

    def canonical_identity(self,value):
        if type(value) is dict and value.get("derived")=="enum-label":
            require(type(value) is dict and set(value)=={"derived","type","labelHex"}
                    and value["derived"]=="enum-label" and type(value["labelHex"]) is str
                    and len(value["labelHex"])<=126 and HEX.fullmatch(value["labelHex"]),"payload_enum_identity_unqualified")
            parent=identity(value["type"])
            require(parent["type"]=="type","payload_enum_parent_unqualified")
            try:label=bytes.fromhex(value["labelHex"]).decode("utf-8")
            except (ValueError,UnicodeError):raise Stopped("payload_enum_label_unqualified") from None
            require("\x00" not in label,"payload_enum_label_unqualified")
            return {"derived":"enum-label","type":parent,"labelHex":value["labelHex"]}
        if type(value) is dict and "derived" in value:
            tag=value["derived"]
            require(type(tag) is str and tag in self.derived_validators,"payload_derived_identity_unqualified")
            normalized=self.derived_validators[tag](value,self.canonical_identity)
            require(type(normalized) is dict and normalized.get("derived")==tag,"payload_derived_identity_unqualified")
            return json.loads(canonical_bytes(normalized))
        return identity(value)


def scalar(value, field):
    require(field["type"] in SCALAR_TYPES or field["type"]=="oid" and field.get("kind")=="excluded_physical",
            "payload_scalar_type_unimplemented")
    require(type(value) is dict and set(value)=={"isNull","bytesHex"} and type(value["isNull"]) is bool,
            "payload_scalar_shape_unqualified")
    if value["isNull"]:
        require(not field["not_null"] and value["bytesHex"] is None,"payload_scalar_null_unqualified")
    else:
        raw=value["bytesHex"]
        require(type(raw) is str and HEX.fullmatch(raw) and len(raw)<=16*1024**2,"payload_scalar_bytes_unqualified")
        fixed={"bool":1,"char":1,"int2":2,"int4":4,"float4":4,"int8":8,"float8":8,
               "oid":4,"xid":4,"cid":4,"xid8":8,"pg_lsn":8,"tid":6}
        require(field["type"] not in fixed or len(raw)==fixed[field["type"]]*2,"payload_scalar_width_unqualified")
        if field["type"]=="bool":require(raw in {"00","01"},"payload_boolean_bytes_unqualified")
    return {"kind":"scalar","type":field["type"],**value}


def reference(value, field, resolver):
    if value is None:
        require(not field["not_null"],"payload_reference_null_unqualified")
        return {"catalog":field["ref"],"state":"sql-null"}
    require(type(value) is int and 0<=value<=4294967295,"payload_reference_oid_unqualified")
    if value==0:
        require(field["optional"],"payload_mandatory_reference_zero")
        return {"catalog":field["ref"],"state":"zero"}
    return {"catalog":field["ref"],"state":"object","identity":resolver(field["ref"],value,0)}


def array_shape(value, field):
    if value is None:
        require(not field["not_null"],"payload_array_null_unqualified")
        return None
    require(type(value) is dict and set(value)=={"dimensions","items"} and type(value["dimensions"]) is list
            and len(value["dimensions"])<=6 and type(value["items"]) is list,"payload_array_shape_unqualified")
    vector=field["type"] in {"oidvector","int2vector"}
    require(not vector or len(value["dimensions"])==1 and type(value["dimensions"][0]) is dict
            and value["dimensions"][0].get("lower")==0,
            "payload_oidvector_shape_unqualified")
    size=1 if value["dimensions"] else 0
    for dimension in value["dimensions"]:
        require(type(dimension) is dict and set(dimension)=={"lower","length"}
                and type(dimension["lower"]) is int and -2147483648<=dimension["lower"]<=2147483647
                and type(dimension["length"]) is int and (0 if vector else 1)<=dimension["length"]<=1000000,
                "payload_array_dimensions_unqualified")
        require(dimension["lower"]+dimension["length"]-1<=2147483647,"payload_array_dimensions_unqualified")
        size*=dimension["length"]
    require(size==len(value["items"]) and size<=1000000,"payload_array_coverage_unqualified")
    return value


def acl(value, field, resolver):
    array=array_shape(value,field)
    if array is None:return {"kind":"acl","isNull":True}
    items=[]
    for item in array["items"]:
        if item is None:items.append(None);continue
        require(type(item) is dict and set(item)=={"textHex","roundtrip","entries"}
                and item["roundtrip"] is True and type(item["textHex"]) is str and HEX.fullmatch(item["textHex"])
                and type(item["entries"]) is list and item["entries"],"payload_acl_roundtrip_unqualified")
        entries=[]
        for row in item["entries"]:
            require(type(row) is dict and set(row)=={"grantor","grantee","privilege","isGrantable"}
                    and type(row["grantor"]) is int and row["grantor"]>0 and type(row["grantee"]) is int and row["grantee"]>=0
                    and type(row["privilege"]) is str and row["privilege"] and type(row["isGrantable"]) is bool,
                    "payload_acl_entry_unqualified")
            entries.append({"grantor":resolver("pg_authid",row["grantor"],0),
                "grantee":resolver("pg_authid",row["grantee"],0) if row["grantee"] else {"public":True},
                "privilege":row["privilege"],"isGrantable":row["isGrantable"]})
        require(len({canonical_bytes(row) for row in entries})==len(entries),"payload_acl_duplicate_entry")
        items.append({"textHex":item["textHex"],"entries":sorted(entries,key=canonical_bytes)})
    return {"kind":"acl","isNull":False,"dimensions":array["dimensions"],"items":items}


def canonicalize_row(row, resolver, *, canonicalize_tree=None, type_layouts=None,datum_layout=None,
                     manifests=None,identity_selector=None,field_adapters=None,context=None):
    """Consume the documented private wire format; never print its values."""
    require(isinstance(resolver,VerifiedResolver),"payload_verified_resolver_required")
    manifests=MANIFESTS if manifests is None else manifests
    field_adapters={} if field_adapters is None else field_adapters
    context={} if context is None else context
    require(type(manifests) is dict and type(field_adapters) is dict and type(context) is dict,
            "payload_adapter_configuration_unqualified")
    builtins={"self","scalar","ref","array_ref","array_scalar","acl","node","excluded_physical",
              "unsupported_nullable","null_only"}
    require(all(type(key) is str and key not in builtins and callable(value) for key,value in field_adapters.items()),
            "payload_builtin_adapter_override_forbidden")
    require(type(row) is dict and set(row)=={"catalog","extensionOid","values"}
            and row["catalog"] in manifests and type(row["values"]) is dict,"payload_row_shape_unqualified")
    catalog=row["catalog"];values=row["values"];manifest=manifests[catalog]
    require(set(values)==set(manifest),"payload_row_columns_uncovered")
    result={}
    for name,field in manifest.items():
        value=values[name];kind=field["kind"]
        if kind=="excluded_physical":
            require(catalog=="pg_class" and name in PHYSICAL_REASONS and field.get("reason")==PHYSICAL_REASONS[name],
                    "payload_physical_exclusion_unqualified")
            scalar(value,field)  # Captured bytes still have a complete typed wire.
            result[name]={"kind":"excluded_physical","type":field["type"],"reason":field["reason"]}
        elif kind in {"unsupported_nullable","null_only"}:
            require(value is None and not field["not_null"],"payload_nonnull_type_adapter_unimplemented")
            result[name]={"kind":"null_only","type":field["type"],"isNull":True}
        elif kind in field_adapters:
            require(callable(field_adapters[kind]),"payload_custom_adapter_unqualified")
            result[name]=field_adapters[kind](catalog,name,value,field,values,resolver,context)
            require(type(result[name]) is dict and result[name],"payload_custom_adapter_unqualified")
            canonical_bytes(result[name])
        elif kind=="self":result[name]=resolver(catalog,value,0)
        elif kind=="scalar":result[name]=scalar(value,field)
        elif kind=="ref":result[name]=reference(value,field,resolver)
        elif kind in {"array_ref","array_scalar"}:
            array=array_shape(value,field)
            if array is None:result[name]={"kind":kind,"isNull":True};continue
            if kind=="array_ref":items=[reference(x,{**field,"not_null":True},resolver) for x in array["items"]]
            else:
                element={"type":"int2" if field["type"]=="int2vector" else field["type"][1:],"not_null":False}
                items=[scalar(x,element) for x in array["items"]]
            result[name]={"kind":kind,"isNull":False,"dimensions":array["dimensions"],"items":items}
        elif kind=="acl":result[name]=acl(value,field,resolver)
        elif kind=="node":
            if value is None:
                require(not field["not_null"],"payload_node_null_unqualified")
                result[name]={"kind":"node","isNull":True}
            else:
                require(type(value) is str and len(value)<=16*1024**2 and callable(canonicalize_tree),
                        "payload_node_canonicalizer_required")
                result[name]={"kind":"node","isNull":False,
                    "tree":canonicalize_tree(value,resolver,type_layouts,datum_layout=datum_layout)}
                canonical_bytes(result[name])
        else:raise Stopped("payload_field_adapter_unimplemented")
    key=identity_selector(catalog,result,values,resolver) if callable(identity_selector) else None
    if key is None:
        if catalog in {"pg_proc","pg_type","pg_enum"}:key=result["oid"]
        elif catalog=="pg_aggregate":key=result["aggfnoid"]["identity"]
        elif catalog=="pg_range":key=result["rngtypid"]["identity"]
        else:raise Stopped("payload_identity_selector_required")
    require(type(key) is dict and key,"payload_identity_selector_unqualified")
    canonical_bytes(key)
    if catalog=="pg_enum":
        require(key["type"]==result["enumtypid"]["identity"] and key["labelHex"]==result["enumlabel"]["bytesHex"],
                "payload_enum_identity_value_mismatch")
    return {"format":FORMAT,"catalog":catalog,"extension":resolver("pg_extension",row["extensionOid"],0),
            "identity":key,"columns":result}


def record_row_identity(keys,payload):
    """Keep identical pg_depend rows as a multiset; reject every ambiguous key.

    pg_depend has no unique row constraint. Preserve every identical canonical
    dependency row in the caller's list so its count and digest bind the exact
    multiplicity. All other catalog identities still occur exactly once.
    """
    key=canonical_bytes({k:payload[k] for k in ["catalog","extension","identity"]})
    encoded=canonical_bytes(payload)
    previous=keys.get(key)
    require(previous is None or (payload["catalog"]=="pg_depend" and previous==encoded),
            "payload_duplicate_identity")
    keys[key]=encoded


def hash_rows(rows,resolver,*,catalog_columns,catalog_foreign_keys,server_version_num,
              canonicalize_tree=None,type_layouts=None,datum_layout=None,manifests=None,
              identity_selector=None,field_adapters=None,context=None,expected_foreign_keys=None):
    manifests=MANIFESTS if manifests is None else manifests
    validate_layout(catalog_columns,catalog_foreign_keys,server_version_num=server_version_num,manifests=manifests,
                    expected_foreign_keys=expected_foreign_keys)
    require(type(rows) is list,"payload_row_collection_unqualified")
    grouped={catalog:[] for catalog in manifests};keys={}
    for row in rows:
        payload=canonicalize_row(row,resolver,canonicalize_tree=canonicalize_tree,type_layouts=type_layouts,datum_layout=datum_layout,
            manifests=manifests,identity_selector=identity_selector,field_adapters=field_adapters,context=context)
        record_row_identity(keys,payload)
        grouped[payload["catalog"]].append(payload)
    # Only this hash/count receipt may leave the private caller.
    return {"operation":"private-routine-type-payload-hashes","format":FORMAT,
        "catalogs":[{"catalog":catalog,"count":len(payloads),"sha256":digest(sorted(payloads,key=canonical_bytes))}
                    for catalog,payloads in sorted(grouped.items())],
        "rawValuesReturned":False,"customerRowsRead":False,"qualificationReady":False,
        "wholeExtensionSurfaceCovered":False,"productionMutated":False}
