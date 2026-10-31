"""Synthetic public PG17 node shapes; no source data, network or database."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/canonicalize-pg17-extension-nodes.py"
spec=importlib.util.spec_from_file_location("pg17_nodes",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PLATFORM={"byteorder":"little","datum_bytes":8,"server_encoding":"UTF8","evidence_sha256":"a"*64}


def identity(kind,*names):
    return {"type":kind,"object_names":list(names),"object_args":[]}


def layout(oid,name,length,by_value,kind="b",**extra):
    return {"source_type_oid":str(oid),"identity":identity("type",name),"length":length,
            "by_value":by_value,"kind":kind,"base_type_oid":"0","is_composite":False,**extra}


def node(tag,**changes):
    fields=m.SCHEMA[tag]
    if tag=="RANGETBLENTRY":fields={**fields["common"],**fields["variants"][str(changes.get("rtekind",0))]}
    values={}
    for key,adapter in fields.items():
        if adapter=="bool":values[key]="false"
        elif adapter=="boolop":values[key]="and"
        elif adapter=="value" or adapter.startswith("oid_list:"):values[key]="<>"
        elif adapter=="datum":values[key]="<>"
        elif adapter=="atom":values[key]="<>"
        else:values[key]="0"
    values.update(changes)
    order=m.FIELD_ORDERS[tag]
    if tag=="RANGETBLENTRY":order=order["prefix"]+order["variants"][str(changes.get("rtekind",0))]+order["suffix"]
    return "{"+tag+" "+" ".join(":"+key+" "+str(values[key]) for key in order)+"}"


def datum(data,size=None):
    return str(len(data) if size is None else size)+" [ "+" ".join(str(b) for b in data)+" ]"


def const(type_oid,length,by_value,value,isnull=False):
    return node("CONST",consttype=str(type_oid),constlen=str(length),
                constbyval="true" if by_value else "false",constisnull="true" if isnull else "false",
                constvalue="<>" if isnull else value)


class NodeTests(unittest.TestCase):
    def setUp(self):
        self.layouts={23:layout(23,"integer",4,True),16:layout(16,"boolean",1,True),
            25:layout(25,"pg_catalog.text",-1,False),17:layout(17,"pg_catalog.bytea",-1,False),
            3802:layout(3802,"pg_catalog.jsonb",-1,False),19:layout(19,"pg_catalog.name",64,False),
            2950:layout(2950,"pg_catalog.uuid",16,False),2205:layout(2205,"pg_catalog.regclass",4,True)}
        self.refs={("pg_type",oid):value["identity"] for oid,value in self.layouts.items()}
        self.refs.update({("pg_proc",10001):identity("function","public","same_function"),
                          ("pg_proc",20001):identity("function","public","same_function"),
                          ("pg_class",10002):identity("table","public","same_table"),
                          ("pg_class",20002):identity("table","public","same_table")})

    def resolver(self,catalog,oid,subid=0):
        self.assertEqual(subid,0)
        return self.refs[(catalog,oid)]

    def canonical(self,text,**kwargs):
        return m.canonicalize_tree(text,self.resolver,self.layouts,datum_layout=kwargs.get("platform",PLATFORM))

    def test_exact_node_oid_fields_resolve_across_shifted_instance_ids(self):
        a=node("FUNCEXPR",funcid="10001",funcresulttype="23",args="("+node("VAR",vartype="23")+")")
        b=a.replace(":funcid 10001",":funcid 20001")
        self.assertEqual(self.canonical(a),self.canonical(b))
        self.refs[("pg_proc",20001)]=identity("function","public","different_overload")
        self.assertNotEqual(self.canonical(a),self.canonical(b))

    def test_regclass_datum_uses_typed_relation_identity_instead_of_numeric_bytes(self):
        a=const(2205,4,True,datum((10002).to_bytes(8,"little"),4))
        b=const(2205,4,True,datum((20002).to_bytes(8,"little"),4))
        self.assertEqual(self.canonical(a),self.canonical(b))
        self.refs[("pg_class",20002)]=identity("table","private_fixture","other_table")
        self.assertNotEqual(self.canonical(a),self.canonical(b))

    def test_big_and_little_endian_oid_datums_resolve_identically(self):
        a=const(2205,4,True,datum((10002).to_bytes(8,"little"),4))
        b=const(2205,4,True,datum((20002).to_bytes(8,"big"),4))
        self.assertEqual(self.canonical(a),self.canonical(b,platform={**PLATFORM,"byteorder":"big"}))

    def test_scalar_values_preserve_meaning_and_source_byte_spelling_is_not_semantics(self):
        a=const(23,4,True,datum((42).to_bytes(8,"little"),4))
        b=const(23,4,True,datum((43).to_bytes(8,"little"),4))
        self.assertNotEqual(self.canonical(a),self.canonical(b))
        negative=const(23,4,True,datum((-1).to_bytes(8,"little",signed=True),4))
        self.assertEqual(self.canonical(negative),self.canonical(negative.replace("255","-1")))
        self.assertEqual(self.canonical(negative)["fields"]["constvalue"]["value"],-1)

    def test_text_bytea_jsonb_uuid_name_preserve_private_payload_exactly(self):
        for oid,payload in [(25,b"private synthetic literal"),(17,b"\x00\xffprivate"),(3802,b"synthetic-jsonb-bytes")]:
            data=((len(payload)+4)<<2).to_bytes(4,"little")+payload
            result=self.canonical(const(oid,-1,False,datum(data)))
            self.assertEqual(result["fields"]["constvalue"]["payloadHex"],payload.hex())
            changed=bytearray(data);changed[-1]^=1
            self.assertNotEqual(result,self.canonical(const(oid,-1,False,datum(changed))))
        for oid,width in [(2950,16),(19,64)]:
            data=bytes(range(width))
            self.assertEqual(self.canonical(const(oid,width,False,datum(data)))["fields"]["constvalue"]["payloadHex"],data.hex())

    def test_enum_ids_map_to_full_type_and_exact_label_identity(self):
        self.layouts[11000]=layout(11000,"public.synthetic_enum",4,True,kind="e")
        self.layouts[21000]=copy.deepcopy(self.layouts[11000]);self.layouts[21000]["source_type_oid"]="21000"
        enum_type=self.layouts[11000]["identity"]
        self.refs.update({("pg_type",11000):enum_type,("pg_type",21000):enum_type,
            ("pg_enum",11001):{"derived":"enum-label","type":enum_type,"labelHex":b"synthetic_label".hex()},
            ("pg_enum",21001):{"derived":"enum-label","type":enum_type,"labelHex":b"synthetic_label".hex()}})
        a=const(11000,4,True,datum((11001).to_bytes(8,"little"),4))
        b=const(21000,4,True,datum((21001).to_bytes(8,"little"),4))
        self.assertEqual(self.canonical(a),self.canonical(b))
        self.refs[("pg_enum",21001)]["labelHex"]=b"other_label".hex()
        self.assertNotEqual(self.canonical(a),self.canonical(b))

    def test_full_field_coverage_unknown_tags_duplicate_fields_and_escapes_fail_closed(self):
        valid=node("ALIAS",aliasname=r":private\ \{TEXT\}",colnames=r'("column\ name" "other")')
        result=self.canonical(valid)
        self.assertEqual(result["fields"]["aliasname"]["atom"],r":private\ \{TEXT\}")
        for text in [valid.replace("ALIAS","NEWNODE",1),valid.replace(" :colnames", " :unknown value :colnames"),
                     valid.replace(" :colnames", " :aliasname duplicate :colnames"),valid[:-1],valid+" trailing",
                     node("ALIAS",aliasname="x").replace(" :colnames <>",""),"dangling\\","arbitrary_atom",
                     node("FUNCEXPR",funcretset="()")]:
            with self.subTest(text=text[:30]),self.assertRaises(m.Unsupported):self.canonical(text)

    def test_oid_lists_preserve_order_null_and_zero_while_untyped_lists_reject(self):
        self.refs[("pg_constraint",100)]=identity("table constraint","public","t","a")
        self.refs[("pg_constraint",200)]=identity("table constraint","public","t","b")
        a=node("QUERY",constraintDeps="(o 100 200)")
        b=node("QUERY",constraintDeps="(o 200 100)")
        self.assertNotEqual(self.canonical(a),self.canonical(b))
        with self.assertRaisesRegex(m.Unsupported,"node_oid_list_class_missing"):self.canonical("(o 23)")
        with self.assertRaises(m.Unsupported):self.canonical(node("QUERY",constraintDeps="(23)"))

    def test_rte_relation_and_function_fields_are_variant_exact(self):
        a=node("RANGETBLENTRY",rtekind="0",relid="10002")
        b=node("RANGETBLENTRY",rtekind="0",relid="20002")
        self.assertEqual(self.canonical(a),self.canonical(b))
        self.canonical(node("RANGETBLENTRY",rtekind="3",functions="<>"))
        with self.assertRaises(m.Unsupported):self.canonical(a.replace(":rtekind 0",":rtekind 99"))
        with self.assertRaises(m.Unsupported):self.canonical(a.replace(" :relid 10002",""))

    def test_field_labels_do_not_authorize_reordering_pg_reader_positions(self):
        good=node("SQLVALUEFUNCTION",type="23")
        bad=good.replace(":op 0 :type 23",":type 23 :op 0")
        self.canonical(good)
        with self.assertRaisesRegex(m.Unsupported,"node_field_order_mismatch"):self.canonical(bad)

    def test_pg_exact_lexer_preserves_non_ascii_whitespace_and_literal_brackets(self):
        plain=self.canonical("{ALIAS :aliasname a :colnames <>}")
        for character in ["\r","\v","\f","\u00a0","\u2003"]:
            for value in [character+"a","a"+character,"a"+character+"b"]:
                with self.subTest(value=repr(value)):
                    changed=self.canonical("{ALIAS :aliasname "+value+" :colnames <>}")
                    self.assertNotEqual(plain,changed)
                    self.assertEqual(changed["fields"]["aliasname"]["atom"],value)
        for value in ["[","]","[]","a[b]","a]b["]:
            with self.subTest(value=value):
                self.assertEqual(self.canonical("{ALIAS :aliasname "+value+" :colnames <>}")["fields"]["aliasname"]["atom"],value)

    def test_unreviewed_platform_unresolved_reference_unknown_packed_type_and_padding_reject(self):
        valid=const(23,4,True,datum((1).to_bytes(8,"little"),4))
        for platform in [None,{}, {**PLATFORM,"datum_bytes":4},{**PLATFORM,"byteorder":"guessed"},
                         {**PLATFORM,"evidence_sha256":"asserted"},{**PLATFORM,"server_encoding":"LATIN1"},
                         {k:v for k,v in PLATFORM.items() if k!="server_encoding"}]:
            with self.subTest(platform=platform),self.assertRaises(m.Unsupported):self.canonical(valid,platform=platform)
        with self.assertRaises(m.Unsupported):self.canonical(node("FUNCEXPR",funcid="99999",funcresulttype="23"))
        self.layouts[30000]=layout(30000,"public.packed_type",4,True)
        self.refs[("pg_type",30000)]=self.layouts[30000]["identity"]
        with self.assertRaisesRegex(m.Unsupported,"node_const_type_unsupported"):
            self.canonical(const(30000,4,True,datum((1).to_bytes(8,"little"),4)))
        bad_padding=(1).to_bytes(4,"little")+b"\x01\x00\x00\x00"
        with self.assertRaises(m.Unsupported):self.canonical(const(23,4,True,datum(bad_padding,4)))
        with self.assertRaises(m.Unsupported):self.canonical(const(25,-1,False,datum(b"bad-header")))

    def test_null_unknown_type_needs_layout_but_no_datum_or_platform(self):
        self.assertEqual(self.canonical(const(23,4,True,"",isnull=True),platform=None)["fields"]["constvalue"],{"null":True})
        with self.assertRaises(m.Unsupported):self.canonical(const(23,4,True,"<>",isnull=False))

    def test_domain_base_chain_is_bound_and_array_or_bare_oid_datum_is_unsupported(self):
        self.layouts[33000]=layout(33000,"public.synthetic_domain",4,True,kind="d",base_type_oid="23")
        self.refs[("pg_type",33000)]=self.layouts[33000]["identity"]
        result=self.canonical(const(33000,4,True,datum((42).to_bytes(8,"little"),4)))
        self.assertEqual(result["fields"]["consttype"],self.layouts[33000]["identity"])
        self.assertEqual(result["fields"]["constvalue"]["value"],42)
        self.layouts[33000]["base_type_oid"]="33000"
        with self.assertRaises(m.Unsupported):self.canonical(const(33000,4,True,datum((42).to_bytes(8,"little"),4)))
        for oid,name,length,by_value,value in [
            (34000,"pg_catalog.oid",4,True,datum((123).to_bytes(8,"little"),4)),
            (35000,"pg_catalog.integer[]",-1,False,datum(b"synthetic-array"))]:
            self.layouts[oid]=layout(oid,name,length,by_value)
            self.refs[("pg_type",oid)]=self.layouts[oid]["identity"]
            with self.subTest(name=name),self.assertRaises(m.Unsupported):self.canonical(const(oid,length,by_value,value))

    def test_all_public_node_schemas_have_complete_explicit_adapters(self):
        for tag,fields in m.SCHEMA.items():
            if tag=="CONST" or tag=="RANGETBLENTRY":continue
            # OID zero remains explicit; this exercises every non-Datum field.
            self.assertEqual(self.canonical(node(tag))["node"],tag)
        self.assertEqual(m.SCHEMA["QUERY"]["constraintDeps"],"oid_list:pg_constraint")
        self.assertEqual(m.SCHEMA["RTEPERMISSIONINFO"]["checkAsUser"],"oid:pg_authid")

    def test_registered_structural_class_keys_need_the_verified_normalizer_protocol(self):
        owner=identity("table","public","owned_table")
        derived={"derived":"owned-toast-relation","owner":owner,"kind":"table"}
        self.refs[("pg_class",10002)]=derived
        text=node("RANGETBLENTRY",rtekind="0",relid="10002")
        with self.assertRaisesRegex(m.Unsupported,"node_derived_reference_unqualified"):self.canonical(text)
        class VerifiedFixture:
            def __call__(_self,catalog,oid,subid=0):return self.resolver(catalog,oid,subid)
            def canonical_identity(_self,value):
                if value!=derived:raise ValueError("fixture_validation_failed")
                return copy.deepcopy(value)
        result=m.canonicalize_tree(text,VerifiedFixture(),self.layouts,datum_layout=PLATFORM)
        self.assertEqual(result["fields"]["relid"],derived)
        self.refs[("pg_class",10002)]={"derived":"unregistered_alias","owner":owner}
        with self.assertRaises(m.Unsupported):m.canonicalize_tree(text,VerifiedFixture(),self.layouts,datum_layout=PLATFORM)


if __name__=="__main__":unittest.main()
