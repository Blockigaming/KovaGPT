#!/usr/bin/env python3
"""Private same-exporter metadata capture and strict offline canonicalization.

No CLI or source connector route. The approved capture caller keeps all raw
wire, identities, ASTs and caches in its private workspace/encrypted envelope.
Only the final aggregate hash/count summary may leave that custody boundary.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
PROJECT="mfbycmbjygcfkrsuepxf"
BUILD="17.6.1.155"
FORMAT="same-snapshot-extension-semantics-v1"
SHA=re.compile(r"[a-f0-9]{64}\Z")
SOURCE=re.compile(r"[a-f0-9]{40}\Z")
MAX_BYTES=32*1024**2
MAX_QUERIES=4096
HELPERS=("extension-semantic-capture.py","extension-routine-type-payloads.py",
    "extension-routine-type-hash-query.py","extension-relation-payloads.py",
    "extension-relation-query-hooks.py","pg17-extension-relation-manifest.json",
    "canonicalize-pg17-extension-nodes.py","pg17-extension-node-schema.json",
    "extension-regclass-datum-byteorder-audit.sql")


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value

core=module("semantic_payload_core","extension-routine-type-payloads.py")
relations=module("semantic_relation_core","extension-relation-payloads.py")
generator=module("semantic_private_query","extension-routine-type-hash-query.py")
nodes=module("semantic_pg17_nodes","canonicalize-pg17-extension-nodes.py")


class Stopped(Exception):pass


def require(ok,code):
    if not ok:raise Stopped(code)


def encoded(value):return (json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def source_files():return {name:sha((HERE/name).read_bytes()) for name in HELPERS}


def completed_statement(query):
    require(type(query) is str and query.strip() and "\x00" not in query,"semantic_query_shape_unqualified")
    return query.rstrip().rstrip(";")+";"


def audit_body():
    text=(HERE/"extension-regclass-datum-byteorder-audit.sql").read_text()
    start=text.index("WITH RECURSIVE\n")
    require(text.rstrip().endswith("COMMIT;"),"semantic_datum_query_unqualified")
    return completed_statement(text[start:text.rfind("COMMIT;")])


PROOF_SQL="""SELECT jsonb_build_object('serverVersionNum',current_setting('server_version_num')::integer,
 'serverEncoding',current_setting('server_encoding'),'clientEncoding',current_setting('client_encoding'),
 'readOnly',current_setting('transaction_read_only')='on',
 'repeatableRead',current_setting('transaction_isolation')='repeatable read',
 'searchPath',current_setting('search_path'),
 'sourceSnapshotSha256',encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'))::text;"""
CONTEXT_SQL="""SELECT jsonb_build_object(
 'privateWireContext',set_config('kova.private_extension_wire','PRIVATE_GHA_CAPTURE_ONLY',true),
 'searchPath',set_config('search_path','pg_catalog',true))::text;"""


class Session:
    def __init__(self,reader,*,check_deadline=lambda:None):
        require(callable(getattr(reader,"query",None)) and re.fullmatch(r"[a-fA-F0-9]+-[a-fA-F0-9]+-\d+",getattr(reader,"id",""))
                and SHA.fullmatch(getattr(reader,"snapshot_sha256",""))
                and getattr(reader,"server_encoding",None)==getattr(reader,"client_encoding",None)=="UTF8",
                "semantic_exporter_identity_unqualified")
        self.reader=reader;self.expected_snapshot=reader.snapshot_sha256
        self.check_deadline=check_deadline;self.query_log=[];self.references={};self.type_layouts=TypeLayouts(self)

    def query(self,sql,stage):
        self.check_deadline();require(len(self.query_log)<MAX_QUERIES,"semantic_query_budget_exceeded")
        statement=completed_statement(sql)
        self.query_log.append({"stage":stage,"sha256":sha(statement.encode())})
        value=self.reader.query(statement)
        self.check_deadline();require(type(value) is dict,"semantic_query_result_unqualified")
        return value

    def snapshot_proof(self):
        p=self.query(PROOF_SQL,"snapshot-proof")
        require(p.get("serverVersionNum")==170006 and p.get("serverEncoding")==p.get("clientEncoding")=="UTF8"
                and p.get("readOnly") is True and p.get("repeatableRead") is True and p.get("searchPath")=="pg_catalog"
                and p.get("sourceSnapshotSha256")==self.expected_snapshot,"semantic_snapshot_binding_mismatch")
        return p

    def add_references(self,rows):
        require(type(rows) is list,"semantic_reference_rows_unqualified")
        for row in rows:
            self.check_deadline()
            require(type(row) is dict and set(row)=={"catalog","oid","subid","identity","roundtrip"}
                    and type(row["catalog"]) is str and re.fullmatch(r"pg_[a-z0-9_]+",row["catalog"])
                    and type(row["oid"]) is int and 0<row["oid"]<2**32 and type(row["subid"]) is int
                    and row["roundtrip"] is True,"semantic_reference_roundtrip_unqualified")
            key=(row["catalog"],row["oid"],row["subid"])
            require(key not in self.references or self.references[key]==row,"semantic_reference_changed")
            self.references[key]=row

    def lookup(self,catalog,oid,subid):
        key=(catalog,oid,subid)
        if key not in self.references:
            value=self.query(relations.lazy_reference_query([key],core,generator),"lazy-reference")
            require(value.get("privateRawWire") is True and value.get("sourceSnapshotSha256")==self.expected_snapshot
                    and value.get("serverVersionNum")==170006,"semantic_lazy_reference_binding_mismatch")
            self.add_references(value.get("resolvedReferences"))
        require(key in self.references,"semantic_reference_missing")
        row=self.references[key]
        return {"identity":row["identity"],"roundtrip":row["roundtrip"]}

    def type_layout(self,oid):
        require(type(oid) is int and 0<oid<2**32,"semantic_type_address_unqualified")
        sql="""SELECT jsonb_build_object('sourceSnapshotSha256',
 encode(sha256(convert_to(pg_current_snapshot()::text,'UTF8')),'hex'),
 'type',jsonb_build_object('source_type_oid',t.oid::bigint,
 'identity',to_jsonb(pg_identify_object_as_address('pg_catalog.pg_type'::regclass,t.oid,0)),
 'kind',t.typtype,'length',t.typlen,'by_value',t.typbyval,'is_composite',t.typrelid<>0,
 'base_type_oid',t.typbasetype::bigint,'element_type_oid',t.typelem::bigint))::text
 FROM pg_catalog.pg_type t WHERE t.oid="""+str(oid)+"::oid;"
        value=self.query(sql,"type-layout")
        require(value.get("sourceSnapshotSha256")==self.expected_snapshot,"semantic_type_snapshot_mismatch")
        layout=value.get("type")
        require(type(layout) is dict and layout.get("source_type_oid")==oid
                and layout.get("identity")==self.resolver("pg_type",oid,0),"semantic_type_identity_unqualified")
        return layout

    @property
    def resolver(self):
        return core.VerifiedResolver(self.lookup,derived_validators=relations.DERIVED_VALIDATORS)


class TypeLayouts(dict):
    def __init__(self,session):super().__init__();self.session=session
    def __contains__(self,oid):
        if not dict.__contains__(self,oid):
            require(len(self)<4096,"semantic_type_budget_exceeded")
            self[oid]=self.session.type_layout(oid)
        return dict.__contains__(self,oid)


def canonical_receipt(wire,resolver,type_layouts,datum_layout,*,check_deadline=lambda:None):
    options=relations.adapter_options(core)
    core.validate_layout(wire["catalogColumns"],wire["catalogForeignKeys"],server_version_num=wire["serverVersionNum"],
        manifests=options["manifests"],expected_foreign_keys=options["expected_foreign_keys"])
    require(type(wire.get("rows")) is list,"semantic_payload_rows_unqualified")
    grouped={catalog:[] for catalog in options["manifests"]};keys=set()
    for row in wire["rows"]:
        check_deadline()
        value=core.canonicalize_row(row,resolver,canonicalize_tree=nodes.canonicalize_tree,
            type_layouts=type_layouts,datum_layout=datum_layout,**{k:v for k,v in options.items()
                if k not in {"expected_foreign_keys"}})
        identity=core.canonical_bytes({k:value[k] for k in ["catalog","extension","identity"]})
        require(identity not in keys,"semantic_duplicate_object_identity");keys.add(identity)
        grouped[value["catalog"]].append(value)
    catalogs=[]
    for catalog,values in sorted(grouped.items()):
        check_deadline()
        catalogs.append({"catalog":catalog,"count":len(values),"sha256":core.digest(sorted(values,key=core.canonical_bytes))})
    content={"format":FORMAT,"catalogs":catalogs,"physicalExclusions":core.PHYSICAL_REASONS}
    check_deadline()
    return {"format":FORMAT,"canonicalSha256":sha(encoded(content)),"catalogs":catalogs,
            "wholeExtensionSurfaceCovered":True,"allCatalogFieldsCovered":True,
            "nodeReferenceCoverageComplete":True,"typeLayoutsComplete":True,
            "customerRowsRead":False,"rawValuesReturned":False}


def collect(reader,*,source_sha,check_deadline=lambda:None):
    """Already validated private capture/target caller only; no external API."""
    require(SOURCE.fullmatch(source_sha or ""),"semantic_source_pin_unqualified")
    session=Session(reader,check_deadline=check_deadline)
    context=session.query(CONTEXT_SQL,"private-context")
    require(context=={"privateWireContext":"PRIVATE_GHA_CAPTURE_ONLY","searchPath":"pg_catalog"},
            "semantic_private_context_unqualified")
    before=session.snapshot_proof()
    options=relations.capture_query_options(core,generator)
    query=generator.build_capture_all_private_wire_query(**options)
    wire=session.query(query,"all-catalog-wire")
    require(wire.get("operation")=="PRIVATE_GHA_ONLY-extension-all-catalog-wire" and wire.get("privateRawWire") is True
            and wire.get("sourceSnapshotSha256")==session.expected_snapshot and wire.get("serverVersionNum")==170006,
            "semantic_wire_coverage_unqualified")
    session.add_references(wire.get("resolvedReferences"))
    datum=session.query(audit_body(),"datum-encoding-proof")
    little=datum.get("eightByteLittleEndianProven") is True
    big=datum.get("eightByteBigEndianProven") is True
    require(datum.get("serverVersionNum")==170006 and little!=big
            and datum.get("allObservedDatumsEightBytes") is True,"semantic_datum_encoding_unqualified")
    abi={"byteorder":"little" if little else "big","datum_bytes":8,"server_encoding":"UTF8",
         "evidence_sha256":sha(encoded({"snapshot":before,"datum":datum}))}
    receipt=canonical_receipt(wire,session.resolver,session.type_layouts,abi,check_deadline=check_deadline)
    after=session.snapshot_proof();require(before==after,"semantic_exporter_changed")
    result={"format":1,"operation":"same-exporter-private-extension-semantics","project":PROJECT,
        "postgresBuild":BUILD,"sourceSha":source_sha,"captureSnapshotBound":True,
        "sourceSnapshotSha256":session.expected_snapshot,"exportedSnapshotIdSha256":sha(reader.id.encode()),
        "snapshotProof":before,"datumProof":datum,"datumLayout":abi,"helperSourceSha256":source_files(),
        "queryEvidence":session.query_log,"wire":wire,
        "resolvedReferences":[session.references[k] for k in sorted(session.references)],
        "typeLayouts":{str(k):v for k,v in sorted(session.type_layouts.items())},"canonicalReceipt":receipt,
        "customerRowsRead":False,"productionMutated":False,"privateRawWire":True}
    require(len(encoded(result))<=MAX_BYTES,"semantic_capture_bound_exceeded")
    check_deadline()
    return result


def capture(reader,env,*,check_deadline=lambda:None):
    require(env.get("KOVA_AUTH_RECOVERY_CONFIRMATION")=="CAPTURE_ONLY"
            and env.get("GITHUB_EVENT_NAME")=="workflow_dispatch"
            and env.get("GITHUB_REPOSITORY")=="Blockigaming/KovaGPT"
            and env.get("GITHUB_REF")=="refs/heads/main"
            and env.get("GITHUB_SHA")==env.get("KOVA_APPROVED_SOURCE_SHA")
            and env.get("KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION")==BUILD,
            "semantic_private_capture_not_enabled")
    return collect(reader,source_sha=env.get("GITHUB_SHA"),check_deadline=check_deadline)


def verify_saved(result,*,source_sha,expected_canonical_sha256,check_deadline=lambda:None):
    """Offline verifier inside the qualified client; never reconnects to source."""
    require(type(result) is dict and result.get("format")==1
            and result.get("operation")=="same-exporter-private-extension-semantics"
            and result.get("project")==PROJECT and result.get("postgresBuild")==BUILD
            and result.get("sourceSha")==source_sha and result.get("captureSnapshotBound") is True
            and result.get("helperSourceSha256")==source_files()
            and result.get("wire",{}).get("sourceSnapshotSha256")==result.get("sourceSnapshotSha256")
            and SHA.fullmatch(result.get("sourceSnapshotSha256",""))
            and SHA.fullmatch(expected_canonical_sha256 or ""),"semantic_saved_binding_unqualified")
    wire=result.get("wire",{})
    require(wire.get("operation")=="PRIVATE_GHA_ONLY-extension-all-catalog-wire"
            and wire.get("privateRawWire") is True and wire.get("serverVersionNum")==170006
            and result.get("privateRawWire") is True and result.get("customerRowsRead") is False
            and result.get("productionMutated") is False
            and SHA.fullmatch(result.get("exportedSnapshotIdSha256","")),"semantic_saved_provenance_unqualified")
    evidence=result.get("queryEvidence")
    require(type(evidence) is list and 5<=len(evidence)<=MAX_QUERIES
            and all(type(row) is dict and set(row)=={"stage","sha256"}
                    and row["stage"] in {"private-context","snapshot-proof","all-catalog-wire",
                        "datum-encoding-proof","lazy-reference","type-layout"}
                    and SHA.fullmatch(row["sha256"]) for row in evidence),"semantic_saved_query_evidence_unqualified")
    pinned_queries=[("private-context",CONTEXT_SQL),("snapshot-proof",PROOF_SQL),
        ("all-catalog-wire",generator.build_capture_all_private_wire_query(**relations.capture_query_options(core,generator))),
        ("datum-encoding-proof",audit_body())]
    require(evidence[:4]==[{"stage":stage,"sha256":sha(completed_statement(sql).encode())} for stage,sql in pinned_queries]
            and evidence[-1]=={"stage":"snapshot-proof","sha256":sha(completed_statement(PROOF_SQL).encode())}
            and all(row["stage"] in {"lazy-reference","type-layout"} for row in evidence[4:-1]),
            "semantic_saved_query_binding_mismatch")
    proof=result.get("snapshotProof",{})
    require(proof.get("sourceSnapshotSha256")==result["sourceSnapshotSha256"]
            and proof.get("serverVersionNum")==170006 and proof.get("serverEncoding")==proof.get("clientEncoding")=="UTF8"
            and proof.get("readOnly") is True and proof.get("repeatableRead") is True and proof.get("searchPath")=="pg_catalog",
            "semantic_saved_snapshot_unqualified")
    datum=result.get("datumProof",{});abi=result.get("datumLayout",{})
    little=datum.get("eightByteLittleEndianProven") is True;big=datum.get("eightByteBigEndianProven") is True
    require(little!=big and datum.get("serverVersionNum")==170006 and datum.get("allObservedDatumsEightBytes") is True
            and abi=={"byteorder":"little" if little else "big","datum_bytes":8,"server_encoding":"UTF8",
                      "evidence_sha256":sha(encoded({"snapshot":proof,"datum":datum}))},"semantic_saved_datum_unqualified")
    cache={}
    for row in result.get("resolvedReferences",[]):
        require(type(row) is dict and set(row)=={"catalog","oid","subid","identity","roundtrip"}
                and row["roundtrip"] is True,"semantic_saved_reference_unqualified")
        key=(row["catalog"],row["oid"],row["subid"])
        require(key not in cache,"semantic_saved_duplicate_reference");cache[key]=row
    def lookup(catalog,oid,subid):
        row=cache.get((catalog,oid,subid));require(row is not None,"semantic_saved_reference_missing")
        return {"identity":row["identity"],"roundtrip":row["roundtrip"]}
    layouts=result.get("typeLayouts")
    require(type(layouts) is dict and all(str(int(k))==k and 0<int(k)<2**32 for k in layouts),
            "semantic_saved_type_cache_unqualified")
    resolver=core.VerifiedResolver(lookup,derived_validators=relations.DERIVED_VALIDATORS)
    receipt=canonical_receipt(result["wire"],resolver,{int(k):v for k,v in layouts.items()},abi,check_deadline=check_deadline)
    require(receipt==result.get("canonicalReceipt") and receipt["canonicalSha256"]==expected_canonical_sha256,
            "semantic_saved_canonical_hash_mismatch")
    return receipt
