#!/usr/bin/env python3
"""Strict private PG17.6 nodeToString canonicalization; no I/O or authority.

The caller must bind the schema/module bytes, resolver metadata, architecture
evidence and private payload to one reviewed snapshot. This module never
connects, executes SQL, logs payloads or claims source/image equivalence.
"""
import json
from pathlib import Path
import re

_schema = json.loads(Path(__file__).with_name("pg17-extension-node-schema.json").read_bytes())
SCHEMA = _schema["nodes"]
FIELD_ORDERS = _schema["fieldOrders"]
MAX_BYTES = 2 * 1024**2
MAX_TOKENS = 200000
MAX_DEPTH = 128
INTEGER = re.compile(r"-?(?:0|[1-9][0-9]*)\Z")
PG_WHITESPACE = " \n\t"  # REL_17_6 pg_strtok, not Python/Unicode whitespace.
PG_DELIMITERS = "{}()"  # Brackets are ordinary token characters in read.c.


class Unsupported(Exception):
    """Only a fixed code, never input values, is exposed by this module."""


def require(value, code):
    if not value:
        raise Unsupported(code)


def integer(value):
    require(isinstance(value, str) and len(value)<=21 and INTEGER.fullmatch(value), "node_integer_unqualified")
    number = int(value)
    require(-(2**63) <= number < 2**64, "node_integer_out_of_range")
    return number


def tokenize(text):
    require(isinstance(text, str) and len(text.encode("utf-8")) <= MAX_BYTES and "\x00" not in text,
            "node_input_bound")
    result = []
    index = 0
    while index < len(text):
        if text[index] in PG_WHITESPACE:
            index += 1
            continue
        if text[index] in PG_DELIMITERS:
            result.append(text[index]);index += 1
        else:
            start = index
            while index < len(text) and text[index] not in PG_WHITESPACE and text[index] not in PG_DELIMITERS:
                if text[index] == "\\":
                    require(index+1 < len(text), "node_trailing_escape")
                    index += 2
                else:
                    index += 1
            result.append(text[start:index])
        require(len(result) <= MAX_TOKENS, "node_token_bound")
    return result


class Reader:
    def __init__(self, text):
        self.tokens = tokenize(text)
        self.index = 0

    def take(self):
        require(self.index < len(self.tokens), "node_truncated")
        value = self.tokens[self.index];self.index += 1
        return value

    def peek(self):
        require(self.index < len(self.tokens), "node_truncated")
        return self.tokens[self.index]

    def value(self, depth=0):
        require(depth <= MAX_DEPTH, "node_depth_bound")
        token = self.take()
        if token == "{":
            tag = self.take()
            require(tag in SCHEMA, "node_tag_unsupported")
            fields = {}
            while self.peek() != "}":
                key = self.take()
                require(re.fullmatch(r":[A-Za-z][A-Za-z0-9_]*", key), "node_field_syntax")
                key = key[1:]
                require(key not in fields, "node_duplicate_field")
                if tag == "CONST" and key == "constvalue" and self.peek() != "<>":
                    size = integer(self.take())
                    require(0 <= size <= MAX_BYTES and self.take() == "[", "node_datum_syntax")
                    values = []
                    while self.peek() != "]":
                        value = integer(self.take())
                        require(-128 <= value <= 255, "node_datum_byte_invalid")
                        values.append(value % 256)
                        require(len(values) <= MAX_BYTES, "node_datum_bound")
                    self.take()
                    fields[key] = {"datumSize":size,"bytes":bytes(values)}
                else:
                    fields[key] = self.value(depth+1)
            self.take()
            return {"node":tag,"fields":fields}
        if token == "(":
            items = []
            while self.peek() != ")":
                items.append(self.value(depth+1))
            self.take()
            return {"list":items}
        require(token not in {"}", ")"}, "node_delimiter_unexpected")
        return token


