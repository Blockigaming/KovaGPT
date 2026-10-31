"""Synthetic target/archive fixtures only; no production or actual restore."""
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2]/"scripts/release/managed-auth-recovery.py"
spec = importlib.util.spec_from_file_location("managed_auth_empty_recovery", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def catalog():
    return {"schemas":[{"name":n,"owner":"postgres","acl":None,"comment":None}
                        for n in ["auth","public","storage","realtime","supabase_migrations"]],
            "tables":[],"preinstalledObjects":[],"sequences":[],"roles":[],
            "memberships":[],"roleSettings":[],"extensions":[],"largeObjects":[],"publications":[]}


def attestation():
    return {"baselineMode":"empty-database","emptyBaselineIndependentlyReviewed":True,
            "emptyBaselineSource":"pinned-image-template0-plus-extensions",
            **{k:"a"*64 for k in ["emptyBaselineCensusSha256","emptyBaselineCatalogSha256",
                                  "emptyBaselineRowsSha256","emptyBaselineSchemaSha256"]}}


class EmptyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.approved = {"uri":"postgresql://operator@restore.invalid/postgres",
                         "host":"restore.invalid","database":"postgres","port":5432,
                         "expectedIp":"192.0.2.9","expectedSystemId":"123"}

    def test_unknown_or_implicit_empty_mode_never_falls_back(self):
        good={"KOVA_AUTH_RESTORE_BASELINE_MODE":"empty-database",
              "KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED"}
        self.assertEqual(m.restore_baseline_mode(good,attestation()),"empty-database")
        for bad in [{**good,"KOVA_AUTH_RESTORE_BASELINE_MODE":"anything"},
                    {"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED"},
                    {**good,"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_ISOLATED"}]:
            with self.subTest(env=bad),self.assertRaises(m.Stopped):
                m.restore_baseline_mode(bad,attestation())
        self.assertEqual(m.restore_baseline_mode({"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_ISOLATED"},{}),"managed-baseline")

    def test_empty_mode_requires_bound_reviewed_template0_baseline_and_every_pin(self):
        env={"KOVA_AUTH_RESTORE_BASELINE_MODE":"empty-database",
             "KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED"}
        good=attestation()
        for key in good:
            bad={k:v for k,v in good.items() if k!=key}
            with self.subTest(missing=key),self.assertRaises(m.Stopped):m.restore_baseline_mode(env,bad)
        for key,value in [("emptyBaselineIndependentlyReviewed",False),
                          ("emptyBaselineSource","hash-current-target-and-call-it-empty"),
                          ("emptyBaselineCensusSha256","x"*64)]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.restore_baseline_mode(env,{**good,key:value})

    def test_complete_managed_and_application_schema_order_and_ownership_are_retained(self):
        c=catalog();c["extensions"]=[{"name":"plpgsql","version":"1.0","schema":"pg_catalog"}]
        t=catalog();t["schemas"]=[s for s in c["schemas"] if s["name"]=="public"]
        t["extensions"]=c["extensions"]
        lines=["1; 0 1 EXTENSION - plpgsql postgres", "2; 0 2 SCHEMA - public postgres",
               "3; 0 3 SCHEMA - auth postgres", "4; 0 4 TABLE auth users postgres",
               "5; 0 5 TABLE public project_members postgres",
               "6; 0 6 FUNCTION public is_project_member(uuid, uuid) postgres",
               "7; 0 7 POLICY storage objects project_files_read postgres",
               "8; 0 8 ACL public FUNCTION is_project_member(uuid, uuid) postgres",
               "9; 0 9 ROW SECURITY auth users postgres", "10; 0 10 TABLE DATA auth users postgres",
               "11; 0 11 COMMENT - EXTENSION plpgsql postgres"]
        out=m.empty_schema_restore_list(m.toc_entries("\n".join(lines)),c,t).decode().splitlines()
        self.assertEqual(out,lines[2:9]+[lines[10]])
        old=m.schema_restore_list(m.toc_entries("\n".join(lines)),c,t).decode()
        self.assertNotIn("TABLE auth users",old)

    def test_blank_mode_restores_service_markers_instead_of_borrowing_old_skip_list(self):
        lines=[f"{i}; 0 {i} TABLE DATA {s} {n} postgres" for i,(s,n) in enumerate(sorted(m.BASELINE_SERVICE_TABLES),1)]
        self.assertEqual(m.data_restore_list(m.toc_entries("\n".join(lines)),set()).decode().splitlines(),lines)

    def test_namespace_privilege_or_extension_drift_stops_before_restore(self):
        c=catalog();t=catalog();t["schemas"][1]["owner"]="anon"
        entries=m.toc_entries("1; 0 1 SCHEMA - public postgres\n")
        with self.assertRaisesRegex(m.Stopped,"namespace_owner_acl_mismatch"):m.empty_schema_restore_list(entries,c,t)
        t=catalog();t["extensions"]=[{"name":"unreviewed","version":"1","schema":"public"}]
        with self.assertRaisesRegex(m.Stopped,"empty_target_extensions_mismatch"):m.empty_schema_restore_list(entries,c,t)
        t=catalog();t["schemas"].append({"name":"extra_empty","owner":"postgres","acl":None,"comment":None})
        with self.assertRaisesRegex(m.Stopped,"namespace_owner_acl_mismatch"):m.empty_schema_restore_list(entries,c,t)

    def proof_fixture(self):
        observed={"database":"postgres","serverAddress":"192.0.2.9","serverPort":5432,
                  "serverVersionNum":170006,"systemIdentifier":"123","managedRelationsPresent":[]}
        census={"format":1,"serverVersionNum":170006,"namespaceObjects":[],"globalObjects":[],
                "completeness":{"explicitPg17CatalogEnumeration":True},
                "structuralCatalogs":{k:"e"*64 for k in m.EMPTY_STRUCTURAL_KEYS}}
        c=catalog();c["schemas"]=[s for s in c["schemas"] if s["name"]=="public"]
        rows=[];schema=b"-- synthetic trusted image baseline\nCREATE EXTENSION fixture;\n"
        a=attestation();a.update(emptyBaselineCensusSha256=m.digest(m.encoded(census)),
            emptyBaselineCatalogSha256=m.digest(m.encoded(c)),emptyBaselineRowsSha256=m.digest(m.encoded(rows)),
            emptyBaselineSchemaSha256=m.schema_hash(schema))
        return observed,census,c,rows,schema,a

    def preflight(self, fixture):
        observed,census,c,rows,schema,a=fixture
        def query(_env,sql,**_):
            if sql==m.EMPTY_IDENTITY_SQL:return m.encoded(observed)
            if sql==m.CATALOG_SQL:return m.encoded(c)
            if "cron.launch_active_jobs" in sql:return b"off"
            return m.encoded(census)
        def command(argv,_env,**_):
            self.assertEqual(argv[0],"pg_dump")
            Path(argv[argv.index("--file")+1]).write_bytes(schema)
        with patch.object(m,"psql",side_effect=query),patch.object(m,"row_fingerprints",return_value=rows),\
             patch.object(m,"run",side_effect=command),patch.object(m.EMPTY_CENSUS.__class__,"read_text",return_value="SELECT synthetic census;"):
            return m.empty_target_preflight({},self.approved,a,self.root,"fixture-"+str(len(list(self.root.iterdir()))))

    def test_independently_pinned_blank_proof_passes_without_fabricating_absent_auth_counts(self):
        fixture=self.proof_fixture()
        self.assertEqual(self.preflight(fixture),fixture[2])
        self.assertNotIn("authUsers",fixture[0])
        self.assertEqual(fixture[0]["managedRelationsPresent"],[])

    def test_wrong_cluster_ip_database_version_or_existing_managed_relation_stops(self):
        for key,value in [("database","wrong"),("serverAddress","192.0.2.10"),("serverPort",5433),
                          ("systemIdentifier","456"),("serverVersionNum",180000),
                          ("managedRelationsPresent",["auth.users"])]:
            f=self.proof_fixture();f[0][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.preflight(f)

    def test_hidden_schema_custom_objects_or_incomplete_global_census_stop(self):
        for obj in [{"catalog":"pg_proc","schema":"hidden","identity":"hidden.backdoor()",
                     "directExtension":None,"internalExtension":None},
                    {"catalog":"pg_trigger","schema":"extensions","identity":"custom_trigger",
                     "directExtension":None,"internalExtension":None}]:
            f=self.proof_fixture();f[1]["namespaceObjects"].append(obj)
            with self.subTest(object=obj["identity"]),self.assertRaisesRegex(m.Stopped,"empty_target_user_objects_present"):
                self.preflight(f)
        f=self.proof_fixture();del f[1]["globalObjects"]
        with self.assertRaisesRegex(m.Stopped,"empty_target_global_census_missing"):self.preflight(f)
        f=self.proof_fixture();del f[1]["structuralCatalogs"]["systemNamespaceObjectsSha256"]
        with self.assertRaisesRegex(m.Stopped,"empty_target_structural_census_missing"):self.preflight(f)

    def test_extension_seed_data_and_large_objects_are_never_accepted_as_empty(self):
        f=self.proof_fixture();f[3].append({"schema":"extensions","name":"config","rows":1,"sha256":"a"*64})
        with self.assertRaisesRegex(m.Stopped,"empty_target_seed_data_present"):self.preflight(f)
        f=self.proof_fixture();f[2]["largeObjects"]=[{"oid":"123"}]
        with self.assertRaisesRegex(m.Stopped,"isolated_large_objects_not_empty"):self.preflight(f)

    def test_changed_global_catalog_or_schema_fails_independent_image_pin(self):
        for stage in ["global","schema"]:
            f=self.proof_fixture()
            if stage=="global":f[1]["globalObjects"].append({"catalog":"pg_event_trigger","identity":"unreviewed"})
            else:f=list(f);f[4]+=b"ALTER FUNCTION fixture() SECURITY DEFINER;\n"
            with self.subTest(stage=stage),self.assertRaisesRegex(m.Stopped,"empty_target_baseline_pin_mismatch"):
                self.preflight(f)

    def archive_fixture(self, *, with_extension_data=False):
        c=catalog()
        c["tables"]=[{"schema":"auth","name":n,"kind":"r"} for n in ["identities","sessions","users"]]
        rows=[{"schema":"auth","name":n,"rows":0,"sha256":m.digest(b"")} for n in ["identities","sessions","users"]]
        schema=b"-- synthetic full schema\nCREATE TABLE fixture();\n"
        toc="1; 0 1 TABLE auth users postgres\n2; 0 2 TABLE DATA auth identities postgres\n3; 0 3 TABLE DATA auth sessions postgres\n4; 0 4 TABLE DATA auth users postgres\n"
        files={"full.dump":b"SYNTHETIC-ARCHIVE-NOT-A-REAL-PG-DUMP","schema.sql":schema,"managed-schema.sql":schema,
               "catalog.json":m.encoded(c),"rows.json":m.encoded(rows),"toc.list":toc.encode()}
        if with_extension_data:
            c["extensions"]=[{"name":"synthetic_extension","version":"1.0","schema":"extensions","owner":"postgres"}]
            c["tables"].append({"schema":"extensions","name":"queue_metadata","kind":"r"})
            c["sequences"]=[{"schema":"extensions","name":"queue_sequence"}]
            c["extensionData"]=[{"schema":"extensions","name":"queue_metadata","kind":"r",
                "extension":"synthetic_extension","columns":[{"name":"label","generated":"","typeName":"text","defaultExpression":None}],"definition":{"owner":"postgres","sequence":None}},
                {"schema":"extensions","name":"queue_sequence","kind":"S","extension":"synthetic_extension","columns":[],"definition":{"owner":"postgres","sequence":{"increment":"1"}}}]
            raw=b"first\nsecond\nthird\nfourth\n"
            rows.append({"schema":"extensions","name":"queue_metadata","rows":4,"sha256":"d"*64})
            supplement={"format":1,"tables":[{"schema":"extensions","name":"queue_metadata",
                "columns":["label"],"copyText":raw.decode(),"sha256":m.digest(raw)}],
                "sequences":[{"schema":"extensions","name":"queue_sequence","value":"93","called":True}]}
            files.update({"catalog.json":m.encoded(c),"rows.json":m.encoded(rows),"extension-data.json":m.encoded(supplement)})
        manifest={"format":2 if with_extension_data else 1,"operation":"complete-managed-auth-database-capture","project":m.PROJECT,
                  "postgresBuild":m.BUILD,"consistentExportedSnapshot":True,"sourceSha":"a"*40,
                  "extensionTableDataSameExportedSnapshot":True,"sequenceStateTransactionalSnapshot":False,
                  "sequenceStateCapture":"non-mvcc-high-water-marks",
                  "schemaSha256":m.schema_hash(schema),"managedSchemaSha256":m.schema_hash(schema),
                  "files":[{"name":name,"bytes":len(raw),"sha256":m.digest(raw)} for name,raw in files.items()]}
        files["manifest.json"]=m.encoded(manifest)
        archive=self.root/"synthetic-encrypted-fixture.tar"
        with tarfile.open(archive,"w") as tar:
            for name,raw in files.items():
                info=tarfile.TarInfo(name);info.size=len(raw);tar.addfile(info,io.BytesIO(raw))
        archive.chmod(0o600)
        env={"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED",
             "KOVA_AUTH_RESTORE_BASELINE_MODE":"empty-database","KOVA_AUTH_BACKUP_ENCRYPTED_SHA256":m.file_digest(archive),
             "KOVA_APPROVED_BACKUP_SOURCE_SHA":"a"*40,"KOVA_PRODUCTION_BACKUP_PASSPHRASE":"synthetic-fixture-only-passphrase-at-least32",
             "KOVA_AUTH_RESTORE_ATTESTATION_SHA256":"b"*64}
        a=attestation();a.update(host="restore.invalid",database="postgres",port=5432,serverIp="192.0.2.9",systemIdentifier="123",
                                actualImageRepoDigest="public.ecr.aws/supabase/postgres@sha256:"+"c"*64)
        return archive,env,a,c,rows,schema

    def restore_stack(self, fixture):
        archive,env,a,c,rows,schema=fixture;stack=ExitStack();calls=[]
        def command(argv,_env,**_):
            calls.append(argv)
            if argv[0]=="node":return m.encoded(self.approved)
            if argv[0]=="pg_restore" and "--file" in argv:
                Path(argv[argv.index("--file")+1]).write_bytes(b"-- synthetic restored data\n")
            elif argv[0]=="pg_dump":Path(argv[argv.index("--file")+1]).write_bytes(schema)
            return b""
        def query(_env,sql,**_):
            if "has_parameter_privilege" in sql:return b"t"
            if "cron.launch_active_jobs" in sql:return b"off"
            if sql==m.EMPTY_IDENTITY_SQL:return m.encoded({"database":"postgres","serverAddress":"192.0.2.9",
                "serverPort":5432,"serverVersionNum":170006,"systemIdentifier":"123",
                "managedRelationsPresent":["auth.users"]})
            if sql==m.CATALOG_SQL:return m.encoded(c)
            if sql==m.EXTENSION_DATA_CATALOG_SQL:return m.encoded(c.get("extensionData",[]))
            if 'FROM "extensions"."queue_sequence"' in sql:return b'{"value":"93","called":true}\n'
            self.fail("unexpected fixture query")
        for name,value in [("attest",patch.object(m,"attest",return_value=a)),
                           ("target_environment",patch.object(m,"target_environment",return_value={})),
                           ("client_check",patch.object(m,"client_check")),
                           ("crypt",patch.object(m,"crypt",side_effect=lambda _e,_p,src,dst,decrypt:shutil.copyfile(src,dst))),
                           ("empty_target_preflight",patch.object(m,"empty_target_preflight",return_value=c)),
                           ("run",patch.object(m,"run",side_effect=command)),
                           ("psql",patch.object(m,"psql",side_effect=query)),
                           ("row_fingerprints",patch.object(m,"row_fingerprints",return_value=rows))]:
            setattr(stack,name,stack.enter_context(value))
        return stack,calls

    def test_bad_blank_proof_stops_before_decrypting_customer_backup(self):
        f=self.archive_fixture();stack,calls=self.restore_stack(f)
        with stack:
            stack.empty_target_preflight.side_effect=m.Stopped("empty_target_user_objects_present")
            with self.assertRaisesRegex(m.Stopped,"empty_target_user_objects_present"):
                m.restore(f[1],f[0],self.root/"receipt.json")
            stack.crypt.assert_not_called()
        self.assertFalse(any(a[0]=="pg_restore" for a in calls))

    def test_expired_attestation_or_changed_target_stops_before_first_restore_write(self):
        for changed in ["attestation","target"]:
            f=self.archive_fixture();stack,calls=self.restore_stack(f)
            with stack:
                if changed=="attestation":stack.attest.side_effect=[f[2],f[2],m.Stopped("isolation_attestation_stale")]
                else:stack.empty_target_preflight.side_effect=[f[3],m.Stopped("empty_target_changed")]
                with self.assertRaises(m.Stopped):m.restore(f[1],f[0],self.root/(changed+"-receipt.json"))
                stack.crypt.assert_called_once()
            self.assertFalse(any(a[0]=="pg_restore" for a in calls))

    def test_mocked_complete_restore_rechecks_blank_target_and_keeps_all_managed_entries(self):
        f=self.archive_fixture();stack,calls=self.restore_stack(f);selected=[]
        real=m.fresh_file
        def fresh(path,data):
            if path.name=="schema-restore.list":selected.append(data.decode())
            real(path,data)
        with stack,patch.object(m,"fresh_file",side_effect=fresh):
            receipt=m.restore(f[1],f[0],self.root/"receipt.json")
            self.assertEqual(stack.attest.call_count,4)
            self.assertEqual(stack.empty_target_preflight.call_count,2)
        self.assertEqual(selected,["1; 0 1 TABLE auth users postgres\n"])
        self.assertTrue(any(a[0]=="pg_restore" and "--single-transaction" in a for a in calls))
        self.assertEqual(receipt["baselineMode"],"empty-database")
        self.assertFalse(receipt["fullProjectRecoveryQualified"])

    def test_attestation_expiring_after_schema_restore_blocks_customer_data_import(self):
        f=self.archive_fixture();stack,calls=self.restore_stack(f)
        with stack:
            stack.attest.side_effect=[f[2],f[2],f[2],m.Stopped("isolation_attestation_stale")]
            with self.assertRaisesRegex(m.Stopped,"isolation_attestation_stale"):
                m.restore(f[1],f[0],self.root/"expired-data-receipt.json")
        self.assertTrue(any(a[0]=="pg_restore" and "--section=pre-data" in a for a in calls))
        self.assertFalse(any(a[0]=="psql" for a in calls))
        self.assertFalse((self.root/"expired-data-receipt.json").exists())

    def test_complete_extension_rows_and_sequence_are_imported_once_then_verified(self):
        f=self.archive_fixture(with_extension_data=True);stack,calls=self.restore_stack(f);imports=[]
        command=stack.run.side_effect
        def run(argv,env,**kwargs):
            if argv[0]=="psql":imports.append(Path(argv[argv.index("--file")+1]).read_bytes())
            return command(argv,env,**kwargs)
        with stack:
            stack.run.side_effect=run
            receipt=m.restore(f[1],f[0],self.root/"extension-receipt.json")
            stack.row_fingerprints.assert_called_once()
        self.assertEqual(len(imports),1)
        self.assertEqual(imports[0].count(b'COPY "extensions"."queue_metadata" ("label") FROM stdin'),1)
        self.assertIn(b"first\nsecond\nthird\nfourth\n\\.\n",imports[0])
        self.assertIn(b"SELECT pg_catalog.setval('extensions.queue_sequence', 93, true);",imports[0])
        self.assertTrue(receipt["tablesSequencesLargeObjectsVerified"])
        self.assertFalse(receipt["fullProjectRecoveryQualified"])

    def test_extension_column_drift_stops_before_any_customer_data_import(self):
        f=self.archive_fixture(with_extension_data=True);stack,calls=self.restore_stack(f)
        query=stack.psql.side_effect
        def changed(env,sql,**kwargs):
            if sql==m.EXTENSION_DATA_CATALOG_SQL:return m.encoded([])
            return query(env,sql,**kwargs)
        with stack:
            stack.psql.side_effect=changed
            with self.assertRaisesRegex(m.Stopped,"extension_target_definition_mismatch"):
                m.restore(f[1],f[0],self.root/"extension-drift-receipt.json")
        self.assertFalse(any(a[0]=="psql" for a in calls))
        self.assertFalse((self.root/"extension-drift-receipt.json").exists())

    def test_extension_row_loss_or_wrong_sequence_never_produces_recovery_receipt(self):
        for failure in ["rows","sequence"]:
            f=self.archive_fixture(with_extension_data=True);stack,calls=self.restore_stack(f)
            with stack:
                if failure=="rows":stack.row_fingerprints.return_value=f[4][:-1]
                else:
                    query=stack.psql.side_effect
                    def wrong_sequence(env,sql,**kwargs):
                        return b'{"value":"92","called":true}\n' if 'FROM "extensions"."queue_sequence"' in sql else query(env,sql,**kwargs)
                    stack.psql.side_effect=wrong_sequence
                with self.assertRaisesRegex(m.Stopped,"restored_table_state_mismatch|restored_sequence_state_mismatch"):
                    m.restore(f[1],f[0],self.root/(failure+"-extension-receipt.json"))
            self.assertFalse((self.root/(failure+"-extension-receipt.json")).exists())

    def test_slow_last_read_cannot_outlive_isolation_at_any_plaintext_or_write_boundary(self):
        for boundary in ["decrypt","schema","data"]:
            f=self.archive_fixture();stack,calls=self.restore_stack(f);clock={"expired":False,"proofs":0}
            with stack:
                original_query=stack.psql.side_effect
                def proof(*_args,**_kwargs):
                    clock["proofs"]+=1
                    if (boundary=="decrypt" and clock["proofs"]==1) or (boundary=="schema" and clock["proofs"]==2):
                        clock["expired"]=True
                    return f[3]
                def check(_env):
                    if clock["expired"]:raise m.Stopped("isolation_attestation_stale")
                    return f[2]
                def query(env,sql,**kwargs):
                    result=original_query(env,sql,**kwargs)
                    if boundary=="data" and sql==m.EMPTY_IDENTITY_SQL:clock["expired"]=True
                    return result
                stack.empty_target_preflight.side_effect=proof
                stack.attest.side_effect=check;stack.psql.side_effect=query
                with self.subTest(boundary=boundary),self.assertRaisesRegex(m.Stopped,"isolation_attestation_stale"):
                    m.restore(f[1],f[0],self.root/(boundary+"-late-receipt.json"))
                self.assertFalse(any(a[0]=="psql" for a in calls))
                if boundary=="decrypt":stack.crypt.assert_not_called()
                if boundary in {"decrypt","schema"}:self.assertFalse(any(a[0]=="pg_restore" for a in calls))


if __name__ == "__main__":unittest.main()
