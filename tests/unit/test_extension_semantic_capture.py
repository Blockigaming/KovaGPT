"""Synthetic same-exporter binding/offline replay tests; no DB or customer data."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/extension-semantic-capture.py"
spec=importlib.util.spec_from_file_location("same_snapshot_semantics",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Reader:
    id="00000001-00000002-1"
    snapshot_sha256="a"*64
    server_encoding=client_encoding="UTF8"
    def __init__(self):
        options=m.relations.adapter_options(m.core)
        self.wire={"operation":"PRIVATE_GHA_ONLY-extension-all-catalog-wire","privateRawWire":True,
            "sourceSnapshotSha256":self.snapshot_sha256,"serverVersionNum":170006,
            "catalogColumns":m.core.layout_columns(options["manifests"]),
            "catalogForeignKeys":options["expected_foreign_keys"],"rows":[],"resolvedReferences":[]}
        self.proof={"serverVersionNum":170006,"serverEncoding":"UTF8","clientEncoding":"UTF8",
            "readOnly":True,"repeatableRead":True,"searchPath":"pg_catalog","sourceSnapshotSha256":self.snapshot_sha256}
        self.datum={"serverVersionNum":170006,"allObservedDatumsEightBytes":True,
                    "eightByteLittleEndianProven":True,"eightByteBigEndianProven":False}
        self.calls=[];self.proof_reads=0;self.changed=False
    def query(self,sql):
        self.calls.append(sql)
        if sql==m.completed_statement(m.CONTEXT_SQL):
            return {"privateWireContext":"PRIVATE_GHA_CAPTURE_ONLY","searchPath":"pg_catalog"}
        if sql==m.completed_statement(m.PROOF_SQL):
            self.proof_reads+=1
            return {**self.proof,"sourceSnapshotSha256":"b"*64} if self.changed and self.proof_reads>1 else self.proof
        if "PRIVATE_GHA_ONLY merged catalog capture body" in sql:return self.wire
        if "extension-nextval-regclass-datum-byteorder-audit" in sql:return self.datum
        raise AssertionError("unregistered synthetic query")


def env():return {"KOVA_AUTH_RECOVERY_CONFIRMATION":"CAPTURE_ONLY","GITHUB_EVENT_NAME":"workflow_dispatch",
    "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/heads/main","GITHUB_SHA":"c"*40,
    "KOVA_APPROVED_SOURCE_SHA":"c"*40,"KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION":m.BUILD}


class CaptureTests(unittest.TestCase):
    def test_capture_binds_actual_exporter_queries_and_offline_verification(self):
        r=Reader();value=m.capture(r,env())
        self.assertTrue(value["captureSnapshotBound"])
        self.assertEqual(r.proof_reads,2)
        self.assertEqual(value["sourceSnapshotSha256"],r.snapshot_sha256)
        self.assertEqual(value["exportedSnapshotIdSha256"],m.sha(r.id.encode()))
        self.assertTrue(all(q.endswith(';') for q in r.calls))
        self.assertEqual(len(value["queryEvidence"]),len(r.calls))
        for query,proof in zip(r.calls,value["queryEvidence"]):self.assertEqual(m.sha(query.encode()),proof["sha256"])
        summary=m.verify_saved(value,source_sha="c"*40,
            expected_canonical_sha256=value["canonicalReceipt"]["canonicalSha256"])
        self.assertEqual(summary,value["canonicalReceipt"])
        self.assertTrue(summary["allCatalogFieldsCovered"])
        self.assertFalse(summary["rawValuesReturned"])
        self.assertNotIn("wire",summary)

    def test_saved_provenance_envelope_cannot_be_omitted_or_reclassified(self):
        good=m.capture(Reader(),env());expected=good["canonicalReceipt"]["canonicalSha256"]
        changes=[lambda d:d.pop("queryEvidence"),lambda d:d.pop("exportedSnapshotIdSha256"),
            lambda d:d["wire"].update(operation="public-hash-only"),
            lambda d:d["wire"].update(privateRawWire=False),lambda d:d["wire"].update(serverVersionNum=180003),
            lambda d:d["snapshotProof"].update(searchPath="public"),lambda d:d["datumProof"].update(serverVersionNum=180003),
            lambda d:d["queryEvidence"][0].update(sha256="0"*64),lambda d:d["queryEvidence"].pop(),
            lambda d:d["queryEvidence"][3].update(stage="lazy-reference"),
            lambda d:d.update(privateRawWire=False),lambda d:d.update(customerRowsRead=True)]
        for change in changes:
            changed=copy.deepcopy(good);change(changed)
            with self.subTest(change=change),self.assertRaises(m.Stopped):
                m.verify_saved(changed,source_sha="c"*40,expected_canonical_sha256=expected)

    def test_wrong_capture_context_is_rejected_before_queries(self):
        for key,value in [("KOVA_AUTH_RECOVERY_CONFIRMATION","RESTORE_EMPTY_ISOLATED"),
            ("GITHUB_EVENT_NAME","pull_request"),("GITHUB_REF","refs/heads/other"),
            ("GITHUB_REPOSITORY","other/repo"),("KOVA_APPROVED_SOURCE_SHA","d"*40)]:
            r=Reader()
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.capture(r,{**env(),key:value})
            self.assertEqual(r.calls,[])

    def test_wrong_exporter_encoding_or_digest_has_no_private_read(self):
        for key,value in [("client_encoding","LATIN1"),("server_encoding","LATIN1"),
                          ("snapshot_sha256","bad"),("id","not-an-exported-snapshot")]:
            r=Reader();setattr(r,key,value)
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.capture(r,env())
            self.assertEqual(r.calls,[])

    def test_wire_snapshot_drift_denied_raw_wire_or_wrong_version_cannot_be_bound(self):
        for key,value in [("sourceSnapshotSha256","b"*64),("privateRawWire",False),
                          ("serverVersionNum",180003)]:
            r=Reader();r.wire[key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.capture(r,env())
        r=Reader();r.changed=True
        with self.assertRaisesRegex(m.Stopped,"semantic_snapshot_binding_mismatch|semantic_exporter_changed"):
            m.capture(r,env())

    def test_unproven_or_ambiguous_datum_encoding_is_rejected(self):
        for changes in [{"eightByteLittleEndianProven":False},{"eightByteBigEndianProven":True},
                        {"allObservedDatumsEightBytes":False},{"serverVersionNum":180003}]:
            r=Reader();r.datum.update(changes)
            with self.subTest(changes=changes),self.assertRaises(m.Stopped):m.capture(r,env())

    def test_saved_payload_source_helpers_snapshot_abi_and_hash_are_all_bound(self):
        good=m.capture(Reader(),env());expected=good["canonicalReceipt"]["canonicalSha256"]
        for change in [lambda d:d.update(sourceSha="d"*40),lambda d:d.update(captureSnapshotBound=False),
             lambda d:d["helperSourceSha256"].update({next(iter(m.HELPERS)):"0"*64}),
             lambda d:d["wire"].update(sourceSnapshotSha256="0"*64),
             lambda d:d["snapshotProof"].update(clientEncoding="LATIN1"),
             lambda d:d["datumLayout"].update(byteorder="big"),
             lambda d:d["canonicalReceipt"].update(canonicalSha256="0"*64)]:
            bad=copy.deepcopy(good);change(bad)
            with self.assertRaises(m.Stopped):m.verify_saved(bad,source_sha="c"*40,expected_canonical_sha256=expected)
        with self.assertRaises(m.Stopped):m.verify_saved(good,source_sha="c"*40,expected_canonical_sha256="0"*64)

    def test_lazy_reference_must_match_same_snapshot_and_private_guard(self):
        r=Reader();session=m.Session(r)
        with patch.object(r,"query",return_value={"privateRawWire":True,"serverVersionNum":170006,
                           "sourceSnapshotSha256":"0"*64,"resolvedReferences":[]}):
            with self.assertRaisesRegex(m.Stopped,"semantic_lazy_reference_binding_mismatch"):
                session.lookup("pg_type",23,0)
        row={"catalog":"pg_type","oid":23,"subid":0,
             "identity":{"type":"type","object_names":["integer"],"object_args":[]},"roundtrip":True}
        session.add_references([row])
        self.assertEqual(session.lookup("pg_type",23,0)["identity"],row["identity"])
        changed={**row,"identity":{"type":"type","object_names":["bigint"],"object_args":[]}}
        with self.assertRaisesRegex(m.Stopped,"semantic_reference_changed"):session.add_references([changed])

    def test_deadline_preempts_capture_and_raw_wire_bounds_are_enforced(self):
        def expired():raise RuntimeError("fixed synthetic deadline")
        r=Reader()
        with self.assertRaisesRegex(RuntimeError,"fixed synthetic deadline"):
            m.capture(r,env(),check_deadline=expired)
        self.assertEqual(r.calls,[])
        with patch.object(m,"MAX_BYTES",64):
            with self.assertRaisesRegex(m.Stopped,"semantic_capture_bound_exceeded"):m.capture(Reader(),env())


if __name__=="__main__":unittest.main()
