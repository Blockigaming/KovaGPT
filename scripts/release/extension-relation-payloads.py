#!/usr/bin/env python3
"""Public PG17.6 relation/operator catalog adapters; private values stay private.

Native source/target readers must prove every resolved identity, unique owner
backlink and complete same-snapshot wire. These pure validators cannot create
such evidence. Only the six named storage/statistics fields are excluded; all
other columns and compound foreign-key metadata remain covered or reject.
"""
import json
import importlib.util
from pathlib import Path
import re

_definition=json.loads(Path(__file__).with_name("pg17-extension-relation-manifest.json").read_bytes())
MANIFESTS=_definition["catalogs"]
FOREIGN_KEYS=_definition["foreignKeys"]
PHYSICAL_EXCLUSIONS=_definition["physicalExclusions"]
HEX=re.compile(r"(?:[a-f0-9]{2})*\Z")
CATALOG=re.compile(r"pg_[a-z0-9_]+\Z")


class Stopped(Exception):pass


def require(value,code):
    if not value:raise Stopped(code)


def canonical_bytes(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")


def scalar_int(value,width):
    require(type(value) is dict and set(value)=={"isNull","bytesHex"}
            and value["isNull"] is False and type(value["bytesHex"]) is str
            and HEX.fullmatch(value["bytesHex"]) and len(value["bytesHex"])==width*2,
            "relation_integer_wire_unqualified")
    return int.from_bytes(bytes.fromhex(value["bytesHex"]),"big",signed=True)


def normalized_int(value,width):
    require(type(value) is dict and value.get("kind")=="scalar", "relation_integer_cell_unqualified")
    return scalar_int({k:value[k] for k in ["isNull","bytesHex"]},width)


def normalized_hex(value):
    require(type(value) is dict and value.get("kind")=="scalar" and value.get("isNull") is False
            and type(value.get("bytesHex")) is str and HEX.fullmatch(value["bytesHex"]),
            "relation_scalar_cell_unqualified")
    return value["bytesHex"]


def reference_identity(value):
    require(type(value) is dict and value.get("state")=="object" and type(value.get("identity")) is dict,
            "relation_reference_cell_unqualified")
    return value["identity"]


def owned_toast_identity(value,normalize):
    require(type(value) is dict and set(value)=={"derived","owner","kind"}
            and value["derived"]=="owned-toast-relation" and value["kind"] in {"table","index"},
            "relation_toast_identity_unqualified")
    owner=normalize(value["owner"])
    require(set(owner)=={"type","object_names","object_args"}
            and owner["type"] in {"table","materialized view"}, "relation_toast_owner_unqualified")
    return {"derived":"owned-toast-relation","owner":owner,"kind":value["kind"]}


def composite_identity(value,normalize):
    require(type(value) is dict and set(value)=={"derived","type"}
            and value["derived"]=="composite-relation", "relation_composite_identity_unqualified")
    parent=normalize(value["type"])
    require(set(parent)=={"type","object_names","object_args"} and parent["type"]=="type",
            "relation_composite_parent_unqualified")
    return {"derived":"composite-relation","type":parent}


def column_identity(value,normalize):
    require(type(value) is dict and set(value)=={"derived","relation","number","nameHex"}
            and value["derived"]=="relation-column" and type(value["number"]) is int
            and -6<=value["number"]<=32767 and value["number"]!=0
            and type(value["nameHex"]) is str and HEX.fullmatch(value["nameHex"])
            and 0<len(value["nameHex"])<=126, "relation_column_identity_unqualified")
    try:name=bytes.fromhex(value["nameHex"]).decode("utf-8")
    except (ValueError,UnicodeError):raise Stopped("relation_column_name_unqualified") from None
    require(name and "\x00" not in name,"relation_column_name_unqualified")
    relation=normalize(value["relation"])
    require(relation.get("derived") in {"owned-toast-relation","composite-relation"}
            or set(relation)=={"type","object_names","object_args"}
            and relation["type"] in {"table","index","view","materialized view","sequence","foreign table"},
            "relation_column_parent_unqualified")
    return {"derived":"relation-column","relation":relation,"number":value["number"],"nameHex":value["nameHex"]}


DERIVED_VALIDATORS={"owned-toast-relation":owned_toast_identity,
                    "composite-relation":composite_identity,"relation-column":column_identity}


def conditional_owned_name(core):
    def adapt(catalog,column,value,field,raw_values,resolver,context):
        require(catalog=="pg_class" and column=="relname" and field["type"]=="name",
                "relation_conditional_name_scope_unqualified")
        raw=core.scalar(value,field)
        object_identity=resolver("pg_class",raw_values["oid"],0)
        if object_identity.get("derived")=="owned-toast-relation":
            # Native roundtrip must additionally prove the actual generated
            # pg_toast_<ownerOID>[/_index] name, unique owner backlink, correct
            # namespace/kind and one valid unique index. A rename is rejected
            # by the reader; this adapter never infers a physical name pattern.
            return {"kind":"owned-physical-name","identity":object_identity,
                    "reason":"native unique owner and generated TOAST name"}
        return raw
    return adapt


def polymorphic_reference(catalog,column,value,field,raw_values,resolver,context):
    require(field.get("kind")=="polymorphic_ref" and field.get("class_field") in raw_values
            and type(value) is int and 0<value<2**32,"relation_polymorphic_reference_unqualified")
    class_oid=raw_values[field["class_field"]]
    require(type(class_oid) is int and 0<class_oid<2**32,"relation_polymorphic_class_unqualified")
    class_identity=resolver("pg_class",class_oid,0)
    names=class_identity.get("object_names")
    require(set(class_identity)=={"type","object_names","object_args"} and class_identity["type"]=="table"
            and type(names) is list and len(names)==2 and names[0]=="pg_catalog"
            and CATALOG.fullmatch(names[1]) and class_identity["object_args"]==[],
            "relation_polymorphic_catalog_unqualified")
    subfield=field.get("subid_field")
    subid=scalar_int(raw_values[subfield],4) if subfield is not None else 0
    require(0<=subid<=2147483647 or names[1]=="pg_class" and -6<=subid<=-1,
            "relation_polymorphic_subobject_unqualified")
    return {"kind":"polymorphic-reference","catalog":class_identity,
            "object":resolver(names[1],value,subid)}


def identity_selector(catalog,columns,raw_values,resolver):
    if catalog not in MANIFESTS:return None
    if catalog=="pg_class":
        kind=bytes.fromhex(normalized_hex(columns["relkind"]))
        require(kind in {b"r",b"i",b"S",b"v",b"m",b"c",b"t"}
                and normalized_hex(columns["relispartition"])=="00" and raw_values["relrewrite"]==0,
                "relation_partition_foreign_or_rewrite_unimplemented")
    if catalog=="pg_attribute":
        require(normalized_hex(columns["attisdropped"])=="00"
                and normalized_hex(columns["atthasmissing"])=="00",
                "relation_dropped_or_missing_attribute_unimplemented")
    if catalog=="pg_trigger":
        require(normalized_hex(columns["tgisinternal"])=="00","relation_internal_trigger_unimplemented")
    if catalog=="pg_partitioned_table":raise Stopped("relation_partition_surface_unimplemented")
    if "oid" in MANIFESTS[catalog]:
        return columns["oid"]
    if catalog=="pg_attribute":
        return column_identity({"derived":"relation-column","relation":reference_identity(columns["attrelid"]),
                "number":normalized_int(columns["attnum"],2),"nameHex":normalized_hex(columns["attname"])},
                resolver.canonical_identity)
    parent_keys={"pg_index":"indexrelid","pg_sequence":"seqrelid","pg_partitioned_table":"partrelid"}
    if catalog in parent_keys:return reference_identity(columns[parent_keys[catalog]])
    if catalog=="pg_inherits":
        return {"child":reference_identity(columns["inhrelid"]),"parent":reference_identity(columns["inhparent"]),
                "sequence":normalized_int(columns["inhseqno"],4)}
    if catalog in {"pg_description","pg_init_privs","pg_seclabel"}:
        key={"object":columns["objoid"],"subid":normalized_int(columns["objsubid"],4)}
        if catalog=="pg_init_privs":key["privilegeType"]=normalized_hex(columns["privtype"])
        if catalog=="pg_seclabel":key["provider"]=normalized_hex(columns["provider"])
        return key
    if catalog in {"pg_depend","pg_shdepend"}:
        key={"dependent":columns["objid"],"referenced":columns["refobjid"],
             "dependencyType":normalized_hex(columns["deptype"])}
        if catalog=="pg_shdepend":key["database"]=columns["dbid"]
        return key
    raise Stopped("relation_primary_identity_unimplemented")


def adapter_options(core):
    """Pass this configuration to one shared strict core module instance."""
    require(core.PHYSICAL_REASONS==PHYSICAL_EXCLUSIONS,"relation_physical_policy_unqualified")
    merged={**core.MANIFESTS,**MANIFESTS}
    foreign=core.foreign_keys_for(core.MANIFESTS)+FOREIGN_KEYS
    return {"manifests":merged,"expected_foreign_keys":foreign,"identity_selector":identity_selector,
            "field_adapters":{"conditional_owned_name":conditional_owned_name(core),
                              "polymorphic_ref":polymorphic_reference}}


def query_hooks():
    spec=importlib.util.spec_from_file_location("kova_extension_relation_query_hooks",
        Path(__file__).with_name("extension-relation-query-hooks.py"))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def capture_query_options(core,generator):
    """Use build_capture_all_private_wire_query(**capture_query_options(...))."""
    hooks=query_hooks();options=adapter_options(core)
    return {"manifests":options["manifests"],"common_ctes":hooks.common_ctes(generator),
            "catalog_foreign_keys":options["expected_foreign_keys"],"identity_sql":hooks.row_identity_sql,
            "address_identity_sql":hooks.address_identity_sql,"address_roundtrip_sql":hooks.address_roundtrip_sql}


def lazy_reference_query(requests,core,generator):
    """PRIVATE same-snapshot body; never a source-connector or public API."""
    return query_hooks().lazy_reference_query(requests,generator,adapter_options(core)["manifests"])
