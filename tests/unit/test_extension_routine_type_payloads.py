"""Synthetic private catalog rows; never connects to PostgreSQL or uses accounts."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/extension-routine-type-payloads.py"
spec=importlib.util.spec_from_file_location("routine_type_payloads",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def cell(value):return {"isNull":value is None,"bytesHex":None if value is None else value.hex()}


def fixture(catalog="pg_proc",shift=0):
    values={}
    for index,(name,field) in enumerate(m.MANIFESTS[catalog].items(),start=1):
        if field["kind"]=="self":values[name]=100+shift
        elif field["kind"]=="scalar":
            raw={"bool":b"\x00","char":b"n","int2":b"\x00\x00","int4":b"\x00"*4,"float4":bytes.fromhex("3f800000")}.get(field["type"],("synthetic "+name+" literal 100").encode())
            values[name]=cell(None if not field["not_null"] else raw)
        elif field["kind"]=="ref":values[name]=0 if field["optional"] else 1000+index+shift
        elif field["kind"]=="array_ref":
            values[name]=None if not field["not_null"] else {"dimensions":[{"lower":0,"length":2}],"items":[2001+shift,2002+shift]}
        else:values[name]=None
    if catalog=="pg_enum":values.update(enumtypid=501+shift,enumlabel=cell(b"red"))
    return {"catalog":catalog,"extensionOid":5000+shift,"values":values}


def resolver(shift=0,*,bad_roundtrip=False,owner_alias=None):
    kinds={"pg_proc":"function","pg_type":"type","pg_namespace":"schema","pg_authid":"role",
           "pg_language":"language","pg_extension":"extension","pg_class":"table",
           "pg_collation":"collation","pg_operator":"operator","pg_opclass":"operator class"}
    def lookup(catalog,oid,subid):
        logical=oid-shift
        if catalog=="pg_enum":
            result={"derived":"enum-label","type":lookup("pg_type",501+shift,0)["identity"],"labelHex":b"red".hex()}
        else:
            name=owner_alias if catalog=="pg_authid" and owner_alias else catalog+"_object_"+str(logical)
            result={"type":kinds[catalog],"object_names":["synthetic",name],
                    "object_args":["pg_catalog.integer"] if catalog=="pg_proc" else []}
        return {"identity":result,"roundtrip":not bad_roundtrip}
    return m.VerifiedResolver(lookup)


def receipt(rows,resolve=None,**kwargs):
    return m.hash_rows(rows,resolve or resolver(),catalog_columns=m.layout_columns(),
        catalog_foreign_keys=m.FOREIGN_KEYS,server_version_num=170006,**kwargs)


class PayloadTests(unittest.TestCase):
    def test_complete_public_layout_and_fk_manifest_rejects_added_missing_or_changed_fields(self):
        self.assertTrue(m.validate_layout(m.layout_columns(),m.FOREIGN_KEYS,server_version_num=170006))
        for mutate in [lambda c:c.append({"catalog":"pg_proc","column_name":"future_field","type":"oid","dimensions":0,"not_null":True}),
                       lambda c:c.pop(),lambda c:c[0].update(type="int8"),lambda c:c[0].update(not_null=1),
                       lambda c:c[0].update(dimensions=2)]:
            columns=copy.deepcopy(m.layout_columns());mutate(columns)
            with self.assertRaises(m.Stopped):m.validate_layout(columns,m.FOREIGN_KEYS,server_version_num=170006)
        with self.assertRaises(m.Stopped):m.validate_layout(m.layout_columns(),m.FOREIGN_KEYS[:-1],server_version_num=170006)
        bad=copy.deepcopy(m.FOREIGN_KEYS);bad[0]["is_array"]=int(bad[0]["is_array"])
        with self.assertRaises(m.Stopped):m.validate_layout(m.layout_columns(),bad,server_version_num=170006)
        with self.assertRaises(m.Stopped):m.validate_layout(m.layout_columns(),m.FOREIGN_KEYS,server_version_num=180003)

    def test_every_catalog_normalizes_different_server_oid_allocations_without_touching_literal_numbers(self):
        for catalog in m.MANIFESTS:
            a=fixture(catalog);b=fixture(catalog,10000)
            self.assertEqual(m.canonicalize_row(a,resolver()),m.canonicalize_row(b,resolver(10000)))
        row=fixture();original=receipt([row])
        row["values"]["prosrc"]=cell(b"synthetic prosrc literal 10000")
        self.assertNotEqual(original,receipt([row]))

    def test_owner_and_overloaded_function_identity_are_complete_and_affect_semantics(self):
        row=fixture();first=m.canonicalize_row(row,resolver())
        self.assertEqual(first["identity"]["object_args"],["pg_catalog.integer"])
        changed=m.canonicalize_row(row,resolver(owner_alias="different_owner"))
        self.assertNotEqual(m.digest(first),m.digest(changed))

    def test_unverified_partial_unresolved_or_zero_mandatory_identity_is_rejected(self):
        row=fixture()
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver(bad_roundtrip=True))
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,lambda *_:None)
        partial=m.VerifiedResolver(lambda *_:{"identity":{"type":"function","name":"partial"},"roundtrip":True})
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,partial)
        row["values"]["proowner"]=0
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver())

    def test_unknown_or_missing_row_columns_fail_without_echoing_values(self):
        row=fixture();row["values"]["future_secret_column"]="SYNTHETIC_PRIVATE_VALUE"
        with self.assertRaisesRegex(m.Stopped,"^payload_row_columns_uncovered$"):m.canonicalize_row(row,resolver())
        row=fixture();del row["values"]["prosrc"]
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver())

    def test_exact_binary_scalars_preserve_negative_zero_nan_and_null_distinctions(self):
        row=fixture();row["values"]["procost"]=cell(bytes.fromhex("00000000"));zero=receipt([row])
        for bits in ["80000000","7fc00001","7fc00002"]:
            row["values"]["procost"]=cell(bytes.fromhex(bits));self.assertNotEqual(zero,receipt([row]))
        row["values"]["probin"]=cell(b"");empty=receipt([row]);row["values"]["probin"]=cell(None)
        self.assertNotEqual(empty,receipt([row]))
        row["values"]["proisstrict"]=cell(bytes.fromhex("02"))
        with self.assertRaises(m.Stopped):receipt([row])
        for unknown in ["unknown_packed_type","oid","regclass"]:
            with self.subTest(type=unknown),self.assertRaises(m.Stopped):m.scalar(cell(b"\x00"*4),m.desc(unknown))

    def test_arrays_preserve_null_empty_lower_bounds_dimensions_order_and_null_elements(self):
        row=fixture();baseline=receipt([row]);name="proconfig"
        row["values"][name]={"dimensions":[],"items":[]};empty=receipt([row]);self.assertNotEqual(baseline,empty)
        row["values"][name]={"dimensions":[{"lower":-2,"length":2}],"items":[cell(b"x=1"),cell(None)]};ordered=receipt([row])
        for mutate in [lambda v:v["dimensions"][0].update(lower=1),lambda v:v["items"].reverse(),
                       lambda v:v.update(dimensions=[{"lower":1,"length":1},{"lower":1,"length":2}])]:
            altered=copy.deepcopy(row);mutate(altered["values"][name]);self.assertNotEqual(ordered,receipt([altered]))
        row["values"][name]["items"].pop()
        with self.assertRaises(m.Stopped):receipt([row])

    def test_reference_arrays_preserve_multiplicity_and_reject_unresolved_null_or_zero_elements(self):
        row=fixture();base=receipt([row]);row["values"]["proargtypes"]["items"][1]=row["values"]["proargtypes"]["items"][0]
        self.assertNotEqual(base,receipt([row]))
        for value in [None,0,-1,True,4294967296]:
            altered=copy.deepcopy(row);altered["values"]["proargtypes"]["items"][0]=value
            with self.subTest(value=value),self.assertRaises(m.Stopped):receipt([altered])

    def test_zero_argument_oidvector_preserves_native_zero_length_dimension_instead_of_collapsing_empty(self):
        row=fixture();row["values"]["proargtypes"]={"dimensions":[{"lower":0,"length":0}],"items":[]}
        payload=m.canonicalize_row(row,resolver())
        self.assertEqual(payload["columns"]["proargtypes"]["dimensions"],[{"lower":0,"length":0}])
        for value in [{"dimensions":[],"items":[]},{"dimensions":[{"lower":1,"length":0}],"items":[]},
                      {"dimensions":[{"lower":0,"length":-1}],"items":[]}]:
            altered=copy.deepcopy(row);altered["values"]["proargtypes"]=value
            with self.assertRaises(m.Stopped):receipt([altered])

    def test_acl_retains_null_empty_item_order_grantor_grantee_privileges_and_grant_options(self):
        row=fixture();null=receipt([row]);row["values"]["proacl"]={"dimensions":[],"items":[]}
        self.assertNotEqual(null,receipt([row]))
        item={"textHex":b"owner=X/owner".hex(),"roundtrip":True,"entries":[{"grantor":10,"grantee":11,"privilege":"EXECUTE","isGrantable":False}]}
        row["values"]["proacl"]={"dimensions":[{"lower":1,"length":1}],"items":[item]};ordinary=receipt([row])
        for key,value in [("grantor",12),("grantee",0),("privilege","USAGE"),("isGrantable",True)]:
            altered=copy.deepcopy(row);altered["values"]["proacl"]["items"][0]["entries"][0][key]=value
            self.assertNotEqual(ordinary,receipt([altered]))
        item["roundtrip"]=False
        with self.assertRaises(m.Stopped):receipt([row])

    def test_enum_oid_uses_parent_type_and_exact_label_not_physical_allocation(self):
        row=fixture("pg_enum");payload=m.canonicalize_row(row,resolver())
        self.assertEqual(payload["identity"]["derived"],"enum-label")
        self.assertEqual(payload["identity"]["labelHex"],b"red".hex())
        row["values"]["enumlabel"]=cell(b"blue")
        with self.assertRaisesRegex(m.Stopped,"payload_enum_identity_value_mismatch"):receipt([row])

    def test_empty_enum_label_is_valid_and_distinct_from_null_nul_invalid_utf8_and_overlong(self):
        row=fixture("pg_enum");row["values"]["enumlabel"]=cell(b"");base=resolver()
        def with_label(raw):
            def lookup(catalog,oid,subid):
                value=base(catalog,oid,subid)
                if catalog=="pg_enum":value["labelHex"]=raw.hex()
                return {"identity":value,"roundtrip":True}
            return m.VerifiedResolver(lookup)
        normalized=m.canonicalize_row(row,with_label(b""))
        self.assertEqual(normalized["identity"]["labelHex"],"")
        for raw in [b"\x00",b"\xff",b"x"*64]:
            with self.subTest(kind=len(raw)),self.assertRaises(m.Stopped):m.canonicalize_row(row,with_label(raw))
        row["values"]["enumlabel"]=cell(None)
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,with_label(b""))

    def test_opaque_nodes_require_parser_and_forward_exact_platform_layout_without_raw_receipt(self):
        row=fixture();row["values"]["proargdefaults"]="SYNTHETIC_PRIVATE_NODE"
        with self.assertRaisesRegex(m.Stopped,"payload_node_canonicalizer_required"):receipt([row])
        seen=[];platform={"byteorder":"little","datum_bytes":8,"server_encoding":"UTF8","evidence_sha256":"a"*64}
        def parser(raw,resolve,types,*,datum_layout):
            seen.append((raw,types,datum_layout));return {"type":"synthetic-normalized-tree","reference":resolve("pg_type",2001,0)}
        result=receipt([row],canonicalize_tree=parser,type_layouts={"synthetic":True},datum_layout=platform)
        self.assertEqual(seen,[("SYNTHETIC_PRIVATE_NODE",{"synthetic":True},platform)])
        self.assertNotIn("SYNTHETIC_PRIVATE",json.dumps(result));self.assertFalse(result["qualificationReady"])

    def test_hash_receipt_returns_only_fixed_catalogs_counts_hashes_and_limits(self):
        rows=[fixture(catalog) for catalog in m.MANIFESTS]
        output=receipt(rows);encoded=json.dumps(output)
        self.assertEqual({r["catalog"] for r in output["catalogs"]},set(m.MANIFESTS))
        self.assertFalse(output["wholeExtensionSurfaceCovered"]);self.assertFalse(output["productionMutated"])
        for secret in ["synthetic prosrc","literal 100","object_",b"synthetic prosrc literal 100".hex()]:self.assertNotIn(secret,encoded)
        self.assertEqual(output,receipt(list(reversed(rows))))
        with self.assertRaisesRegex(m.Stopped,"payload_duplicate_identity"):receipt(rows+[copy.deepcopy(rows[0])])

    def test_real_strict_node_parser_interoperates_with_verified_resolver_across_allocations(self):
        path=SCRIPT.with_name("canonicalize-pg17-extension-nodes.py")
        node_spec=importlib.util.spec_from_file_location("node_payload_integration",path)
        nodes=importlib.util.module_from_spec(node_spec);node_spec.loader.exec_module(nodes)
        a=fixture();b=fixture(shift=10000)
        a["values"]["proargdefaults"]="({SQLVALUEFUNCTION :op 0 :type 23 :typmod -1 :location -1})"
        b["values"]["proargdefaults"]="({SQLVALUEFUNCTION :op 0 :type 10023 :typmod -1 :location -1})"
        self.assertEqual(receipt([a],canonicalize_tree=nodes.canonicalize_tree,type_layouts={}),
                         receipt([b],resolver(10000),canonicalize_tree=nodes.canonicalize_tree,type_layouts={}))
        a["values"]["proargdefaults"]=a["values"]["proargdefaults"].replace("SQLVALUEFUNCTION","UNKNOWNNODE")
        with self.assertRaises(nodes.Unsupported):receipt([a],canonicalize_tree=nodes.canonicalize_tree,type_layouts={})

    def test_generic_exact_manifest_and_explicit_compound_foreign_keys_do_not_drop_native_metadata(self):
        manifests={"pg_index":{"indrelid":m.ref("pg_class"),
            "indkey":m.desc("int2vector",kind="array_scalar",dimensions=1)}}
        compound={"catalog":"pg_index","column_names":["indrelid","indkey"],"is_array":True,
                  "is_opt":True,"referenced_catalog":"pg_attribute","referenced_columns":["attrelid","attnum"]}
        expected=[*m.foreign_keys_for(manifests),compound]
        self.assertTrue(m.validate_layout(m.layout_columns(manifests),expected,server_version_num=170006,
                                         manifests=manifests,expected_foreign_keys=expected))
        with self.assertRaises(m.Stopped):m.validate_layout(m.layout_columns(manifests),expected,
                                                            server_version_num=170006,manifests=manifests)
        with self.assertRaises(m.Stopped):m.validate_layout(m.layout_columns(manifests),expected[:-1],
            server_version_num=170006,manifests=manifests,expected_foreign_keys=expected)

    def test_generic_physical_exclusions_are_fixed_field_policy_and_keep_exact_raw_wire(self):
        manifest={"pg_class":{"oid":m.desc("oid",kind="self"),"relname":m.desc("name",kind="conditional_owned_name"),
            "relpages":{**m.desc("int4",kind="excluded_physical"),"reason":m.PHYSICAL_REASONS["relpages"]}}}
        row={"catalog":"pg_class","extensionOid":5000,"values":{"oid":100,"relname":cell(b"synthetic_relation"),"relpages":cell(b"\x00"*4)}}
        def named(_catalog,_column,value,field,_values,_resolver,_context):return m.scalar(value,field)
        selector=lambda _catalog,columns,_values,_resolver:columns["oid"]
        def run(value):return m.canonicalize_row(value,resolver(),manifests=manifest,identity_selector=selector,
                                      field_adapters={"conditional_owned_name":named})
        before=copy.deepcopy(row);normalized=run(row)
        row["values"]["relpages"]=cell(bytes.fromhex("0000002a"))
        self.assertEqual(normalized,run(row));self.assertNotEqual(before,row)
        altered=copy.deepcopy(manifest);altered["pg_class"]["relpages"]["reason"]="unknown reason"
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver(),manifests=altered,identity_selector=selector,
                                                           field_adapters={"conditional_owned_name":named})
        forbidden={"pg_class":{"relowner":{**m.desc("oid",kind="excluded_physical"),"reason":"owner is physical"}}}
        with self.assertRaises(m.Stopped):m.canonicalize_row({"catalog":"pg_class","extensionOid":5000,
            "values":{"relowner":cell(b"\x00"*4)}},resolver(),manifests=forbidden,identity_selector=selector)

    def test_custom_adapters_cannot_override_primitives_drop_fields_or_return_implicit_null(self):
        with self.assertRaisesRegex(m.Stopped,"payload_builtin_adapter_override_forbidden"):
            m.canonicalize_row(fixture(),resolver(),field_adapters={"scalar":lambda *_:{"dropped":True}})
        manifest={"pg_namespace":{"oid":m.desc("oid",kind="self"),"nspname":m.desc("name",kind="custom_name")}}
        row={"catalog":"pg_namespace","extensionOid":5000,"values":{"oid":100,"nspname":cell(b"synthetic")}}
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver(),manifests=manifest,
                identity_selector=lambda *_:{"synthetic":True},field_adapters={"custom_name":lambda *_:None})
        row["values"]["unknown"]=cell(b"private")
        with self.assertRaisesRegex(m.Stopped,"payload_row_columns_uncovered"):
            m.canonicalize_row(row,resolver(),manifests=manifest)

    def test_nested_derived_identities_require_registered_validation_and_native_roundtrip(self):
        ordinary={"type":"table","object_names":["synthetic","owner"],"object_args":[]}
        derived={"derived":"synthetic-owned","owner":ordinary,"kind":"table"}
        def validator(value,normalize):
            m.require(set(value)=={"derived","owner","kind"} and value["kind"]=="table","synthetic_derived_invalid")
            return {**value,"owner":normalize(value["owner"])}
        lookup=lambda *_:{"identity":derived,"roundtrip":True}
        with self.assertRaises(m.Stopped):m.VerifiedResolver(lookup)("pg_class",100)
        verified=m.VerifiedResolver(lookup,derived_validators={"synthetic-owned":validator})
        self.assertEqual(verified("pg_class",100),derived)
        bad=m.VerifiedResolver(lambda *_:{"identity":derived,"roundtrip":False},derived_validators={"synthetic-owned":validator})
        with self.assertRaises(m.Stopped):bad("pg_class",100)

    def test_verified_system_column_subids_remain_signed_and_type_bound(self):
        calls=[]
        def lookup(catalog,oid,subid):
            calls.append((catalog,oid,subid))
            return {"identity":{"type":"table column","object_names":["synthetic","t","tableoid"],"object_args":[]},"roundtrip":True}
        verified=m.VerifiedResolver(lookup)
        self.assertEqual(verified("pg_class",100,-6)["type"],"table column")
        self.assertEqual(calls,[("pg_class",100,-6)])
        for catalog,oid,subid in [("pg_proc",100,-1),("pg_class",100,-7),("pg_class",4294967296,0),
                                  ("pg_class",100,2147483648)]:
            with self.subTest(catalog=catalog,subid=subid),self.assertRaises(m.Stopped):verified(catalog,oid,subid)

    def test_null_only_and_additional_scalar_vector_types_fail_closed(self):
        manifest={"pg_attribute":{"attrelid":m.ref("pg_class"),
            "attmissingval":m.desc("anyarray",nullable=True,kind="null_only"),
            "synthetic_vector":m.desc("int2vector",kind="array_scalar",dimensions=1)}}
        row={"catalog":"pg_attribute","extensionOid":5000,"values":{"attrelid":100,"attmissingval":None,
            "synthetic_vector":{"dimensions":[{"lower":0,"length":0}],"items":[]}}}
        selector=lambda _catalog,columns,_values,_resolver:columns["attrelid"]["identity"]
        normalized=m.canonicalize_row(row,resolver(),manifests=manifest,identity_selector=selector)
        self.assertTrue(normalized["columns"]["attmissingval"]["isNull"])
        row["values"]["attmissingval"]={"unexpected":"payload"}
        with self.assertRaises(m.Stopped):m.canonicalize_row(row,resolver(),manifests=manifest,identity_selector=selector)
        for kind in ["int8","float8","xid8","pg_lsn"]:
            self.assertEqual(m.scalar(cell(b"\x00"*8),m.desc(kind))["bytesHex"],"00"*8)
            with self.assertRaises(m.Stopped):m.scalar(cell(b"\x00"*4),m.desc(kind))


if __name__=="__main__":unittest.main()