def parse_tree(text):
    reader = Reader(text)
    value = reader.value()
    require(reader.index == len(reader.tokens), "node_trailing_payload")
    return value


def validate_identity(identity):
    require(isinstance(identity, dict) and set(identity) == {"type","object_names","object_args"}
            and isinstance(identity["type"], str) and identity["type"]
            and all(isinstance(identity[k], list) and all(isinstance(s,str) for s in identity[k])
                    for k in ["object_names","object_args"]), "node_reference_identity_unqualified")
    return identity


class Canonicalizer:
    def __init__(self, resolver, type_layouts, datum_layout=None):
        require(callable(resolver) and isinstance(type_layouts, dict), "node_resolver_unqualified")
        self.resolver = resolver
        self.type_layouts = type_layouts
        self.datum_layout = datum_layout

    def reference(self, catalog, value):
        oid = integer(value) if isinstance(value,str) else value
        require(type(oid) is int and 0 <= oid < 2**32, "node_oid_unqualified")
        if oid == 0:
            return {"absentOid":True}
        try:
            identity = self.resolver(catalog, oid, 0)
        except Exception:
            raise Unsupported("node_reference_unresolved") from None
        if isinstance(identity,dict) and "derived" in identity:
            normalize=getattr(self.resolver,"canonical_identity",None)
            require(catalog=="pg_class" and identity["derived"] in
                    {"owned-toast-relation","composite-relation","relation-column"} and callable(normalize),
                    "node_derived_reference_unqualified")
            try:normalized=normalize(identity)
            except Exception:raise Unsupported("node_derived_reference_unqualified") from None
            require(isinstance(normalized,dict) and normalized.get("derived")==identity["derived"],
                    "node_derived_reference_unqualified")
            return normalized
        return validate_identity(identity)

    def layout(self, oid):
        require(type(oid) is int and oid in self.type_layouts, "node_const_layout_missing")
        layout = self.type_layouts[oid]
        require(isinstance(layout,dict) and layout.get("identity") == self.reference("pg_type",oid)
                and type(layout.get("length")) is int and type(layout.get("by_value")) is bool
                and layout.get("kind") in {"b","d","e","c","p","r","m"},
                "node_const_layout_unqualified")
        return layout

    def datum_platform(self):
        value = self.datum_layout
        require(isinstance(value,dict) and value.get("byteorder") in {"little","big"}
                and value.get("datum_bytes") == 8
                and value.get("server_encoding") == "UTF8"
                and isinstance(value.get("evidence_sha256"),str)
                and re.fullmatch(r"[a-f0-9]{64}",value.get("evidence_sha256","")),
                "node_datum_platform_unqualified")
        return value["byteorder"]

    def oid_list(self, raw, catalog):
        if raw == "<>":
            return {"nullList":True}
        require(isinstance(raw,dict) and set(raw)=={"list"} and raw["list"]
                and raw["list"][0] == "o", "node_oid_list_unqualified")
        return {"oidList":[self.reference(catalog,item) for item in raw["list"][1:]]}

    def value(self, value, depth=0):
        require(depth <= MAX_DEPTH, "node_depth_bound")
        if isinstance(value,str):
            return {"atom":value}
        if isinstance(value,dict) and set(value)=={"list"}:
            # A context-free OidList has no reference class. Never leave its
            # numeric payload unchanged and pretend the OIDs are semantic.
            require(not value["list"] or value["list"][0] != "o", "node_oid_list_class_missing")
            return {"list":[self.value(v,depth+1) for v in value["list"]]}
        require(isinstance(value,dict) and set(value)=={"node","fields"}, "node_value_unqualified")
        tag,fields = value["node"],value["fields"]
        specification = SCHEMA[tag]
        field_order = FIELD_ORDERS[tag]
        if tag == "RANGETBLENTRY":
            kind = fields.get("rtekind")
            require(isinstance(kind,str) and kind in specification["variants"], "node_rte_kind_unsupported")
            specification = {**specification["common"],**specification["variants"][kind]}
            field_order = field_order["prefix"]+field_order["variants"][kind]+field_order["suffix"]
        require(set(fields) == set(specification), "node_field_coverage_mismatch")
        # PG's readers consume fields in serialization order; their labels are
        # not a license to reorder a stored tree and change its interpretation.
        require(list(fields)==field_order,"node_field_order_mismatch")
        out = {}
        for key,adapter in specification.items():
            raw = fields[key]
            if adapter.startswith("oid:"):
                out[key] = self.reference(adapter.split(":",1)[1],raw)
            elif adapter.startswith("oid_list:"):
                out[key] = self.oid_list(raw,adapter.split(":",1)[1])
            elif adapter == "int":
                out[key] = integer(raw)
            elif adapter == "bool":
                require(isinstance(raw,str) and raw in {"true","false"}, "node_boolean_unqualified")
                out[key] = raw == "true"
            elif adapter == "boolop":
                require(isinstance(raw,str) and raw in {"and","or","not"}, "node_boolop_unqualified")
                out[key] = raw
            elif adapter == "atom":
                require(isinstance(raw,str), "node_atom_unqualified")
                out[key] = {"atom":raw}
            elif adapter == "datum":
                out[key] = self.const_datum(fields)
            elif adapter == "value":
                out[key] = self.value(raw,depth+1)
            else:
                raise Unsupported("node_field_adapter_unsupported")
        return {"node":tag,"fields":out}

    def const_datum(self, fields):
        type_oid = integer(fields["consttype"])
        layout = self.layout(type_oid)
        require(isinstance(fields["constbyval"],str) and fields["constbyval"] in {"true","false"}
                and isinstance(fields["constisnull"],str) and fields["constisnull"] in {"true","false"}
                and integer(fields["constlen"]) == layout["length"]
                and (fields["constbyval"]=="true") == layout["by_value"],
                "node_const_shape_mismatch")
        raw = fields["constvalue"]
        if fields["constisnull"] == "true":
            require(raw == "<>", "node_null_const_has_payload")
            return {"null":True}
        require(isinstance(raw,dict) and set(raw)=={"datumSize","bytes"}, "node_const_datum_missing")
        byteorder = self.datum_platform()
        data = raw["bytes"]
        length = layout["length"]
        require(raw["datumSize"] == (length if length>0 else len(data))
                and len(data) == (8 if layout["by_value"] else raw["datumSize"]),
                "node_const_datum_size_mismatch")
        # Domains have the base type's datum representation, but keep the
        # domain identity in consttype and prove each base link explicitly.
        visited = {type_oid}
        while layout["kind"] == "d":
            base_raw=layout.get("base_type_oid",0)
            base=integer(base_raw) if isinstance(base_raw,str) else base_raw
            require(type(base) is int and 0<=base<2**32,"node_domain_base_unqualified")
            require(base not in visited and base>0, "node_domain_base_unqualified")
            visited.add(base)
            parent = self.layout(base)
            require(parent["length"]==layout["length"] and parent["by_value"]==layout["by_value"],
                    "node_domain_layout_mismatch")
            layout = parent
        identity = layout["identity"]
        names = identity["object_names"]
        name = names[0] if identity["type"]=="type" and len(names)==1 and not identity["object_args"] else ""
        aliases = {"boolean":"bool","integer":"int4","smallint":"int2","bigint":"int8",
                   'pg_catalog."char"':"char"}
        name = aliases.get(name,name.removeprefix("pg_catalog."))
        if layout["kind"] == "e":
            require(length==4 and layout["by_value"], "node_enum_layout_unqualified")
            value = self.unsigned_word(data,4,byteorder)
            try:
                enum = self.resolver("pg_enum",value,0)
            except Exception:
                raise Unsupported("node_enum_reference_unresolved") from None
            require(isinstance(enum,dict) and set(enum)=={"derived","type","labelHex"}
                    and enum["derived"]=="enum-label" and enum["type"]==identity
                    and isinstance(enum["labelHex"],str) and re.fullmatch(r"(?:[a-f0-9]{2})*",enum["labelHex"]),
                    "node_enum_reference_unqualified")
            return {"enum":enum}
        require(layout["kind"]=="b" and not layout.get("is_composite",False), "node_const_type_unsupported")
        refs={"oid":None,"regclass":"pg_class","regtype":"pg_type","regproc":"pg_proc",
              "regprocedure":"pg_proc","regoper":"pg_operator","regoperator":"pg_operator",
              "regnamespace":"pg_namespace","regrole":"pg_authid","regcollation":"pg_collation"}
        if name in refs:
            require(length==4 and layout["by_value"], "node_oid_const_layout_unqualified")
            value = self.unsigned_word(data,4,byteorder)
            # A bare oid has no catalog type. Require a separate reviewed
            # constant binding; do not guess class from coincidental numbers.
            catalog = refs[name]
            if catalog is None:
                raise Unsupported("node_bare_oid_const_class_missing")
            return {"reference":self.reference(catalog,value)}
        if name in {"bool","char","int2","int4","int8"}:
            width={"bool":1,"char":1,"int2":2,"int4":4,"int8":8}[name]
            require(length==width and layout["by_value"], "node_integer_const_layout_unqualified")
            raw_value = data[:width] if byteorder=="little" else data[-width:]
            padding = data[width:] if byteorder=="little" else data[:-width]
            signed = name not in {"bool","char"}
            value = int.from_bytes(raw_value,byteorder,signed=signed)
            require(not padding or all(b==(255 if signed and value<0 else 0) for b in padding),
                    "node_integer_const_padding_unqualified")
            require(name!="bool" or value in {0,1}, "node_boolean_const_unqualified")
            return {"scalarType":name,"value":value}
        if name in {"text","bytea","jsonb"}:
            require(length==-1 and not layout["by_value"] and len(data)>=4,
                    "node_varlena_const_unqualified")
            header = int.from_bytes(data[:4],byteorder)
            if byteorder=="little":
                require(header&3==0 and header>>2==len(data), "node_varlena_header_unqualified")
            else:
                require(header>>30==0 and header&0x3fffffff==len(data), "node_varlena_header_unqualified")
            result={"scalarType":name,"payloadHex":data[4:].hex()}
            if name=="jsonb":result["storageByteorder"]=byteorder
            return result
        if name in {"uuid","name"}:
            width={"uuid":16,"name":64}[name]
            require(length==width and not layout["by_value"] and len(data)==width,
                    "node_fixed_const_layout_unqualified")
            return {"scalarType":name,"payloadHex":data.hex()}
        # Packed/composite/range/array/unknown extension values need an explicit
        # typed codec. Exact raw bytes can embed OIDs and are not equivalence.
        raise Unsupported("node_const_type_unsupported")

    @staticmethod
    def unsigned_word(data,width,byteorder):
        raw = data[:width] if byteorder=="little" else data[-width:]
        padding = data[width:] if byteorder=="little" else data[:-width]
        require(not padding or not any(padding), "node_oid_const_padding_unqualified")
        return int.from_bytes(raw,byteorder,signed=False)


def canonicalize_tree(text, resolver, type_layouts, *, datum_layout=None):
    """Return PRIVATE canonical payload; caller hashes/compares without logs.

    resolver(catalog_name,oid,subid=0) returns the full machine identity.
    Enum labels use {derived:'enum-label',type:<full type identity>,labelHex}.
    datum_layout needs independently bound byteorder, UTF8 server encoding,
    8-byte Datum evidence SHA256; supplying fields never proves the evidence.
    """
    parsed=parse_tree(text)
    require(parsed=="<>" or isinstance(parsed,dict) and ("node" in parsed or "list" in parsed),
            "node_root_unqualified")
    return Canonicalizer(resolver,type_layouts,datum_layout).value(parsed)
