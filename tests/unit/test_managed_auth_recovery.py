"""Only synthetic payloads/mocked DB commands; never contacts a database."""
from contextlib import contextmanager
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2]/"scripts/release/managed-auth-recovery.py"
spec = importlib.util.spec_from_file_location("managed_auth_recovery", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def catalog():
    return {"schemas":[{"name":n,"owner":"postgres","acl":None,"comment":None} for n in ["auth","public","storage","realtime","supabase_migrations"]],
            "tables":[{"schema":"auth","name":n,"kind":"r"} for n in ["identities","sessions","users"]],
            "preinstalledObjects":[],"sequences":[],"roles":[],"memberships":[],"roleSettings":[],"extensions":[],"largeObjects":[],"publications":[]}


TOC = "\n".join(f"{i}; 0 {i} TABLE DATA auth {n} postgres" for i,n in enumerate(["identities","sessions","users"],1))+"\n"


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ca = self.root/"ca.pem"
        self.ca.write_text("public synthetic CA fixture")

    def source_env(self, uri=None):
        return {"KOVA_PRODUCTION_DATABASE_URL":uri or f"postgresql://postgres:synthetic-password@db.{m.PROJECT}.supabase.co:5432/postgres",
                "KOVA_RECOVERY_CA_BUNDLE":str(self.ca),"PATH":os.environ["PATH"],"HOME":self.temp.name}

    def test_source_only_exact_production_direct_or_session_pooler_and_verified_tls(self):
        env = m.source_environment(self.source_env())
        self.assertEqual(env["PGSSLMODE"],"verify-full")
        self.assertEqual(env["PGPASSWORD"],"synthetic-password")
        self.assertIn("default_transaction_read_only=on",env["PGOPTIONS"])
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL",env)
        good=f"postgresql://postgres.{m.PROJECT}:synthetic-password@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=verify-full"
        self.assertEqual(m.source_environment(self.source_env(good))["PGPORT"],"5432")
        for bad in [good.replace(":5432",":6543"),good.replace(m.PROJECT,"wrong"),good.replace("verify-full","disable"),good+"&options=anything",good+"#fragment",good.replace("postgres?","other?")]:
            with self.subTest(uri="nonsecret-rejected-fixture"), self.assertRaises(m.Stopped):
                m.source_environment(self.source_env(bad))

    def test_private_child_environment_excludes_provider_credentials_and_pg_overrides(self):
        out=m.clean_pg_env({"PATH":"safe","PGSERVICE":"unsafe","PGOPTIONS":"unsafe","OPENAI_API_KEY":"synthetic","KOVA_PRODUCTION_DATABASE_URL":"synthetic","KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic"})
        self.assertEqual(set(out),{"PATH","PGCONNECT_TIMEOUT","PGAPPNAME"})

    def test_private_errors_never_echo_child_diagnostics(self):
        result=subprocess.CompletedProcess(["psql"],1,stdout=b"synthetic private rows",stderr=b"synthetic private key")
        with patch.object(m.subprocess,"run",return_value=result):
            with self.assertRaisesRegex(m.Stopped,"^private_command_unconfirmed$"):
                m.run(["psql"],{})

    def test_actual_snapshot_query_reads_json_with_fake_process_and_selector(self):
        waits=[]
        class Selector:
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def register(self,*_):pass
            def select(self,timeout):waits.append(timeout);return [object()]
        snapshot=m.Snapshot({})
        snapshot.process=SimpleNamespace(poll=lambda:None,stdin=io.BytesIO(),stdout=SimpleNamespace(fileno=lambda:17))
        snapshot.buffer=b""
        with patch.object(m.selectors,"DefaultSelector",Selector),patch.object(m.os,"read",side_effect=[b'{"ok":',b'true}\n']):
            self.assertEqual(snapshot.query("SELECT fixture;",begin=True),{"ok":True})
        self.assertEqual(snapshot.process.stdin.getvalue(),b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT fixture;\n")
        self.assertEqual(len(waits),2)
        self.assertTrue(all(0 < n <= 125 for n in waits))

    def test_file_hash_stops_when_deadline_crosses_during_local_chunks(self):
        data=self.root/"synthetic-large";data.write_bytes(b"x"*(2*1024**2))
        with patch.object(m,"DEADLINE",1),patch.object(m.time,"monotonic",side_effect=[0,2]):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):m.file_digest(data)

    def test_archive_scan_stops_when_deadline_crosses_between_members(self):
        archive=self.root/"synthetic-valid.tar"
        with tarfile.open(archive,"w") as tar:
            for name in sorted(m.MEMBERS):
                info=tarfile.TarInfo(name);info.size=1;tar.addfile(info,io.BytesIO(b"x"))
        out=self.root/"archive-out";out.mkdir()
        with patch.object(m,"DEADLINE",1),patch.object(m.time,"monotonic",side_effect=[0,2]):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):m.bounded_archive(archive,out)
        self.assertEqual(list(out.iterdir()),[])

    def test_row_proof_stops_when_deadline_crosses_during_local_iteration(self):
        def query(_env,_sql,output):output.write((b"a"*64+b"\n")*2)
        with patch.object(m,"psql",side_effect=query),patch.object(m,"DEADLINE",1),patch.object(m.time,"monotonic",side_effect=[0,2]):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):
                m.row_fingerprints({}, {**catalog(),"tables":[{"schema":"auth","name":"users","kind":"r"}]})

    def test_success_receipt_is_absent_if_deadline_crosses_serialization_or_write(self):
        for stage in ["serialization","write"]:
            with self.subTest(stage=stage):
                clock={"now":0};out=self.root/(stage+"-receipt.json")
                real_encoded,real_fresh=m.encoded,m.fresh_file
                def encode(value):
                    raw=real_encoded(value)
                    if stage=="serialization":clock["now"]=2
                    return raw
                def write(path,data):
                    real_fresh(path,data)
                    if stage=="write":clock["now"]=2
                with patch.object(m,"DEADLINE",1),patch.object(m.time,"monotonic",side_effect=lambda:clock["now"]),patch.object(m,"encoded",side_effect=encode),patch.object(m,"fresh_file",side_effect=write):
                    with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):
                        m.write_success_receipt(out,{"ok":True})
                self.assertFalse(out.exists())

    def test_archive_extraction_stops_when_deadline_crosses_during_private_read(self):
        archive=self.root/"synthetic-extract.tar"
        with tarfile.open(archive,"w") as tar:
            for name in sorted(m.MEMBERS):
                info=tarfile.TarInfo(name);info.size=1;tar.addfile(info,io.BytesIO(b"x"))
        out=self.root/"extract-out";out.mkdir();clock={"now":0}
        real_read=tarfile.ExFileObject.read
        def read(raw,size=-1):
            data=real_read(raw,size);clock["now"]=2;return data
        with patch.object(m,"DEADLINE",1),patch.object(m.time,"monotonic",side_effect=lambda:clock["now"]),patch.object(tarfile.ExFileObject,"read",read):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):m.bounded_archive(archive,out)
        self.assertTrue(all(p.stat().st_size==0 for p in out.iterdir()))

    def test_private_stdout_and_whole_operation_deadlines_are_bounded(self):
        with patch.object(m,"STDOUT_BYTES",8):
            with self.assertRaisesRegex(m.Stopped,"private_output_bound_exceeded"):
                m.run(["python3","-c","print('synthetic output too long')"],{"PATH":os.environ["PATH"]})
        with patch.object(m,"DEADLINE",m.time.monotonic()-1):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):m.remaining(900)
        with patch.object(m.resource,"setrlimit") as limit:
            m.child_limits();limit.assert_called_once_with(m.resource.RLIMIT_FSIZE,(m.MAX_BYTES,m.MAX_BYTES))

    def test_private_file_rejects_symlink_or_permissive_material(self):
        p=self.root/"private";p.write_text("fixture");p.chmod(0o600)
        self.assertEqual(m.private_file(p),p)
        q=self.root/"link";q.symlink_to(p)
        with self.assertRaises(m.Stopped):m.private_file(q)
        p.chmod(0o644)
        with self.assertRaises(m.Stopped):m.private_file(p)

    def test_schema_comparison_preserves_owner_grants_and_function_bodies(self):
        a=b"-- PostgreSQL database dump\n\\restrict AAA\n-- Dumped by pg_dump version 17.6\nSET statement_timeout = 0;\nCREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $$ SELECT 'private'; $$;\nALTER FUNCTION public.f() OWNER TO postgres;\n\\unrestrict AAA\n"
        b=a.replace(b"AAA",b"BBB")
        self.assertEqual(m.schema_hash(a),m.schema_hash(b))
        self.assertNotEqual(m.schema_hash(a),m.schema_hash(a.replace(b"OWNER TO postgres",b"OWNER TO anon")))
        self.assertNotEqual(m.schema_hash(a),m.schema_hash(a.replace(b"'private'",b"'different'")))

    def test_toc_rejects_unknown_external_execution_and_incomplete_hosted_data(self):
        entries=m.toc_entries(TOC)
        m.table_coverage(catalog(),entries)
        with self.assertRaises(m.Stopped):m.table_coverage(catalog(),entries[:-1])
        with self.assertRaises(m.Stopped):m.toc_entries("42; 0 42 SUBSCRIPTION - unsafe postgres\n")

    def test_managed_baseline_is_not_replayed_and_namespace_owner_acl_mismatch_stops(self):
        c=catalog();t=json.loads(json.dumps(c))
        entries=m.toc_entries("10; 2615 10 SCHEMA - public postgres\n11; 1259 11 TABLE auth users postgres\n12; 1259 12 TABLE public chats postgres\n13; 0 13 ACL - SCHEMA public postgres\n")
        out=m.schema_restore_list(entries,c,t).decode()
        self.assertEqual(out,"12; 1259 12 TABLE public chats postgres\n")
        t["schemas"][1]["acl"]=["unsafe"]
        with self.assertRaises(m.Stopped):m.schema_restore_list(entries,c,t)

    def test_role_privileges_are_not_discarded_or_silently_replaced(self):
        c=catalog();t=catalog()
        m.role_compatibility(c,t,[])
        t["memberships"]=[{"role":"postgres","member":"anon"}]
        with self.assertRaises(m.Stopped):m.role_compatibility(c,t,[])

    def test_sequence_identity_values_come_from_captured_archive_not_live_source(self):
        self.assertEqual(m.sequence_values(b"SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 9, false);\n"),[{"schema":"auth","name":"refresh_tokens_id_seq","value":"9","called":False}])
        with self.assertRaises(m.Stopped):m.sequence_values(b"SELECT pg_catalog.setval('unreviewed name', 9, false);\n")

    def test_unpopulated_materialized_view_needs_no_data_read_but_retains_population_state(self):
        c=catalog();c["tables"].append({"schema":"public","name":"not_ready","kind":"m","populated":False})
        m.table_coverage(c,m.toc_entries(TOC))
        with patch.object(m,"psql") as query:
            m.row_fingerprints({}, {**c,"tables":[c["tables"][-1]]})
        query.assert_not_called()

    def test_materialized_refresh_is_separate_from_data_only_and_preserves_toc_order(self):
        entries=m.toc_entries("1; 0 1 TABLE DATA public source postgres\n2; 0 2 MATERIALIZED VIEW DATA public first postgres\n3; 0 3 MATERIALIZED VIEW DATA public second postgres\n")
        self.assertEqual(m.materialized_restore_list(entries),b"2; 0 2 MATERIALIZED VIEW DATA public first postgres\n3; 0 3 MATERIALIZED VIEW DATA public second postgres\n")
        self.assertEqual(m.materialized_restore_list(entries[:1]),b"")

    def test_archive_refuses_duplicate_traversal_or_nonregular_members(self):
        for attack in ["duplicate","link","traversal"]:
            archive=self.root/f"{attack}.tar"
            with tarfile.open(archive,"w") as tar:
                for n in m.MEMBERS:
                    info=tarfile.TarInfo(n);info.size=1;tar.addfile(info,io.BytesIO(b"x"))
                if attack=="duplicate":
                    info=tarfile.TarInfo("manifest.json");info.size=1;tar.addfile(info,io.BytesIO(b"x"))
                elif attack=="link":
                    info=tarfile.TarInfo("link");info.type=tarfile.SYMTYPE;info.linkname="/outside";tar.addfile(info)
                else:
                    info=tarfile.TarInfo("../outside");info.size=1;tar.addfile(info,io.BytesIO(b"x"))
            out=self.root/attack;out.mkdir()
            with self.assertRaises(m.Stopped):m.bounded_archive(archive,out)
            self.assertEqual(list(out.iterdir()),[])

    def test_mocked_capture_artifact_boundary_and_roundtrip_gate(self):
        closed=[]
        @contextmanager
        def snap(_):
            class S:
                id="00000001-00000002-1"
                def query(self,_):return catalog()
            try:yield S()
            finally:closed.append(True)
        def fixture_crypt(_env,_phrase,src,dest,decrypt=False):
            # Deterministic fake cipher tests only the operator artifact boundary;
            # it is explicitly not cryptographic evidence.
            raw=src.read_bytes()
            dest.write_bytes(raw[len(b"FIXTURE-CIPHER:"):][::-1] if decrypt else b"FIXTURE-CIPHER:"+raw[::-1])
            dest.chmod(0o600)
        calls=[]
        def fake(argv,env,**kwargs):
            calls.append(argv)
            if argv[0]=="pg_dump":
                target=Path(argv[argv.index("--file")+1])
                target.write_bytes(b"AUTH_PASSWORD_HASH_SHOULD_STAY_PRIVATE" if "--format=custom" in argv else b"-- synthetic schema\nCREATE TABLE fixture();\n")
                return b""
            if argv[:2]==["pg_restore","--list"]:return TOC.encode()
            self.fail("unexpected private command")
        env={"PATH":os.environ["PATH"],"HOME":self.temp.name,"KOVA_AUTH_RECOVERY_CONFIRMATION":"CAPTURE_ONLY","GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,"GITHUB_REF":"refs/heads/main","KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION":m.BUILD,"KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic-fixture-only-passphrase-at-least32"}
        output=self.root/"encrypted-output"
        with patch.object(m,"Snapshot",snap),patch.object(m,"source_environment",return_value={"PATH":os.environ["PATH"],"HOME":self.temp.name}),patch.object(m,"client_check"),patch.object(m,"row_fingerprints",return_value=[]),patch.object(m,"run",side_effect=fake),patch.object(m,"crypt",side_effect=fixture_crypt):
            result=m.capture(env,output)
        self.assertEqual(closed,[True])
        self.assertEqual({p.name for p in output.iterdir()},{"managed-auth-backup.tar.gpg","capture-receipt.json"})
        self.assertNotIn(b"AUTH_PASSWORD_HASH_SHOULD_STAY_PRIVATE",(output/"managed-auth-backup.tar.gpg").read_bytes())
        self.assertTrue(result["encryptedRoundtripVerified"])
        self.assertFalse(result["restoreExercised"])
        self.assertFalse(result["credentialCustodyQualified"])
        self.assertFalse(result["fullProjectRecoveryQualified"])
        self.assertNotIn("synthetic-fixture-only-passphrase",json.dumps(calls))
        self.assertEqual(sum("--snapshot" in c for c in calls),3)

    @unittest.skipUnless(shutil.which("gpg"),"GPG unavailable; no crypto fixture claimed")
    def test_real_gpg_synthetic_roundtrip_when_agent_supported(self):
        plain=self.root/"plain";plain.write_bytes(b"SYNTHETIC FIXTURE ONLY")
        enc=self.root/"cipher.gpg";out=self.root/"roundtrip"
        env={"PATH":os.environ["PATH"],"HOME":self.temp.name}
        phrase=b"synthetic-fixture-only-passphrase-at-least32"
        try:m.crypt(env,phrase,plain,enc)
        except m.Stopped:self.skipTest("GPG agent unavailable on this host; live crypto gate remains unqualified")
        m.crypt(env,phrase,enc,out,decrypt=True)
        self.assertEqual(out.read_bytes(),plain.read_bytes())
        self.assertNotIn(plain.read_bytes(),enc.read_bytes())

    def test_service_markers_must_match_and_only_their_rows_are_omitted(self):
        empty=m.digest(b"")
        source=[{"schema":s,"name":n,"rows":1,"sha256":"a"*64} for s,n in sorted(m.BASELINE_SERVICE_TABLES)]
        target=source+[{"schema":"auth","name":"users","rows":0,"sha256":empty}]
        skip=m.baseline_service_data(source,target)
        entries=m.toc_entries("1; 0 1 TABLE DATA auth schema_migrations postgres\n2; 0 2 TABLE DATA storage migrations postgres\n3; 0 3 TABLE DATA auth users postgres\n4; 0 4 SEQUENCE SET storage migrations_id_seq postgres\n")
        selected=m.data_restore_list(entries,skip).decode()
        self.assertNotIn("TABLE DATA auth schema_migrations",selected)
        self.assertNotIn("TABLE DATA storage migrations",selected)
        self.assertIn("TABLE DATA auth users",selected)
        self.assertIn("SEQUENCE SET storage migrations_id_seq",selected)
        for bad in [target[:-1]+[{"schema":"auth","name":"users","rows":1,"sha256":"b"*64}],target[1:], [{**row,"sha256":"b"*64} for row in target]]:
            with self.assertRaises(m.Stopped):m.baseline_service_data(source,bad)

    def test_nonmanaged_extension_seed_data_cannot_survive_prewrite_gate(self):
        markers=[{"schema":s,"name":n,"rows":1,"sha256":"a"*64} for s,n in sorted(m.BASELINE_SERVICE_TABLES)]
        seed={"schema":"extensions","name":"configuration","rows":1,"sha256":"b"*64}
        with self.assertRaisesRegex(m.Stopped,"isolated_seed_data_reconciliation_required"):
            m.baseline_service_data(markers,markers+[seed])
        self.assertEqual(m.baseline_service_data(markers,markers+[{**seed,"rows":0}]),m.BASELINE_SERVICE_TABLES)

    def test_foreign_tables_and_unverified_materialized_data_stop(self):
        c=catalog();c["tables"].append({"schema":"public","name":"remote","kind":"f"})
        with self.assertRaisesRegex(m.Stopped,"foreign_data_recovery_unqualified"):m.identifiers(c)
        c=catalog();c["tables"].append({"schema":"public","name":"rollup","kind":"m","populated":True})
        with self.assertRaisesRegex(m.Stopped,"materialized_data_coverage_missing"):m.table_coverage(c,m.toc_entries(TOC))

    def test_failed_capture_cleans_partial_output_and_closes_snapshot(self):
        closed=[]
        @contextmanager
        def snap(_):
            class S:
                id="00000001-00000002-1"
                def query(self,_):return catalog()
            try:yield S()
            finally:closed.append(True)
        env={"KOVA_AUTH_RECOVERY_CONFIRMATION":"CAPTURE_ONLY","GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,"GITHUB_REF":"refs/heads/main","KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION":m.BUILD,"KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic-fixture-only-passphrase-at-least32"}
        out=self.root/"partial"
        with patch.object(m,"Snapshot",snap),patch.object(m,"source_environment",return_value={}),patch.object(m,"client_check"),patch.object(m,"run",side_effect=m.Stopped("private_command_unconfirmed")):
            with self.assertRaises(m.Stopped):m.capture(env,out)
        self.assertEqual(closed,[True])
        self.assertFalse(out.exists())

    def test_restore_refuses_unqualified_isolation_before_decrypting(self):
        with patch.object(m,"attest",side_effect=m.Stopped("isolation_attestation_rejected")),patch.object(m,"crypt") as decrypt:
            with self.assertRaises(m.Stopped):m.restore({"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_ISOLATED"},self.root/"archive",self.root/"receipt")
        decrypt.assert_not_called()

    def test_reused_guard_rejects_production_destination_without_contact(self):
        pgpass=self.root/"pgpass";pgpass.write_text("synthetic-fixture-only");pgpass.chmod(0o600)
        env={"PATH":os.environ["PATH"],"PGPASSFILE":str(pgpass),
             "APPROVED_ISOLATED_PG17_DATABASE_URL":f"postgresql://postgres@db.{m.PROJECT}.supabase.co:5432/postgres",
             "APPROVED_ISOLATED_HOST":f"db.{m.PROJECT}.supabase.co","APPROVED_ISOLATED_DBNAME":"postgres",
             "APPROVED_ISOLATED_PORT":"5432","APPROVED_ISOLATED_SERVER_IP":"192.0.2.1","APPROVED_ISOLATED_SYSTEM_IDENTIFIER":"123"}
        with self.assertRaisesRegex(m.Stopped,"private_command_unconfirmed"):
            m.run(["node",str(m.GUARD),"--configuration"],env,timeout=5)

    def test_restore_stops_on_managed_baseline_mismatch_before_any_restore_write(self):
        c=catalog()
        for schema,name in sorted(m.BASELINE_SERVICE_TABLES):c["tables"].append({"schema":schema,"name":name,"kind":"r"})
        rows=[{"schema":schema,"name":name,"rows":1,"sha256":"a"*64} for schema,name in sorted(m.BASELINE_SERVICE_TABLES)]
        rows += [{"schema":"auth","name":name,"rows":0,"sha256":m.digest(b"")} for name in ["identities","sessions","users"]]
        schema=b"-- synthetic managed baseline\nCREATE TABLE fixture_a();\n"
        files={"full.dump":b"synthetic dump","schema.sql":schema,"managed-schema.sql":schema,
               "catalog.json":m.encoded(c),"rows.json":m.encoded(rows),"toc.list":TOC.encode()}
        manifest={"format":1,"operation":"complete-managed-auth-database-capture","project":m.PROJECT,
                  "postgresBuild":m.BUILD,"consistentExportedSnapshot":True,"sourceSha":"a"*40,
                  "managedSchemaSha256":m.schema_hash(schema),
                  "files":[{"name":name,"bytes":len(raw),"sha256":m.digest(raw)} for name,raw in files.items()]}
        files["manifest.json"]=m.encoded(manifest)
        archive=self.root/"encrypted-fixture"  # fake crypt below; no actual private data
        with tarfile.open(archive,"w") as tar:
            for name,raw in files.items():
                info=tarfile.TarInfo(name);info.size=len(raw);tar.addfile(info,io.BytesIO(raw))
        archive.chmod(0o600)
        approved={"uri":"postgresql://operator@restore.invalid/postgres","host":"restore.invalid","database":"postgres","port":5432,"expectedIp":"192.0.2.1","expectedSystemId":"123"}
        att={"host":"restore.invalid","database":"postgres","port":5432,"serverIp":"192.0.2.1","systemIdentifier":"123"}
        env={"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_ISOLATED","KOVA_AUTH_BACKUP_ENCRYPTED_SHA256":m.file_digest(archive),
             "KOVA_APPROVED_BACKUP_SOURCE_SHA":"a"*40,"KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic-fixture-only-passphrase-at-least32"}
        calls=[]
        def command(argv,_env,**_kwargs):
            calls.append(argv)
            if argv[0]=="node":return m.encoded(approved) if "--configuration" in argv else b'{"ok":true}'
            if argv[0]=="pg_dump":Path(argv[argv.index("--file")+1]).write_bytes(schema.replace(b"fixture_a",b"fixture_b"));return b""
            self.fail("unexpected restore write")
        def query(_env,sql,**_kwargs):
            if "has_parameter_privilege" in sql:return b"t"
            if "cron.launch_active_jobs" in sql:return b"off"
            if sql==m.CATALOG_SQL:return m.encoded(c)
            self.fail("unexpected DB query")
        with patch.object(m,"attest",return_value=att),patch.object(m,"target_environment",return_value={}),patch.object(m,"client_check"),patch.object(m,"crypt",side_effect=lambda _e,_p,src,dst,decrypt:shutil.copyfile(src,dst)),patch.object(m,"target_observation",return_value={"observed":{"serverVersionNum":170006}}),patch.object(m,"run",side_effect=command),patch.object(m,"psql",side_effect=query),patch.object(m,"row_fingerprints",return_value=rows):
            with self.assertRaisesRegex(m.Stopped,"managed_ddl_baseline_mismatch"):
                m.restore(env,archive,self.root/"receipt.json")
        self.assertFalse(any(argv[0] in {"pg_restore","psql"} for argv in calls))
        self.assertFalse((self.root/"receipt.json").exists())

    def test_capture_workflow_uses_existing_protected_secrets_and_uploads_ciphertext_only(self):
        workflow=(SCRIPT.parents[2]/".github/workflows/capture-managed-auth-production.yml").read_text()
        for literal in ["refs/heads/main","inputs.source_sha == github.sha","CAPTURE_ONLY","name: production","secrets.KOVA_PRODUCTION_DATABASE_URL","secrets.KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926","retention-days: 7"]:
            self.assertIn(literal,workflow)
        upload=workflow[workflow.index("path: |") : workflow.index("if-no-files-found:")]
        self.assertIn("managed-auth-backup.tar.gpg",upload)
        self.assertIn("capture-receipt.json",upload)
        for forbidden in [".sql","full.dump","catalog.json","rows.json","manifest.json"]:self.assertNotIn(forbidden,upload)
        for forbidden in ["restore --execute","apply_migration","az containerapp","deploy_edge_function"]:self.assertNotIn(forbidden,workflow)


if __name__ == "__main__":unittest.main()
