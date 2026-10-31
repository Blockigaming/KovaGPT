"""V3 restore ordering using synthetic archives/readers and no database process.

The semantic source replay and target canonicalizer are real. Only the private
reader, destination proof, crypto and subprocess boundaries are controlled.
These tests are control-flow evidence, never native recovery qualification.
"""
from contextlib import ExitStack
import copy
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2]/"scripts/release/managed-auth-recovery.py"
spec = importlib.util.spec_from_file_location("managed_auth_semantic_recovery", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
sem = m.semantic_module()
SOURCE = "a"*40
CUSTOMER = b"SYNTHETIC-CUSTOMER-ROW-ONLY"


def scalar(raw):
    return {"isNull":False,"bytesHex":raw.hex()}


def identity(kind, *names):
    return {"type":kind,"object_names":list(names),"object_args":[]}


class Reader:
    """A registered same-snapshot wire, including one real canonical root row."""
    id = "00000001-00000002-1"
    snapshot_sha256 = "f"*64
    server_encoding = client_encoding = "UTF8"

    def __init__(self, events=None, *, relocated=False, after_last_read=None):
        self.events = events if events is not None else []
        self.after_last_read = after_last_read
        self.proof_reads = 0
        options = sem.relations.adapter_options(sem.core)
        references = [
            {"catalog":"pg_extension","oid":400,"subid":0,
             "identity":identity("extension","synthetic_extension"),"roundtrip":True},
            {"catalog":"pg_authid","oid":10,"subid":0,
             "identity":identity("role","postgres"),"roundtrip":True},
            {"catalog":"pg_namespace","oid":2200,"subid":0,
             "identity":identity("schema","extensions"),"roundtrip":True}]
        self.wire = {
            "operation":"PRIVATE_GHA_ONLY-extension-all-catalog-wire","privateRawWire":True,
            "sourceSnapshotSha256":self.snapshot_sha256,"serverVersionNum":170006,
            "catalogColumns":sem.core.layout_columns(options["manifests"]),
            "catalogForeignKeys":options["expected_foreign_keys"],
            "resolvedReferences":references,"rows":[{
                "catalog":"pg_extension","extensionOid":400,"values":{
                    "oid":400,"extname":scalar(b"synthetic_extension"),"extowner":10,
                    "extnamespace":2200,"extrelocatable":scalar(b"\x01" if relocated else b"\x00"),
                    "extversion":scalar(b"1.0"),"extconfig":None,"extcondition":None}}]}
        self.proof = {
            "serverVersionNum":170006,"serverEncoding":"UTF8","clientEncoding":"UTF8",
            "readOnly":True,"repeatableRead":True,"searchPath":"pg_catalog",
            "sourceSnapshotSha256":self.snapshot_sha256}

    def query(self, sql):
        if sql == sem.completed_statement(sem.CONTEXT_SQL):
            self.events.append("semantic-context-read")
            return {"privateWireContext":"PRIVATE_GHA_CAPTURE_ONLY","searchPath":"pg_catalog"}
        if sql == sem.completed_statement(sem.PROOF_SQL):
            self.proof_reads += 1
            self.events.append("semantic-last-read" if self.proof_reads == 2 else "semantic-first-read")
            if self.proof_reads == 2 and self.after_last_read:
                self.after_last_read()
            return copy.deepcopy(self.proof)
        if "PRIVATE_GHA_ONLY merged catalog capture body" in sql:
            self.events.append("semantic-catalog-read")
            return copy.deepcopy(self.wire)
        if "extension-nextval-regclass-datum-byteorder-audit" in sql:
            self.events.append("semantic-datum-read")
            return {"serverVersionNum":170006,"allObservedDatumsEightBytes":True,
                    "eightByteLittleEndianProven":True,"eightByteBigEndianProven":False}
        raise AssertionError("unregistered synthetic semantic query")


class SemanticRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.events = []
        self.approved = {
            "uri":"postgresql://operator@restore.invalid/postgres","host":"restore.invalid",
            "database":"postgres","port":5432,"expectedIp":"192.0.2.9","expectedSystemId":"123"}
        self.source_frame = sem.collect(Reader(), source_sha=SOURCE)

    def fixture(self, *, version=3, frame=None, manifest_changes=None):
        catalog = {
            "schemas":[{"name":name,"owner":"postgres","acl":None,"comment":None}
                       for name in ["auth","public","storage","realtime","supabase_migrations","extensions"]],
            "tables":[{"schema":"auth","name":name,"kind":"r"}
                      for name in ["identities","sessions","users"]],
            "bootstrapRole":"postgres","preinstalledObjects":[],"sequences":[],"roles":[],"memberships":[],"roleSettings":[],
            "extensions":[{"name":"synthetic_extension","version":"1.0","schema":"extensions","owner":"postgres"}],
            "largeObjects":[],"publications":[],"extensionData":[]}
        rows = [{"schema":"auth","name":name,"rows":int(name == "users"),"sha256":"d"*64}
                for name in ["identities","sessions","users"]]
        schema = b"-- SYNTHETIC SCHEMA ONLY\nCREATE TABLE fixture();\n"
        toc = b"1; 0 1 TABLE auth users postgres\n2; 0 2 TABLE DATA auth identities postgres\n3; 0 3 TABLE DATA auth sessions postgres\n4; 0 4 TABLE DATA auth users postgres\n"
        files = {"full.dump":b"SYNTHETIC-NOT-A-REAL-PG-DUMP","schema.sql":schema,
                 "managed-schema.sql":schema,"catalog.json":m.encoded(catalog),
                 "rows.json":m.encoded(rows),"toc.list":toc}
        if version >= 2:
            files["extension-data.json"] = m.encoded({"format":1,"tables":[],"sequences":[]})
        if version == 3:
            files["extension-semantic-source.json"] = m.encoded(frame or self.source_frame)
        canonical = self.source_frame["canonicalReceipt"]["canonicalSha256"]
        manifest = {
            "format":version,"operation":"complete-managed-auth-database-capture","project":m.PROJECT,
            "postgresBuild":m.BUILD,"consistentExportedSnapshot":True,"sourceSha":SOURCE,
            "extensionTableDataSameExportedSnapshot":True,"sequenceStateTransactionalSnapshot":False,
            "sequenceStateCapture":"non-mvcc-high-water-marks","schemaSha256":m.schema_hash(schema),
            "managedSchemaSha256":m.schema_hash(schema),"extensionSemanticCaptureSameExportedSnapshot":True,
            "extensionSemanticCoverageComplete":True,"extensionSemanticCanonicalSha256":canonical,
            "extensionSemanticSourceSnapshotSha256":self.source_frame["sourceSnapshotSha256"],
            "files":[{"name":name,"bytes":len(raw),"sha256":m.digest(raw)} for name,raw in files.items()]}
        manifest.update(manifest_changes or {})
        files["manifest.json"] = m.encoded(manifest)
        archive = self.root/("synthetic-"+str(len(list(self.root.iterdir())))+".tar")
        with tarfile.open(archive,"w") as tar:
            for name,raw in files.items():
                item = tarfile.TarInfo(name)
                item.size = len(raw)
                tar.addfile(item,io.BytesIO(raw))
        archive.chmod(0o600)
        env = {
            "KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED",
            "KOVA_AUTH_RESTORE_BASELINE_MODE":"empty-database",
            "KOVA_AUTH_BACKUP_ENCRYPTED_SHA256":m.file_digest(archive),
            "KOVA_APPROVED_BACKUP_SOURCE_SHA":SOURCE,
            "KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic-only-passphrase-at-least32-characters",
            "KOVA_AUTH_RESTORE_ATTESTATION_SHA256":"b"*64}
        attestation = {
            "baselineMode":"empty-database","emptyBaselineIndependentlyReviewed":True,
            "emptyBaselineSource":"pinned-image-template0-plus-extensions",
            **{key:"a"*64 for key in ["emptyBaselineCensusSha256","emptyBaselineCatalogSha256",
                                      "emptyBaselineRowsSha256","emptyBaselineSchemaSha256"]},
            "host":"restore.invalid","database":"postgres","port":5432,
            "serverIp":"192.0.2.9","systemIdentifier":"123",
            "actualImageRepoDigest":"public.ecr.aws/supabase/postgres@sha256:"+"c"*64,
            "customerImportRequiresSemanticEquality":True,"sourceCanonicalSemanticsSha256":canonical}
        return archive,env,attestation,catalog,rows,schema

    def stack(self, fixture, *, relocated=False, expire_after_semantic_read=False):
        archive,env,attestation,catalog,rows,schema = fixture
        stack = ExitStack()
        state = {"expired":False}
        reader = Reader(self.events,relocated=relocated,
                        after_last_read=lambda:state.update(expired=expire_after_semantic_read))

        def attest(_env):
            self.events.append("isolation-check")
            if state["expired"]:
                raise m.Stopped("isolation_attestation_stale")
            return copy.deepcopy(attestation)

        def command(argv, _env, **_kwargs):
            if argv[0] == "node":
                return m.encoded(self.approved)
            if argv[0] == "pg_restore":
                if "--dbname" in argv:
                    self.events.append("schema-write")
                    self.assertIn("--single-transaction",argv)
                else:
                    self.events.append("data-sql-generation")
                    self.assertIn("--file",argv)
                    Path(argv[argv.index("--file")+1]).write_bytes(
                        b"COPY auth.users (id) FROM stdin;\n"+CUSTOMER+b"\n\\.\n")
                return b""
            if argv[0] == "psql":
                self.events.append("customer-data-import")
                self.assertIn(CUSTOMER,Path(argv[argv.index("--file")+1]).read_bytes())
                self.assertIn("--single-transaction",argv)
                return b""
            if argv[0] == "pg_dump":
                self.events.append("final-schema-read")
                Path(argv[argv.index("--file")+1]).write_bytes(schema)
                return b""
            raise AssertionError("unregistered synthetic subprocess")

        def query(_env, sql, **_kwargs):
            if "has_parameter_privilege" in sql:
                return b"t"
            if "cron.launch_active_jobs" in sql:
                self.events.append("consumer-check")
                return b"off"
            if sql == m.EMPTY_IDENTITY_SQL:
                self.events.append("target-identity-read")
                return m.encoded({"database":"postgres","serverAddress":"192.0.2.9","serverPort":5432,
                                  "serverVersionNum":170006,"systemIdentifier":"123",
                                  "managedRelationsPresent":["auth.users"]})
            if sql == m.CATALOG_SQL:
                return m.encoded(catalog)
            if sql == m.EXTENSION_DATA_CATALOG_SQL:
                return b"[]"
            raise AssertionError("unregistered synthetic destination query")

        def offline_source(*args, **kwargs):
            self.events.append("offline-source-verification")
            return actual_verify_saved(*args, **kwargs)

        class Snapshot:
            def __init__(_self, target):
                self.assertEqual(target,{"SYNTHETIC_TARGET":"ONLY"})
            def __enter__(_self):
                self.events.append("target-semantic-snapshot-open")
                return reader
            def __exit__(_self,*_args):
                self.events.append("target-semantic-snapshot-close")

        actual_verify_saved = sem.verify_saved
        patches = {
            "attest":patch.object(m,"attest",side_effect=attest),
            "target_environment":patch.object(m,"target_environment",return_value={"SYNTHETIC_TARGET":"ONLY"}),
            "client_check":patch.object(m,"client_check"),
            "crypt":patch.object(m,"crypt",side_effect=lambda _e,_p,src,dst,decrypt:shutil.copyfile(src,dst)),
            "empty_target_preflight":patch.object(m,"empty_target_preflight",return_value=catalog),
            "run":patch.object(m,"run",side_effect=command),
            "psql":patch.object(m,"psql",side_effect=query),
            "row_fingerprints":patch.object(m,"row_fingerprints",return_value=rows),
            "semantic_module":patch.object(m,"semantic_module",return_value=sem),
            "Snapshot":patch.object(m,"Snapshot",Snapshot),
            "verify_saved":patch.object(sem,"verify_saved",side_effect=offline_source)}
        for name, item in patches.items():
            setattr(stack,name,stack.enter_context(item))
        return stack,reader

    def restore(self, fixture):
        return m.restore(fixture[1],fixture[0],self.root/"receipt.json")

    def assert_no_restore_mutation(self):
        self.assertNotIn("schema-write",self.events)
        self.assertNotIn("data-sql-generation",self.events)
        self.assertNotIn("customer-data-import",self.events)
        self.assertFalse((self.root/"receipt.json").exists())

    def test_offline_source_replay_rejects_corruption_before_any_schema_mutation(self):
        for change in [
                lambda frame:frame["helperSourceSha256"].update({next(iter(sem.HELPERS)):"0"*64}),
                lambda frame:frame["wire"]["rows"][0]["values"].update(extrelocatable=scalar(b"\x01")),
                lambda frame:frame["snapshotProof"].update(clientEncoding="LATIN1")]:
            frame = copy.deepcopy(self.source_frame)
            change(frame)
            fixture = self.fixture(frame=frame)
            self.events.clear()
            stack,reader = self.stack(fixture)
            with self.subTest(change=change),stack,self.assertRaisesRegex(m.Stopped,"extension_semantic_source_unqualified"):
                self.restore(fixture)
            self.assertEqual(stack.verify_saved.call_count,1)
            self.assertEqual(reader.proof_reads,0)
            self.assert_no_restore_mutation()

    def test_source_manifest_and_attestation_must_bind_exact_canonical_snapshot(self):
        for changes,attestation_changes in [
                ({"extensionSemanticSourceSnapshotSha256":"0"*64},{}),
                ({"extensionSemanticCoverageComplete":False},{}),
                ({"extensionSemanticCaptureSameExportedSnapshot":False},{}),
                ({},{"sourceCanonicalSemanticsSha256":"0"*64}),
                ({},{"customerImportRequiresSemanticEquality":False})]:
            fixture = self.fixture(manifest_changes=changes)
            fixture[2].update(attestation_changes)
            self.events.clear()
            stack,reader = self.stack(fixture)
            with self.subTest(changes=changes,attestation=attestation_changes),stack,\
                 self.assertRaisesRegex(m.Stopped,"extension_semantic_source_unqualified"):
                self.restore(fixture)
            stack.verify_saved.assert_not_called()
            self.assertEqual(reader.proof_reads,0)
            self.assert_no_restore_mutation()

    def test_semantic_required_attestation_rejects_both_legacy_archive_downgrades(self):
        for version in [1,2]:
            fixture = self.fixture(version=version)
            self.events.clear()
            stack,reader = self.stack(fixture)
            with self.subTest(version=version),stack,\
                 self.assertRaisesRegex(m.Stopped,"extension_semantic_source_unqualified"):
                self.restore(fixture)
            stack.verify_saved.assert_not_called()
            self.assertEqual(reader.proof_reads,0)
            self.assert_no_restore_mutation()

    def test_actual_target_canonical_drift_stops_after_schema_before_customer_import(self):
        fixture = self.fixture()
        stack,reader = self.stack(fixture,relocated=True)
        with stack,self.assertRaisesRegex(m.Stopped,"extension_semantic_target_mismatch"):
            self.restore(fixture)
        self.assertEqual(reader.proof_reads,2)
        self.assertLess(self.events.index("offline-source-verification"),self.events.index("schema-write"))
        self.assertLess(self.events.index("schema-write"),self.events.index("semantic-catalog-read"))
        self.assertNotIn("customer-data-import",self.events)
        self.assertFalse((self.root/"receipt.json").exists())

    def test_matching_real_canonicalizers_gate_customer_import_and_safe_success_receipt(self):
        fixture = self.fixture()
        stack,reader = self.stack(fixture)
        with stack:
            receipt = self.restore(fixture)
        self.assertEqual(reader.proof_reads,2)
        self.assertEqual(self.events.count("customer-data-import"),1)
        self.assertLess(self.events.index("offline-source-verification"),self.events.index("schema-write"))
        self.assertLess(self.events.index("schema-write"),self.events.index("semantic-first-read"))
        self.assertLess(self.events.index("semantic-last-read"),self.events.index("customer-data-import"))
        before_import = self.events[:self.events.index("customer-data-import")]
        self.assertEqual(before_import[-3:],["target-identity-read","consumer-check","isolation-check"])
        self.assertTrue(receipt["extensionSemanticsVerified"])
        self.assertEqual(receipt["extensionSemanticCanonicalSha256"],
                         self.source_frame["canonicalReceipt"]["canonicalSha256"])
        self.assertTrue(receipt["restoredDatabaseStateVerified"])
        self.assertFalse(receipt["productionMutated"])
        self.assertFalse(receipt["fullProjectRecoveryQualified"])
        self.assertEqual(json.loads((self.root/"receipt.json").read_bytes()),receipt)
        serialized = json.dumps(receipt)
        for private in [CUSTOMER.decode(),"wire","resolvedReferences","SYNTHETIC_TARGET","passphrase"]:
            self.assertNotIn(private,serialized)

    def test_attestation_expiring_during_target_last_read_blocks_data_import(self):
        fixture = self.fixture()
        stack,reader = self.stack(fixture,expire_after_semantic_read=True)
        with stack,self.assertRaisesRegex(m.Stopped,"isolation_attestation_stale"):
            self.restore(fixture)
        self.assertEqual(reader.proof_reads,2)
        self.assertIn("schema-write",self.events)
        self.assertIn("semantic-last-read",self.events)
        self.assertEqual(self.events[-3:],["target-identity-read","consumer-check","isolation-check"])
        self.assertNotIn("customer-data-import",self.events)
        self.assertFalse((self.root/"receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
