"""Synthetic metadata and mocked commands; never contacts any database."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/collect-empty-recovery-metadata.py"
spec=importlib.util.spec_from_file_location("collect_empty_metadata",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def metadata():
    return {"format":1,"project":m.PROJECT,"postgresBuild":m.BUILD,"serverVersionNum":170006,
            "database":"postgres","readOnly":True,"extensions":[],"schemas":[],"roles":[],
            "memberships":[],"roleSettings":[]}


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.ca=self.root/"ca.pem";self.ca.write_text("synthetic trust fixture")
        self.env={"KOVA_EMPTY_PROBE_CONFIRMATION":"PROBE_EMPTY_ONLY","GITHUB_EVENT_NAME":"workflow_dispatch",
                  "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/heads/main","GITHUB_SHA":"a"*40,
                  "KOVA_APPROVED_SOURCE_SHA":"a"*40,"RUNNER_TEMP":str(self.root),
                  "KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION":m.BUILD,
                  "KOVA_PRODUCTION_DATABASE_URL":f"postgresql://postgres:synthetic-password@db.{m.PROJECT}.supabase.co:5432/postgres",
                  "KOVA_RECOVERY_CA_BUNDLE":str(self.ca)}

    def test_fixed_query_reads_only_metadata_in_explicit_read_only_transaction(self):
        self.assertTrue(m.SOURCE_SQL.startswith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"))
        for forbidden in ["auth.users","auth.sessions","auth.identities","pg_authid","rolpassword","lo_get",
                          "pg_largeobject","INSERT ","UPDATE ","DELETE ","CREATE ","COPY "]:
            self.assertNotIn(forbidden,m.SOURCE_SQL)
        self.assertIn("'readOnly',current_setting('transaction_read_only')='on'",m.SOURCE_SQL)

    def test_extension_preflight_shares_fixed_readonly_snapshot_and_never_implies_semantics(self):
        query=m.source_query(True)
        self.assertEqual(query.count("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"),1)
        self.assertEqual(query.count("COMMIT;"),1)
        self.assertIn("SET LOCAL search_path=pg_catalog;",query)
        self.assertIn(m.EXTENSION_COVERAGE.read_text(),query)
        proof={"format":1,"operation":"extension-member-semantics-coverage-preflight","serverVersionNum":170006,
               **{k:False for k in ["qualified","qualificationReady","semanticEqualityProven",
                  "catalogPayloadAdaptersImplemented","deparsedDdlTreatedAsExact","customerRowsRead",
                  "rawMetadataReturned","productionMutated"]},"counts":{"unimplementedPayloadObjects":12},
               "memberInventorySha256":"a"*64,"dependencyInventorySha256":"b"*64}
        raw=(json.dumps(metadata())+"\n"+json.dumps(proof)+"\n").encode()
        value=m.parse_source_output(raw,True)
        self.assertEqual(value["extensionCoverage"]["counts"]["unimplementedPayloadObjects"],12)
        self.assertFalse(value["extensionCoverage"]["semanticEqualityProven"])
        self.assertEqual(value["extensionCoverageQuerySha256"],m.sha(m.EXTENSION_COVERAGE.read_bytes()))
        for change in [{"semanticEqualityProven":True},{"customerRowsRead":True},{"serverVersionNum":180003}]:
            with self.subTest(change=change),self.assertRaises(m.Stopped):
                m.parse_source_output((json.dumps(metadata())+"\n"+json.dumps({**proof,**change})).encode(),True)
        with self.assertRaises(m.Stopped):m.parse_source_output(raw,False)

    def test_settings_exclude_credentials_urls_and_preload_consumers(self):
        raw=metadata();sensitive="sk-synthetic-DO-NOT-COPY"
        raw["roleSettings"]=[{"role":"authenticator","database":"postgres","settings":[
            "statement_timeout=60s","search_path=public, extensions","pgrst.db_pre_request=kova_auth_guard.check_request",
            "pgrst.jwt_secret="+sensitive,"app.url=postgresql://synthetic/private",
            "session_preload_libraries=pg_net","local_preload_libraries=anything",
            "pgrst.db_schemas=public;DO unsafe","unknown.setting=ordinary"]}]
        out=m.sanitize_settings(raw)
        self.assertEqual(out["withheldSettingCount"],6)
        self.assertFalse(out["sourceSettingsComplete"])
        self.assertEqual(out["roleSettings"][0]["settings"],["statement_timeout=60s","search_path=public, extensions",
                                                                "pgrst.db_pre_request=kova_auth_guard.check_request"])
        encoded=json.dumps(out)
        for secret in [sensitive,"postgresql://synthetic/private","pg_net","public;DO unsafe"]:
            self.assertNotIn(secret,encoded)
        self.assertTrue(all(len(x["sha256"])==64 for x in out["roleSettings"][0]["settingFingerprints"]))

    def test_public_expiry_enum_and_inactive_role_preload_are_scope_checked(self):
        for raw in ["app.settings.jwt_exp=3600","log_statement=none","log_statement=ddl"]:
            self.assertTrue(m.retained_setting(raw))
        for raw in ["app.settings.jwt_exp=0","app.settings.jwt_exp=31536001","app.settings.jwt_exp=1;SELECT",
                    "log_statement=unknown","log_statement=all;SELECT"]:
            self.assertFalse(m.retained_setting(raw))
        for raw in ['session_preload_libraries=supautils, safeupdate',
                    'session_preload_libraries="safeupdate",supautils']:
            self.assertTrue(m.retained_setting(raw,role="authenticator",database="*"))
            for role,database in [("*","postgres"),("postgres","*"),("kova_probe_operator","*"),
                                  ("authenticator","other")]:
                self.assertFalse(m.retained_setting(raw,role=role,database=database))
        for raw in ["session_preload_libraries=pg_net","session_preload_libraries=supautils,pg_cron",
                    "session_preload_libraries=supautils,supautils",'session_preload_libraries="supautils',
                    "local_preload_libraries=safeupdate","shared_preload_libraries=supautils"]:
            self.assertFalse(m.retained_setting(raw,role="authenticator",database="*"))
        raw=metadata();raw["roleSettings"]=[{"role":"authenticator","database":"*",
            "settings":["session_preload_libraries=supautils, safeupdate","log_statement=none"]},
            {"role":"*","database":"postgres","settings":["app.settings.jwt_exp=3600"]}]
        out=m.sanitize_settings(raw)
        self.assertTrue(out["sourceSettingsComplete"]);self.assertEqual(out["withheldSettingCount"],0)
        raw["roleSettings"][0]["role"]="postgres"
        self.assertEqual(m.sanitize_settings(raw)["withheldSettingCount"],1)

    def test_invalid_source_version_database_or_readonly_bit_is_rejected(self):
        for key,value in [("serverVersionNum",180003),("readOnly",False),("database","other"),
                          ("project","wrong"),("roles",None)]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.sanitize_settings({**metadata(),key:value})

    def test_dispatch_exact_main_and_checked_out_source_are_required_before_docker(self):
        for key,value in [("KOVA_EMPTY_PROBE_CONFIRMATION","anything"),("GITHUB_EVENT_NAME","pull_request"),
                          ("GITHUB_REF","refs/heads/other"),("GITHUB_REPOSITORY","other/repo"),
                          ("GITHUB_SHA","b"*40),("KOVA_APPROVED_SOURCE_SHA","c"*40)]:
            calls=[]
            def command(args,**_):calls.append(args);return ("a"*40+"\n").encode()
            with self.subTest(key=key),patch.object(m,"command",side_effect=command),self.assertRaises(m.Stopped):
                m.collect({**self.env,key:value},self.root/"private"/"metadata.json")
            self.assertFalse(any(c[0]=="docker" for c in calls))

    def test_collector_credentials_are_in_private_reader_envfile_not_args_or_restore_output(self):
        calls=[];reader_files=[];output=self.root/"private"/"metadata.json"
        def command(args,**kwargs):
            calls.append(args)
            if args[0]=="git":return ("a"*40+"\n").encode()
            if args[:3]==["docker","image","inspect"]:
                return json.dumps([{"Architecture":"amd64","Os":"linux","RepoDigests":[m.IMAGE]}]).encode()
            if args[:2]==["docker","run"]:
                file=Path(args[args.index("--env-file")+1]);reader_files.append(file)
                self.assertEqual(file.stat().st_mode & 0o777,0o600)
                secret_env=file.read_text()
                self.assertIn("PGPASSWORD=synthetic-password\n",secret_env)
                self.assertIn("default_transaction_read_only=on",secret_env)
                self.assertTrue(all(line.startswith("PG") for line in secret_env.splitlines()))
                self.assertEqual(kwargs["data"],m.SOURCE_SQL.encode())
                self.assertIn("--cap-drop",args);self.assertIn("--read-only",args)
                self.assertIn(f"{os.getuid()}:{os.getgid()}",args)
                return json.dumps(metadata()).encode()
            return b""
        with patch.object(m,"command",side_effect=command):receipt=m.collect(self.env,output)
        self.assertEqual(output.stat().st_mode & 0o777,0o600)
        self.assertEqual(output.parent.stat().st_mode & 0o777,0o700)
        self.assertTrue(all(not p.exists() for p in reader_files))
        self.assertNotIn("synthetic-password",output.read_text())
        self.assertNotIn(self.env["KOVA_PRODUCTION_DATABASE_URL"],output.read_text())
        self.assertNotIn("synthetic-password",json.dumps(calls))
        self.assertFalse(receipt["productionMutated"])
        self.assertFalse(receipt["customerRowsRead"])

    def test_bad_image_or_reader_failure_writes_no_metadata(self):
        for stage in ["image","reader"]:
            output=self.root/stage/"metadata.json"
            def command(args,**_):
                if args[0]=="git":return ("a"*40+"\n").encode()
                if args[:3]==["docker","image","inspect"]:
                    return json.dumps([{"Architecture":"arm64" if stage=="image" else "amd64", "Os":"linux",
                                        "RepoDigests":[m.IMAGE]}]).encode()
                if args[:2]==["docker","run"]:raise m.Stopped("metadata_command_unconfirmed")
                return b""
            with self.subTest(stage=stage),patch.object(m,"command",side_effect=command),self.assertRaises(m.Stopped):
                m.collect(self.env,output)
            self.assertFalse(output.exists());self.assertFalse(output.parent.exists())

    def test_host_command_environment_drops_all_production_and_provider_variables(self):
        with patch.dict(os.environ,{"KOVA_PRODUCTION_DATABASE_URL":"synthetic","OPENAI_API_KEY":"synthetic",
                                    "GITHUB_TOKEN":"synthetic","PGPASSWORD":"synthetic"}):
            out=m.host_env()
        self.assertFalse(any(k in out for k in ["KOVA_PRODUCTION_DATABASE_URL","OPENAI_API_KEY","GITHUB_TOKEN","PGPASSWORD"]))

    def test_unknown_reader_run_is_cleaned_only_by_exact_owner_and_confirmed_absent(self):
        calls=[];answers=[b"kova-meta-fixture\n",b"",b""]
        def command(args,**_):calls.append(args);return answers.pop(0)
        with patch.object(m,"command",side_effect=command):m.remove_metadata_reader("fixture","kova-meta-fixture")
        self.assertEqual(calls[1],["docker","rm","--force","kova-meta-fixture"])
        self.assertTrue(all("label=org.kova.metadata-owner=fixture" in c for c in [calls[0],calls[2]]))
        with patch.object(m,"command",return_value=b"another-container\n"),self.assertRaisesRegex(m.Stopped,"metadata_reader_ownership_mismatch"):
            m.remove_metadata_reader("fixture","kova-meta-fixture")


if __name__=="__main__":unittest.main()
