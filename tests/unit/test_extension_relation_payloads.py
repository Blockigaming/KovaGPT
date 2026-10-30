"""Data-free catalog wire/identity mutations. Never native/production proof."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]/"scripts/release"


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


core=load("relation_test_core","extension-routine-type-payloads.py")
relations=load("relation_test_adapters","extension-relation-payloads.py")
generator=load("relation_test_generator","extension-routine-type-hash-query.py")
nodes=load("relation_test_nodes","canonicalize-pg17-extension-nodes.py")


def identity(kind,*names):return {"type":kind,"object_names":list(names),"object_args":[]}


def scalar(field,number=0,text="synthetic"):
    widths={"oid":4,"xid":4,"int2":2,"int4":4,"int8":8,"bool":1,"char":1,"float4":4,"float8":8}
    typ=field["type"]
    if typ in {"name","text","bytea"}:raw=text.encode()
    elif typ=="char":raw=b"r"
    else:raw=number.to_bytes(widths[typ],"big",signed=typ.startswith("int"))
    return {"isNull":False,"bytesHex":raw.hex()}


def row(catalog,offset=0):
    values={}
    for name,field in relations.MANIFESTS[catalog].items():
        kind=field["kind"]
        if kind=="self":value=200+offset
        elif kind in {"scalar","excluded_physical","conditional_owned_name"}:value=scalar(field,text="fixture_"+name)
        elif kind=="ref":value=0 if field["optional"] else 1000+offset
        elif kind in {"array_ref","array_scalar"}:
            value=None if not field["not_null"] else {"dimensions":
                [{"lower":0,"length":0}] if field["type"] in {"oidvector","int2vector"} else [],"items":[]}
        elif kind=="acl":value=None if not field["not_null"] else {"dimensions":[],"items":[]}
        elif kind=="node":value=None if not field["not_null"] else "<>"
        elif kind=="polymorphic_ref":value=7000+offset
        elif kind=="unsupported_nullable":value=None
        else:raise AssertionError(kind)
        values[name]=value
    for name,field in relations.MANIFESTS[catalog].items():
        if field["kind"]=="polymorphic_ref":
            values[field["class_field"]]=5001+offset if name=="refobjid" else 5000+offset
    if catalog=="pg_class":values["relkind"]=scalar({"type":"char"})
    if catalog=="pg_attribute":values["attnum"]=scalar({"type":"int2"},1)
    return {"catalog":catalog,"extensionOid":400+offset,"values":values}


class RelationTests(unittest.TestCase):
    def setUp(self):
        self.overrides={}
        def lookup(catalog,oid,subid=0):
            if (catalog,oid,subid) in self.overrides:return self.overrides[(catalog,oid,subid)]
            value=oid%100000
            if catalog=="pg_class" and value in {5000,5001}:
                result=identity("table","pg_catalog","pg_proc" if value==5000 else "pg_type")
            else:
                kinds={"pg_class":"table","pg_proc":"function","pg_type":"type","pg_extension":"extension",
                       "pg_authid":"role","pg_namespace":"schema"}
                result=identity(kinds.get(catalog,catalog),"fixture",str(value),str(subid))
            return {"identity":result,"roundtrip":True}
        self.resolver=core.VerifiedResolver(lookup,derived_validators=relations.DERIVED_VALIDATORS)
        self.options=relations.adapter_options(core)

    def canonical(self,value,**extra):
        opts={k:v for k,v in self.options.items() if k!="expected_foreign_keys"}
        return core.canonicalize_row(value,self.resolver,canonicalize_tree=lambda text,*_,**__: {"fixtureNode":text},**opts,**extra)

    def test_every_public_manifest_column_is_retained_or_explicitly_rejected(self):
        for catalog,manifest in relations.MANIFESTS.items():
            with self.subTest(catalog=catalog):
                if catalog=="pg_partitioned_table":
                    with self.assertRaises(relations.Stopped):self.canonical(row(catalog))
                    continue
                result=self.canonical(row(catalog))
                self.assertEqual(set(result["columns"]),set(manifest))
                self.assertEqual(result,self.canonical(row(catalog,100000)))
                bad=row(catalog);bad["values"]["unreviewed_column"]={"isNull":False,"bytesHex":"00"}
                with self.assertRaises(core.Stopped):self.canonical(bad)

    def test_layout_and_compound_foreign_keys_are_exact(self):
        columns=core.layout_columns(manifests=self.options["manifests"])
        fks=self.options["expected_foreign_keys"]
        core.validate_layout(columns,fks,server_version_num=170006,manifests=self.options["manifests"],expected_foreign_keys=fks)
        self.assertTrue(any(r["catalog"]=="pg_index" and r["column_names"]==["indrelid","indkey"] for r in fks))
        with self.assertRaises(core.Stopped):
            core.validate_layout(columns,fks[:-1],server_version_num=170006,manifests=self.options["manifests"],expected_foreign_keys=fks)
        with self.assertRaises(core.Stopped):
            core.validate_layout(columns+[{"catalog":"pg_class","column_name":"new_oid","type":"oid","dimensions":0,"not_null":True}],fks,
                server_version_num=170006,manifests=self.options["manifests"],expected_foreign_keys=fks)

    def test_only_six_physical_fields_are_excluded_and_semantic_fields_change(self):
        source=row("pg_class");before=self.canonical(source)
        for field in relations.PHYSICAL_EXCLUSIONS:
            changed=copy.deepcopy(source);changed["values"][field]=scalar(relations.MANIFESTS["pg_class"][field],17)
            self.assertEqual(before,self.canonical(changed))
        for field in ["relrowsecurity","relforcerowsecurity","relhastriggers"]:
            changed=copy.deepcopy(source);changed["values"][field]=scalar({"type":"bool"},1)
            self.assertNotEqual(before,self.canonical(changed))
        changed=copy.deepcopy(source);changed["values"]["relowner"]+=1
        self.assertNotEqual(before,self.canonical(changed))

    def test_toast_names_need_native_owned_identity_and_other_names_are_semantic(self):
        owner=identity("table","public","logical_owner")
        owned={"derived":"owned-toast-relation","owner":owner,"kind":"table"}
        self.overrides[("pg_class",200,0)]={"identity":owned,"roundtrip":True}
        self.overrides[("pg_class",100200,0)]={"identity":owned,"roundtrip":True}
        a=row("pg_class");a["values"]["relname"]=scalar({"type":"name"},text="pg_toast_100")
        b=row("pg_class",100000);b["values"]["relname"]=scalar({"type":"name"},text="pg_toast_100100")
        self.assertEqual(self.canonical(a),self.canonical(b))
        self.overrides[("pg_class",200,0)]["roundtrip"]=False
        with self.assertRaises(core.Stopped):self.canonical(a)
        self.overrides.clear()
        self.assertNotEqual(self.canonical(a),self.canonical(b))

    def test_derived_backlinks_are_typed_not_arbitrary_or_recursive(self):
        good={"derived":"composite-relation","type":identity("type","public.fixture")}
        self.resolver.canonical_identity(good)
        for value in [
            {"derived":"owned-toast-relation","owner":identity("function","wrong"),"kind":"table"},
            {"derived":"owned-toast-relation","owner":identity("table","owner"),"kind":"unknown"},
            {"derived":"composite-relation","type":identity("table","wrong")},
            {"derived":"relation-column","relation":identity("table","t"),"number":0,"nameHex":"61"},
            {"derived":"relation-column","relation":identity("table","t"),"number":1,"nameHex":"ff"},
            {"derived":"unknown","owner":identity("table","t")}]:
            with self.subTest(value=value),self.assertRaises((core.Stopped,relations.Stopped)):
                self.resolver.canonical_identity(value)

    def test_polymorphic_reference_preserves_class_subobject_and_system_attribute(self):
        source=row("pg_depend");before=self.canonical(source)
        changed=copy.deepcopy(source);changed["values"]["objsubid"]=scalar({"type":"int4"},1)
        self.assertNotEqual(before,self.canonical(changed))
        changed=copy.deepcopy(source);changed["values"]["classid"]=5001
        self.assertNotEqual(before,self.canonical(changed))
        changed=copy.deepcopy(source);changed["values"]["objsubid"]=scalar({"type":"int4"},-1)
        with self.assertRaises(relations.Stopped):self.canonical(changed)
        self.overrides[("pg_class",5000,0)]={"identity":identity("table","pg_catalog","pg_class"),"roundtrip":True}
        self.canonical(changed)

    def test_unimplemented_structural_edges_and_nonnull_packed_missing_values_reject(self):
        changes=[("pg_class","relispartition",scalar({"type":"bool"},1)),
                 ("pg_class","relkind",{"isNull":False,"bytesHex":b"f".hex()}),
                 ("pg_class","relrewrite",999),
                 ("pg_attribute","attisdropped",scalar({"type":"bool"},1)),
                 ("pg_attribute","atthasmissing",scalar({"type":"bool"},1)),
                 ("pg_trigger","tgisinternal",scalar({"type":"bool"},1))]
        for catalog,key,value in changes:
            changed=row(catalog);changed["values"][key]=value
            with self.subTest(catalog=catalog,key=key),self.assertRaises(relations.Stopped):self.canonical(changed)
        changed=row("pg_attribute");changed["values"]["attmissingval"]={"unsupportedNonNull":True}
        with self.assertRaises(core.Stopped):self.canonical(changed)

    def test_extension_root_configuration_filters_owner_version_and_comments_are_semantic(self):
        source=row("pg_extension");before=self.canonical(source)
        changes={
            "extconfig":{"dimensions":[{"lower":1,"length":1}],"items":[1700]},
            "extcondition":{"dimensions":[{"lower":1,"length":1}],"items":[scalar({"type":"text"},text="WHERE synthetic_private_filter=1")]},
            "extowner":1001,"extnamespace":1001,
            "extversion":scalar({"type":"text"},text="other-version"),
            "extrelocatable":scalar({"type":"bool"},1)}
        for name,value in changes.items():
            changed=copy.deepcopy(source);changed["values"][name]=value
            with self.subTest(name=name):self.assertNotEqual(before,self.canonical(changed))
        self.overrides[("pg_class",5002,0)]={"identity":identity("table","pg_catalog","pg_extension"),"roundtrip":True}
        comment=row("pg_description");comment["values"]["classoid"]=5002
        first=self.canonical(comment)
        comment["values"]["description"]=scalar({"type":"text"},text="synthetic changed root comment")
        self.assertNotEqual(first,self.canonical(comment))

    def test_public_capture_and_lazy_apis_are_gated_and_validate_numeric_requests(self):
        opts=relations.capture_query_options(core,generator)
        query=generator.build_capture_all_private_wire_query(**opts)
        for marker in ["PRIVATE_GHA_ONLY","PRIVATE_GHA_CAPTURE_ONLY","relation_identity_map","column_identity_map",
                       "pg_toast_","c.reltype=t.oid","sourceSnapshotSha256"]:self.assertIn(marker,query)
        for requests in [[],[("pg_proc;DROP",1,0)],[("pg_proc",True,0)],[("pg_proc",0,0)],
                         [("pg_proc",1,-1)],[("pg_proc",1,0),("pg_proc",1,0)]]:
            with self.subTest(requests=requests),self.assertRaises(ValueError):relations.lazy_reference_query(requests,core,generator)
        lazy=relations.lazy_reference_query([("pg_class",42,1),("pg_enum",43,0)],core,generator)
        self.assertIn("pg_get_object_address",lazy);self.assertIn("sourceSnapshotSha256",lazy)
        self.assertNotIn("BEGIN;",lazy);self.assertNotIn("COMMIT;",lazy)


if __name__=="__main__":unittest.main()
