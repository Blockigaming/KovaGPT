"""Synthetic metadata and mocked commands; never Docker or a live database."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/probe-empty-recovery-target.py"
spec=importlib.util.spec_from_file_location("empty_native_probe",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def metadata():
    role={"name":"postgres","super":True,"inherit":True,"createRole":True,"createDb":True,
          "login":True,"replication":True,"bypassRls":True,"connectionLimit":-1,"validUntil":None}
    return {"format":1,"project":m.recovery.PROJECT,"postgresBuild":m.BUILD,
            "sourceCommit":"a"*40,"metadataImageDigest":m.IMAGE,"sourceBuildOperatorPin":m.BUILD,
            "serverVersionNum":170006,"database":"postgres","sourceQueryReadOnly":True,
            "customerRowsRead":False,"passwordHashesRead":False,"sourceUrlStored":False,
            "sourcePackagingBuildObservedBySql":False,"bootstrapRole":"postgres",
            "roles":[role],"memberships":[],"roleSettings":[],
            "schemas":[{"name":"public","owner":"postgres","acl":None,"comment":None}],
            "extensions":[{"name":"plpgsql","version":"1.0","schema":"pg_catalog","owner":"postgres"}],
            "sourceSettingsComplete":True,"withheldSettingCount":0}


def synthetic_qualification():
    """Synthetic caller-boundary receipt; not a real verified image."""
    return {"imageInfo":{"Id":"sha256:"+"2"*64,"Os":"linux","Architecture":"amd64",
                         "Config":{"Env":["PATH=/synthetic/pg/bin"],"Volumes":{}},
                         "RepoDigests":[m.server_image.TRANSPORT_REF]},
            "receipt":{"syntheticFixture":True,"operation":"verified-official-server-image-transport",
                       "imageId":"sha256:"+"2"*64,"actualRepoDigest":m.server_image.TRANSPORT_REF,
                       "transportReference":m.server_image.TRANSPORT_REF,
                       "originalEcrReference":m.server_image.ORIGINAL_ECR_REF}}


class NativeProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.env={"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_REPOSITORY":"Blockigaming/KovaGPT",
                  "GITHUB_REF":"refs/heads/main","GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,
                  "KOVA_EMPTY_PROBE_CONFIRMATION":"PROBE_EMPTY_ONLY","GITHUB_RUN_ID":"123",
                  "GITHUB_RUN_ATTEMPT":"1","RUNNER_TEMP":str(self.root),"PATH":os.environ["PATH"]}

    def probe(self):return m.Probe(metadata(),self.env,self.root/"output"/"receipt.json")

    def test_verified_transport_evidence_survives_later_native_failure_without_qualifying_target(self):
        p=self.probe();receipt={"operation":"verified-official-server-image-transport",
            "transportReference":m.IMAGE,"originalEcrReference":m.server_image.ORIGINAL_ECR_REF}
        def late_failure():
            p.server_image_qualification=receipt
            raise m.Stopped("native_dependency_unqualified")
        with patch.object(p,"initialize",side_effect=late_failure),patch.object(p,"cleanup",return_value=True):
            result=p.execute()
        self.assertEqual(result["serverImageTransport"],receipt)
        self.assertFalse(result["dataFreeSafetyProofComplete"])
        self.assertFalse(result["sourceMetadataCompatible"])
        self.assertFalse(result["independentlyReviewed"])

    def test_explicit_main_source_and_no_production_credentials_required(self):
        self.assertEqual(m.checked_context(self.env),"a"*40)
        for key,value in [("KOVA_EMPTY_PROBE_CONFIRMATION","OTHER"),("GITHUB_ACTIONS","false"),
                          ("RUNNER_OS","Windows"),("GITHUB_REF","refs/heads/unreviewed"),
                          ("KOVA_APPROVED_SOURCE_SHA","b"*40),("KOVA_PRODUCTION_DATABASE_URL","synthetic-secret"),
                          ("OPENAI_API_KEY","synthetic-secret"),("PGPASSWORD","synthetic-secret")]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.checked_context({**self.env,key:value})

    def test_host_child_environment_keeps_proxy_policy_and_excludes_all_source_secrets(self):
        out=m.clean_host_env({"PATH":"safe","HTTPS_PROXY":"http://policy.invalid","PGPASSWORD":"private",
                              "KOVA_PRODUCTION_DATABASE_URL":"private","GITHUB_TOKEN":"private"})
        self.assertEqual(out,{"PATH":"safe","HTTPS_PROXY":"http://policy.invalid"})

    def test_native_initialize_uses_qualified_same_digest_boundary_and_retains_honest_transport(self):
        p=self.probe();calls=[]
        def command(args,**kwargs):
            calls.append(args)
            self.assertFalse(any(key in p.env for key in ["PGPASSWORD","KOVA_PRODUCTION_DATABASE_URL","GITHUB_TOKEN"]))
            if args==["git","rev-parse","HEAD"]:return 0,(p.source+"\n").encode()
            if args[:2]==["docker","run"]:
                self.assertIn(m.server_image.TRANSPORT_REF,args)
                self.assertNotIn(m.server_image.ORIGINAL_ECR_REF,args)
                return 0,b"999\n999\n/native/postgres\n/native/pg_ctl\n/native/initdb\n/native/psql\n/native/pg_dump\n/native/timeout\n/native/sha256sum\npostgres (PostgreSQL) 17.6\n"
            return 0,b"synthetic-command-output\n"
        def qualified(callback):
            self.assertEqual(callback(["docker","buildx","version"],timeout=30),(0,b"synthetic-command-output\n"))
            return synthetic_qualification()
        p.run=command
        with patch.object(m.os,"getuid",return_value=1001),patch.object(m.shutil,"which",return_value="/synthetic/tool"),\
             patch.object(m.server_image,"qualify",side_effect=qualified) as qualification:
            p.initialize()
        qualification.assert_called_once()
        self.assertEqual(p.server_image_qualification,synthetic_qualification()["receipt"])
        self.assertEqual(p.server_image_qualification["actualRepoDigest"],m.IMAGE)
        self.assertNotEqual(p.server_image_qualification["actualRepoDigest"],m.server_image.ORIGINAL_ECR_REF)
        self.assertIn(["docker","buildx","version"],calls)
        self.assertFalse(any(args[:2]==["docker","tag"] or args[:3]==["docker","image","tag"] for args in calls))

    def test_server_boundary_failure_is_fixed_and_prevents_native_tool_container(self):
        for message,expected in [("server_image_manifest_digest_mismatch","server_image_manifest_digest_mismatch"),
                                 ("SYNTHETIC_PRIVATE_REGISTRY_SECRET","data_free_native_probe_unconfirmed")]:
            p=self.probe();calls=[]
            p.run=lambda args,**kwargs:(calls.append(args) or (0,(p.source+"\n").encode()))
            p.cleanup=lambda:True
            with self.subTest(message=message),patch.object(m.os,"getuid",return_value=1001),\
                 patch.object(m.server_image,"qualify",side_effect=m.server_image.Stopped(message)) as qualification:
                result=p.execute()
            qualification.assert_called_once()
            self.assertEqual(result["errorCode"],expected)
            self.assertFalse(result["dataFreeSafetyProofComplete"])
            self.assertFalse(any(args[:2]==["docker","run"] for args in calls))
            self.assertNotIn("PRIVATE_REGISTRY_SECRET",json.dumps(result))
            p.output.unlink();p.state_path.unlink()

    def test_setting_policy_is_shared_with_collector_and_rejects_secret_or_preload_values(self):
        self.assertEqual(m.SAFE_SETTINGS,m.metadata_source.SAFE_GUC_KEYS)
        for raw in ["statement_timeout=30000","pgrst.db_root_spec=public.root_spec","default_transaction_read_only=on",
                    r'search_path=\$user, public, fixture_ns']:
            self.assertEqual(m.safe_setting(raw),tuple(raw.split("=",1)))
        for raw in ["session_preload_libraries=pg_net","local_preload_libraries=unsafe","pgrst.jwt_secret=private",
                    "search_path=https://private.invalid","search_path=x\nALTER SYSTEM SET ssl=off",
                    r'search_path=\private',r'search_path=\\$user',r'pgrst.db_pre_request=\$user']:
            with self.subTest(kind=raw.split("=",1)[0]),self.assertRaises(m.Stopped):m.safe_setting(raw)

    def test_metadata_requires_owned_identifiers_typed_flags_and_explicit_setting_coverage(self):
        self.assertEqual(m.validate_metadata(metadata(),source_sha="a"*40)["postgresBuild"],m.BUILD)
        for mutate in [lambda d:d["roles"][0].update(name=m.OPERATOR),
                       lambda d:d["roles"][0].update(name='x";DROP ROLE postgres;--'),
                       lambda d:d["roles"][0].update(super=1),lambda d:d.pop("sourceSettingsComplete"),
                       lambda d:d["extensions"][0].update(version="1'; DROP DATABASE postgres;--"),
                       lambda d:d["extensions"][0].pop("owner"),
                       lambda d:d["extensions"][0].update(owner="unknown_owner")]:
            d=metadata();mutate(d)
            with self.assertRaises(m.Stopped):m.validate_metadata(d,source_sha="a"*40)

    def test_metadata_provenance_and_setting_coverage_cannot_be_replayed_or_asserted(self):
        for key,value in [("sourceCommit","b"*40),("metadataImageDigest","other-image"),
                          ("sourceBuildOperatorPin","other-build"),("serverVersionNum",180000),
                          ("sourceQueryReadOnly",False),("customerRowsRead",True),
                          ("passwordHashesRead",True),("sourceUrlStored",True),
                          ("sourcePackagingBuildObservedBySql",True),("sourceSettingsComplete",False),
                          ("withheldSettingCount",1)]:
            d=metadata();d[key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.validate_metadata(d,source_sha="a"*40)
        d=metadata();raw="statement_timeout=30000"
        d["roleSettings"]=[{"role":"postgres","database":"*","settings":[raw],"settingFingerprints":[
            {"key":"statement_timeout","sha256":m.digest(raw.encode()),"retained":True},
            {"key":"private.setting","sha256":"c"*64,"retained":False}]}]
        d.update(sourceSettingsComplete=False,withheldSettingCount=1)
        self.assertFalse(m.validate_metadata(d,source_sha="a"*40)["sourceSettingsComplete"])
        d["roleSettings"][0]["settingFingerprints"][0]["sha256"]="d"*64
        with self.assertRaises(m.Stopped):m.validate_metadata(d,source_sha="a"*40)

    def test_metadata_sql_quotes_comments_and_does_not_invent_infinite_valid_until_or_null_acl(self):
        d=metadata();d["schemas"][0]["comment"]="Owner's test; not a command"
        sql=m.role_setup_sql(d)
        self.assertNotIn("VALID UNTIL",sql)
        self.assertIn("Owner''s test; not a command",m.schema_setup_sql(d))
        self.assertEqual(m.schema_acl_sql(d),"\n")

    def test_extension_bootstrap_uses_source_owner_and_restores_every_source_role_flag(self):
        d=metadata();d["roles"][0].update(super=False,login=False,replication=False,bypassRls=False)
        self.assertEqual(m.extension_owner_bootstrap_sql(d),'ALTER ROLE "postgres" SUPERUSER;\n')
        restored=m.extension_owner_bootstrap_sql(d,restore=True)
        for flag in ["NOSUPERUSER","NOLOGIN","NOREPLICATION","NOBYPASSRLS","CONNECTION LIMIT -1"]:
            self.assertIn(flag,restored)
        created=m.extension_create_sql(d["extensions"][0])
        self.assertTrue(created.startswith('SET ROLE "postgres";\nCREATE EXTENSION "plpgsql"'))
        self.assertTrue(created.endswith("RESET ROLE;\n"))
        self.assertNotIn("CASCADE",created)

    def test_bootstrap_json_queries_are_machine_readable_and_socket_is_never_host_mounted(self):
        p=self.probe();p.pg_uid=70;p.pg_gid=70;p.native_tools={"psql":"/native/psql"};calls=[]
        p.docker=lambda argv,**kwargs:(calls.append((argv,kwargs)) or (0,b"[]\n"))
        p.bootstrap_sql("a","SELECT '[]';\n",database="template1")
        args=calls[0][0]
        for flag in ["--quiet","--tuples-only","--no-align"]:self.assertIn(flag,args)
        self.assertEqual(args[args.index("--host")+1],"/tmp")
        self.assertEqual(args[args.index("--dbname")+1],"template1")
        self.assertNotIn("--mount",args)

    def test_numeric_denial_targets_require_actual_global_dual_stack_https_and_database(self):
        def resolve(host,port,**_):
            return [(socket.AF_INET,None,None,None,("1.1.1.1",port)),
                    (socket.AF_INET6,None,None,None,("2606:4700:4700::1111",port,0,0))]
        values=m.denial_targets(metadata(),resolve)
        self.assertEqual({p for _,_,p in values},{443,5432})
        self.assertEqual({m.ipaddress.ip_address(ip).version for _,ip,_ in values},{4,6})
        def local(host,port,**_):return [(socket.AF_INET,None,None,None,("127.0.0.1",port))]
        with self.assertRaises(m.Stopped):m.denial_targets(metadata(),local)
        def ipv4(host,port,**_):return [(socket.AF_INET,None,None,None,("1.1.1.1",port))]
        with self.assertRaises(m.Stopped):m.denial_targets(metadata(),ipv4)

    def test_attempt_reservation_and_cleanup_state_are_same_owner_and_source_only(self):
        p=self.probe();p.save_state()
        with self.assertRaisesRegex(m.Stopped,"owned_probe_attempt_already_reserved"):self.probe()
        old=json.loads(p.state_path.read_text());old["source"]="b"*40
        p.state_path.write_text(json.dumps(old));p.state_path.chmod(0o600)
        with self.assertRaisesRegex(m.Stopped,"owned_state_conflict"):p.save_state()
        with self.assertRaisesRegex(m.Stopped,"owned_cleanup_state_unqualified"):m.cleanup_from_state(self.env)

    def test_receipt_path_cannot_overwrite_source_or_escape_runner_directory(self):
        with self.assertRaises(m.Stopped):m.Probe(metadata(),self.env,self.root.parent/"receipt.json")
        with self.assertRaises(m.Stopped):m.Probe(metadata(),self.env,self.root/"private-metadata.json")

    def test_container_commands_drop_caps_do_not_publish_ports_and_disable_vendor_healthchecks(self):
        p=self.probe();p.uid=1001;p.gid=1001;p.pg_uid=70;p.pg_gid=70;p.image_volumes=[]
        p.client_dir=self.root/"client";p.server_dirs={"a":self.root/"a","b":self.root/"b"}
        for key in ["a","b","client"]:
            args=p._container_args(key)
            self.assertIn("--no-healthcheck",args)
            self.assertEqual(args[args.index("--cap-drop")+1],"ALL")
            self.assertIn("no-new-privileges:true",args)
            self.assertIn("--read-only",args)
            self.assertNotIn("--privileged",args);self.assertNotIn("--publish",args)
            self.assertNotIn("--network=host",args)
            self.assertFalse(any("docker.sock" in a for a in args))

    def test_namespace_helper_pins_fd_and_refuses_host_namespace_not_only_pid(self):
        self.assertIn("os.open('/proc/'+str(pid)+'/ns/net'",m.NETNS_HELPER)
        self.assertIn("os.fstat(fd).st_ino==expected",m.NETNS_HELPER)
        self.assertIn("expected!=os.stat('/proc/self/ns/net').st_ino",m.NETNS_HELPER)
        self.assertIn("pass_fds=(fd,)",m.NETNS_HELPER)
        compile(m.NETNS_HELPER,"netns-helper","exec")

    def test_source_url_never_enters_actual_client_command_environment(self):
        p=self.probe();p.native_tools={"psql":"/native/psql"};captured=[]
        def docker(args,**kwargs):captured.append((args,kwargs));return 0,b"1\n"
        p.docker=docker
        p.client_sql("a","SELECT 1;\n")
        args=captured[0][0]
        env=[args[i+1] for i,v in enumerate(args) if v=="--env"]
        self.assertIn("PGSSLMODE=verify-full",env)
        self.assertTrue(any(x.startswith("PGHOSTADDR=172.") for x in env))
        self.assertNotIn("PGPASSWORD",str(env));self.assertNotIn("KOVA_PRODUCTION",str(env))
        self.assertNotIn(m.recovery.PROJECT,str(env))

    def test_foreign_container_is_never_removed_and_keeps_firewall_and_private_files(self):
        p=self.probe();p.containers_reserved=[p.names["a"]];p.network_reserved=True
        p.firewall_reserved=["iptables"];calls=[]
        def run(argv,**_):calls.append(argv);return 0,b""
        def docker(args,**_):
            calls.append(args)
            if args[:2]==["network","inspect"]:return 0,json.dumps([{"Id":"network-id","Labels":{},"Containers":{}}]).encode()
            return 0,json.dumps([{"Id":"foreign","Config":{"Labels":{"kova.empty-probe.owner":"foreign"}}}]).encode()
        p.run=run;p.docker=docker;p.save_state=lambda:None
        self.assertFalse(p.cleanup())
        self.assertFalse(any(a[0] in {"rm","-D","-X"} or "-D" in a for a in calls))

    def test_unknown_owned_container_removal_result_is_not_a_qualified_cleanup(self):
        p=self.probe();p.containers_reserved=[p.names["a"]];calls=[]
        labels={"kova.empty-probe.owner":p.token,"kova.empty-probe.source":p.source,
                "kova.empty-probe.run":p.run_id,"kova.empty-probe.attempt":p.attempt}
        def docker(args,**_):
            calls.append(args)
            if args[0]=="rm":raise m.Stopped("native_command_unconfirmed")
            if args[0]=="ps":return 0,json.dumps({"ID":"f"*64,"Names":p.names["a"]}).encode()
            return 0,json.dumps([{"Id":"f"*64,"Config":{"Labels":labels}}]).encode()
        p.docker=docker;p.save_state=lambda:None
        self.assertFalse(p.cleanup())
        self.assertTrue(any(a[:3]==["rm","--force","--volumes"] for a in calls))

    def test_daemon_failure_is_unknown_and_never_proves_absence_or_removes_guards(self):
        p=self.probe();p.containers_reserved=[p.names["a"]];p.network_reserved=True
        p.firewall_reserved=["iptables","ip6tables"];calls=[]
        p.private_root=self.root/"private-still-live";p.private_root.mkdir()
        p.save_state=lambda:None
        def docker(args,**_):calls.append(args);return 1,b""
        p.docker=docker;p.run=lambda argv,**_:(calls.append(argv) or (0,b""))
        self.assertFalse(p.cleanup());self.assertTrue(p.private_root.exists())
        self.assertFalse(any(a[0] in {"rm","sudo"} for a in calls))

    def test_absence_requires_successful_complete_name_and_id_census(self):
        p=self.probe();name=p.names["a"];object_id="f"*64
        p.docker=lambda *_args,**_kwargs:(0,json.dumps({"ID":object_id,"Names":name}).encode())
        self.assertFalse(p.resource_absent(name));self.assertFalse(p.resource_absent(object_id))
        self.assertTrue(p.resource_absent("another-name"))
        p.docker=lambda *_args,**_kwargs:(1,b"")
        with self.assertRaises(m.Stopped):p.resource_absent(name)

    def test_inactive_role_preload_settings_never_enter_operator_connection_env(self):
        d=metadata()
        d["roles"].append({**copy.deepcopy(d["roles"][0]),"name":"authenticator"})
        raw="session_preload_libraries=supautils, safeupdate"
        d["roleSettings"]=[{"role":"authenticator","database":"*","settings":[raw],
            "settingFingerprints":[{"key":"session_preload_libraries","sha256":m.digest(raw.encode()),"retained":True}]}]
        m.validate_metadata(d,source_sha="a"*40)
        sql=m.role_setup_sql(d)
        self.assertIn('ALTER ROLE "authenticator" SET "session_preload_libraries"',sql)
        self.assertNotIn(m.OPERATOR,sql)
        for role in ["*","postgres",m.OPERATOR]:
            with self.subTest(role=role),self.assertRaises(m.Stopped):
                m.safe_setting(raw,role=role,database="*")
        self.assertEqual(m.safe_setting(raw,role="authenticator",database="*"),tuple(raw.split("=",1)))

    def test_native_snapshot_compares_complete_extension_owner_metadata(self):
        p=self.probe();p.native_tools={"pg_dump":"/native/pg_dump"};p.uid=1001;p.gid=1001
        catalog={k:copy.deepcopy(p.metadata[k]) for k in ["bootstrapRole","roles","memberships","schemas","extensions"]}
        catalog.update(tables=[],sequences=[],roleSettings=[],largeObjects=[])
        census={"serverVersionNum":170006,"counts":{"unownedNamespaceObjects":0},
                "tables":[],"namespaceObjects":[],"globalObjects":[]}
        def client_sql(_target,sql,**_):
            if m.recovery.CATALOG_SQL in sql:return 0,json.dumps(catalog).encode()
            if "pg_extension e JOIN pg_namespace" in sql:return 0,json.dumps(catalog["extensions"]).encode()
            return 0,json.dumps(census).encode()
        p.client_sql=client_sql;p.docker=lambda *_args,**_kwargs:(0,b"-- schema\n")
        snapshot=p.native_snapshot("a")
        self.assertTrue(snapshot["extensionMatch"])
        self.assertTrue(snapshot["roleMatch"])
        catalog["extensions"][0]["owner"]="wrong_owner"
        self.assertFalse(p.native_snapshot("a")["extensionMatch"])

    def test_optional_extension_coverage_is_identical_readonly_query_and_never_semantics(self):
        p=self.probe()
        self.assertIsNone(p.extension_coverage("a"))
        proof={"format":1,"operation":"extension-member-semantics-coverage-preflight","serverVersionNum":170006,
               **{k:False for k in ["qualified","qualificationReady","semanticEqualityProven",
                  "catalogPayloadAdaptersImplemented","deparsedDdlTreatedAsExact","customerRowsRead",
                  "rawMetadataReturned","productionMutated"]},"counts":{"unimplementedPayloadObjects":3},
               "memberInventorySha256":"a"*64,"dependencyInventorySha256":"b"*64}
        p.metadata["extensionCoverage"]=proof
        p.metadata["extensionCoverageQuerySha256"]=m.digest(m.metadata_source.EXTENSION_COVERAGE.read_bytes())
        calls=[]
        p.client_sql=lambda target,sql:(calls.append(sql) or (0,json.dumps(proof).encode()))
        self.assertEqual(p.extension_coverage("a"),proof)
        self.assertIn("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",calls[0])
        self.assertIn("SET LOCAL search_path=pg_catalog;",calls[0])
        self.assertIn(m.metadata_source.EXTENSION_COVERAGE.read_text(),calls[0])
        proof["semanticEqualityProven"]=True
        with self.assertRaises(m.metadata_source.Stopped):p.extension_coverage("a")

    def test_replication_or_extra_clients_are_not_accepted_as_stopped_consumers(self):
        p=self.probe()
        good={"preload":"","sessionPreload":"","localPreload":"","cron":"off","sockets":"",
              "otherClients":0,"workers":["client backend","checkpointer"]}
        for key,value in [("workers",["walsender"]),("workers",["pg_net worker"]),
                          ("otherClients",1),("sessionPreload","pg_net"),("localPreload","unsafe")]:
            p.client_sql=lambda *_args,**_kwargs:(0,json.dumps({**good,key:value}).encode())
            with self.subTest(key=key),self.assertRaises(m.Stopped):p.consumer_proof("a")
        p.client_sql=lambda *_args,**_kwargs:(0,json.dumps(good).encode())
        self.assertEqual(p.consumer_proof("a")["unexpectedWorkers"],0)

    def test_unconfirmed_native_failure_produces_only_fixed_receipt_and_no_readiness_claim(self):
        p=self.probe()
        p.initialize=lambda:(_ for _ in ()).throw(m.Stopped("native_dependency_unqualified"))
        p.cleanup=lambda:True
        result=p.execute()
        self.assertFalse(result["dataFreeSafetyProofComplete"])
        self.assertFalse(result["independentlyReviewed"]);self.assertFalse(result["baselineReady"])
        self.assertFalse(result["customerRowsUsed"]);self.assertFalse(result["customerRestorePerformed"])
        self.assertEqual(result["errorCode"],"native_dependency_unqualified")
        self.assertTrue(result["cleanupConfirmed"])
        self.assertNotIn("roles",p.output.read_text());self.assertNotIn("password",p.output.read_text())

    def test_late_extension_coverage_mismatch_revokes_success_and_main_rejects(self):
        p=self.probe()
        p.initialize=lambda:setattr(p,"server_image_qualification",synthetic_qualification()["receipt"])
        def files(work):p.server_dirs={k:work/k for k in ["a","b"]}
        p.make_private_files=files;p.create_network=lambda:None
        p.start_container=lambda target:{"Id":target}
        p.static_ipv6_neighbors=lambda *_:None;p.prepare_native=lambda *_:None
        p.tls_controls=lambda target:{"a":"111","b":"222"}[target]
        p.original_destination_guard=lambda *_:None;p.consumer_proof=lambda *_:None
        fingerprints={k:"f"*64 for k in ["emptyBaselineCensusSha256","emptyBaselineCatalogSha256",
                      "emptyBaselineRowsSha256","emptyBaselineSchemaSha256"]}
        p.native_snapshot=lambda *_:{"fingerprints":fingerprints,"roleMatch":True,"namespaceMatch":True,
                  "extensionMatch":True,"namespaceObjectCount":0,"globalObjectCount":0,"tableCount":0}
        p.extension_coverage=lambda target:{"notMatching":target}
        p.verify_effective_firewalls=lambda:None;p.denial_probes=lambda *_:0;p.cleanup=lambda:True
        with patch.object(m,"denial_targets",return_value=[]):result=p.execute()
        self.assertEqual(result["errorCode"],"independent_extension_coverage_differ")
        self.assertFalse(result["dataFreeSafetyProofComplete"])
        self.assertFalse(result["sourceMetadataCompatible"])
        metadata_file=self.root/"main-metadata.json";metadata_file.write_text("{}");metadata_file.chmod(0o600)
        import sys
        with patch.object(m,"Probe",return_value=SimpleNamespace(execute=lambda:result)), \
             patch.object(sys,"argv",["probe","--execute","--metadata-file",str(metadata_file),
                                       "--output",str(self.root/"main-receipt.json")]):
            with self.assertRaisesRegex(m.Stopped,"data_free_native_probe_unqualified"):m.main()

    def test_repeated_firewall_verification_uses_rule_pins_not_denial_or_host_observations(self):
        p=self.probe();p.netns={k:(100+i,1000+i) for i,k in enumerate(["a","b","client"])}
        namespace=b"-P INPUT DROP\n-P OUTPUT DROP\n-P FORWARD DROP\n"
        host=("-N "+p.chain+"\n-A "+p.chain+" -m comment --comment "+p.token+" -j DROP\n").encode()
        p.host_firewall_pins={k:m.digest(host) for k in ["iptables","ip6tables"]}
        p.network_evidence=[{"container":k,"family":family,"rulesSha256":m.digest(namespace)}
                            for k in p.netns for family in [4,6]]
        p.inspect=lambda name:{"State":{"Pid":p.netns[next(k for k,v in p.names.items() if v==name)][0]}}
        p.verify_container=lambda *_:None
        p.run=lambda args,**_:(0,host if args[-1]==p.chain else namespace)
        p.verify_effective_firewalls()
        p.network_evidence.append({"container":"a","family":6,"port":443,"connectDenied":True})
        p.verify_effective_firewalls()

    def test_base_timeout_control_calibrates_each_supported_expiry_without_version_flag(self):
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        for expired in [124,143]:
            p=self.probe();calls=[]
            self.assertEqual(p.timeout_pins,{})
            def docker(args,**kwargs):
                calls.append((args,kwargs))
                if tools["sha256sum"] in args:return 0,b"a"*64+b"  /native/timeout\n"
                if "printf 'timeout-control-positive\\n'" in args:return 0,b"timeout-control-positive\n"
                return expired,b"timeout-control-started\n"
            p.docker=docker
            with self.subTest(expired=expired),patch.object(m.time,"monotonic",side_effect=[0,1]):
                self.assertEqual(p.timeout_control("a",tools),expired)
            self.assertEqual(p.timeout_pins,{"a":"a"*64})
            self.assertEqual(p.network_evidence[-1],{"container":"a","timeoutSha256":"a"*64,
                "timeoutExitCode":expired,"positiveControlPassed":True,"expiryControlPassed":True})
            self.assertEqual(len(calls),3)
            self.assertFalse(any("--version" in args for args,_ in calls))
            self.assertIn("3",calls[1][0]);self.assertIn("1",calls[2][0])
            self.assertIn("printf 'timeout-control-started\\n'; exec sleep 3",calls[2][0])
            self.assertTrue(all(kwargs.get("allow_failure") for _,kwargs in calls[1:]))

    def test_base_timeout_control_rejects_incomplete_positive_or_unmeasured_expiry(self):
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        cases=[(143,b"timeout-control-started\n",0.1,0,b"timeout-control-positive\n"),
            (124,b"timeout-control-started\n",3,0,b"timeout-control-positive\n"),
            (127,b"timeout-control-started\n",1,0,b"timeout-control-positive\n"),
            (0,b"timeout-control-started\n",1,0,b"timeout-control-positive\n"),
            (124,b"",1,0,b"timeout-control-positive\n"),
            (124,b"unexpected\n",1,0,b"timeout-control-positive\n"),
            (124,b"timeout-control-started\n",1,1,b"timeout-control-positive\n"),
            (124,b"timeout-control-started\n",1,0,b"")]
        for status,output,elapsed,positive_code,positive_output in cases:
            p=self.probe()
            def docker(args,**_):
                if tools["sha256sum"] in args:return 0,b"a"*64+b"  /native/timeout\n"
                if "printf 'timeout-control-positive\\n'" in args:return positive_code,positive_output
                return status,output
            p.docker=docker
            with self.subTest(status=status,elapsed=elapsed,positive_code=positive_code,output=output),\
                 patch.object(m.time,"monotonic",side_effect=[0,elapsed]),self.assertRaises(m.Stopped):
                p.timeout_control("a",tools)
            self.assertEqual(p.network_evidence,[])

    def test_base_timeout_binary_identity_changes_and_command_failures_never_grant_evidence(self):
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        p=self.probe();p.timeout_pins["a"]="a"*64
        p.docker=lambda args,**_:(0,b"b"*64+b"  /native/timeout\n")
        with self.assertRaisesRegex(m.Stopped,"timeout_control_identity_unconfirmed"):p.timeout_control("a",tools)
        self.assertEqual(p.timeout_pins["a"],"a"*64);self.assertEqual(p.network_evidence,[])
        for raw in [b"not-a-hash\n",b"",b"\xff",b"A"*64+b"  /native/timeout\n"]:
            p=self.probe();p.docker=lambda args,**_:(0,raw)
            with self.subTest(raw=raw),self.assertRaises(m.Stopped):p.timeout_control("a",tools)
            self.assertEqual(p.network_evidence,[])
        p=self.probe();p.docker=lambda args,**_:(_ for _ in ()).throw(m.Stopped("native_command_failed"))
        with self.assertRaisesRegex(m.Stopped,"native_command_failed"):p.timeout_control("a",tools)
        self.assertEqual(p.network_evidence,[])

    def test_base_timed_denial_requires_calibrated_status_elapsed_window_and_no_output(self):
        tools={"timeout":"/native/timeout"}
        cases=[(143,b"",3,143,True),(124,b"",3,124,True),(1,b"",0.01,143,True),
            (143,b"",0.1,143,False),(143,b"",5,143,False),(143,b"",3,124,False),
            (124,b"",3,143,False),(0,b"",3,124,False),(127,b"",3,124,False),
            (-15,b"",3,143,False),(124,b"response",3,124,False),(1,b"response",0.1,143,False)]
        for code,out,elapsed,expired,accept in cases:
            p=self.probe();p.docker=lambda args,**_:(code,out)
            with self.subTest(code=code,elapsed=elapsed,expired=expired),patch.object(m.time,"monotonic",side_effect=[0,elapsed]):
                if accept:self.assertEqual(p.timed_denial_command("a",tools,"synthetic-network-control",expired),code)
                else:
                    with self.assertRaisesRegex(m.Stopped,"outbound_connection_not_denied"):
                        p.timed_denial_command("a",tools,"synthetic-network-control",expired)

    def test_base_denial_path_calibrates_real_controls_and_uses_each_containers_measured_status(self):
        p=self.probe();p.native_tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        statuses={"a":143,"b":124,"client":143};clock={"value":0.0};calls=[]
        def docker(args,**kwargs):
            calls.append(args);key=next(k for k,name in p.names.items() if name in args)
            if "/native/sha" in args:return 0,b"a"*64+b"  synthetic-binary\n"
            if "/native/timeout" not in args:return 0,b""
            script=args[-1]
            if script=="printf 'timeout-control-positive\\n'":return 0,b"timeout-control-positive\n"
            if "timeout-control-started" in script:
                clock["value"]+=1;return statuses[key],b"timeout-control-started\n"
            if "/dev/udp/" in script:
                self.assertIn("exec dd bs=1 count=1",script)
                p.last_stderr=b"KOVA_DNS_SOCKET_READY\nKOVA_DNS_RECEIVE_READY\n"
            clock["value"]+=3;return statuses[key],b""
        p.docker=docker
        targets=[("production-https","1.1.1.1",443),("production-db","2606:4700::1111",5432)]
        with patch.object(m.time,"monotonic",side_effect=lambda:clock["value"]):
            self.assertEqual(p.denial_probes(targets),21)
        controls=[r for r in p.network_evidence if "timeoutExitCode" in r]
        self.assertEqual({r["container"]:r["timeoutExitCode"] for r in controls},statuses)
        self.assertFalse(any("--version" in args and "/native/timeout" in args for args in calls))
        self.assertEqual(len([r for r in p.network_evidence if r.get("connectDenied")]),18)
        self.assertEqual(len([args for args in calls if args[-1:].count("printf 'timeout-control-positive\\n'")]),3)

    def test_base_immediate_network_failure_requires_an_actual_route_denial_diagnostic(self):
        for diagnostic in [b"connection refused",b"arbitrary failure",b"/bin/bash: connect: Operation not permitted\n",b""]:
            p=self.probe();p.native_tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
            p.timeout_control=lambda key,tools:143;p.last_stderr=diagnostic
            def docker(args,**_):
                if "/native/sha" in args:return 0,b"a"*64+b"  /bin/bash\n"
                return (1,b"") if "/native/timeout" in args else (0,b"")
            p.docker=docker
            with self.subTest(diagnostic=diagnostic),patch.object(m.time,"monotonic",side_effect=[0,0.01]),\
                 self.assertRaisesRegex(m.Stopped,"numeric_denial_cause_unconfirmed"):
                p.denial_probes([("production-https","1.1.1.1",443)])
            self.assertFalse(any(r.get("connectDenied") for r in p.network_evidence))

    def test_base_immediate_route_denials_accept_native_bash_wording_and_keep_udp_timeout_required(self):
        diagnostics=[b"/bin/bash: connect: Network unreachable\n/bin/bash: line 1: /dev/tcp/1.1.1.1/443: Network unreachable\n",
                     b"/bin/bash: connect: Network is unreachable\n",b"/bin/bash: connect: No route to host\n"]
        for diagnostic in diagnostics:
            p=self.probe();p.native_tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
            p.timeout_control=lambda key,tools:143
            calls=[];clock={"value":0.0}
            def docker(args,**kwargs):
                calls.append(args);p.last_stderr=b""
                if "/native/sha" in args:return 0,b"a"*64+b"  /bin/bash\n"
                if "/native/timeout" not in args:return 0,b""
                self.assertTrue(kwargs.get("allow_failure"))
                if "/dev/udp/" in args[-1]:
                    p.last_stderr=b"KOVA_DNS_SOCKET_READY\nKOVA_DNS_RECEIVE_READY\n"
                    clock["value"]+=3;return 143,b""
                p.last_stderr=diagnostic;return 1,b""
            p.docker=docker
            with self.subTest(diagnostic=diagnostic),patch.object(m.time,"monotonic",side_effect=lambda:clock["value"]):
                self.assertEqual(p.denial_probes([("public-https","1.1.1.1",443)]),18)
            self.assertEqual(len([r for r in p.network_evidence if r.get("connectDenied")]),15)
            self.assertEqual(len([args for args in calls if "/dev/udp/" in args[-1]]),3)

    def tls_fixture(self,*,mutation=None,bad_host=(1,b"server certificate does not match host"),
                    bad_ca=(1,b"certificate verify failed")):
        p=self.probe();p.native_tools={"timeout":"/native/timeout"};sql_calls=[];tcp_calls=[]
        rows={family:{"address":p.addresses["a"][family==6],"version":170006,
                      "systemIdentifier":"123456789","tls":True} for family in [4,6]}
        if mutation:
            family,key,value=mutation;rows[family][key]=value
        def client_sql(target,sql,**kwargs):
            sql_calls.append((target,sql,kwargs))
            if "inet_server_addr()" in sql:
                self.assertIn("'address',host(inet_server_addr())",sql)
                self.assertNotIn("inet_server_addr()::text",sql)
                return 0,json.dumps(rows[kwargs["family"]]).encode()
            if kwargs.get("host")=="wrong-host.invalid":
                p.last_stderr=bad_host[1];return bad_host[0],b""
            if kwargs.get("ca")=="/run/client/wrong-ca.crt":
                p.last_stderr=bad_ca[1];return bad_ca[0],b""
            return 0,b"1\n"
        p.client_sql=client_sql;p.docker=lambda args,**kwargs:(tcp_calls.append((args,kwargs)) or (0,b""))
        return p,sql_calls,tcp_calls

    def test_base_actual_tls_controls_project_plain_hosts_and_keep_dual_stack_and_certificate_controls(self):
        p,sql,tcp=self.tls_fixture()
        self.assertEqual(p.tls_controls("a"),"123456789")
        self.assertEqual([kwargs["family"] for _,_,kwargs in sql[:2]],[4,6])
        self.assertEqual(len(tcp),2)
        for family,(args,kwargs) in zip([4,6],tcp):
            self.assertEqual(args,["exec",p.names["client"],"/native/timeout","3","/bin/bash","-ceu",
                "exec 3<>/dev/tcp/"+p.addresses["a"][family==6]+"/5432"])
            self.assertEqual(kwargs,{"timeout":5})
        self.assertEqual(sql[2][2],{"host":"wrong-host.invalid","allow_failure":True})
        self.assertEqual(sql[3][2],{"ca":"/run/client/wrong-ca.crt","allow_failure":True})
        self.assertEqual(sql[4],("a","SELECT 1;\n",{}))

    def test_base_actual_tls_controls_reject_wrong_or_prefixed_addresses_tls_version_and_cluster_drift(self):
        for family,wrong in [(4,"172.30.240.99"),(6,"fd68:6b6f:7661:240::99")]:
            for key,value,error in [("address",wrong,m.Stopped),("tls",False,m.Stopped),
                    ("version",170007,m.Stopped),("systemIdentifier","not-a-cluster-id",m.Stopped)]:
                p,sql,_=self.tls_fixture(mutation=(family,key,value))
                with self.subTest(family=family,key=key),self.assertRaises(error):p.tls_controls("a")
                self.assertFalse(any(kwargs.get("allow_failure") for _,_,kwargs in sql))
            p,_,_=self.tls_fixture();prefixed=p.addresses["a"][family==6]+("/32" if family==4 else "/128")
            p,sql,_=self.tls_fixture(mutation=(family,"address",prefixed))
            # The producer must emit host(); the verifier never strips a mask
            # from an arbitrary response and accepts it as the pinned address.
            with self.subTest(family=family,prefix=True),self.assertRaises(ValueError):p.tls_controls("a")
            self.assertFalse(any(kwargs.get("allow_failure") for _,_,kwargs in sql))
        p,_,tcp=self.tls_fixture(mutation=(6,"systemIdentifier","987654321"))
        with self.assertRaisesRegex(m.Stopped,"target_cluster_changed"):p.tls_controls("a")
        self.assertEqual(len(tcp),2)

    def test_base_actual_tls_controls_require_both_negative_certificate_operations_to_fail_for_the_right_reason(self):
        cases=[({"bad_host":(0,b"does not match")},"wrong_hostname_rejection_unconfirmed"),
            ({"bad_host":(1,b"connection failed")},"wrong_hostname_rejection_unconfirmed"),
            ({"bad_ca":(0,b"certificate verify failed")},"wrong_ca_rejection_unconfirmed"),
            ({"bad_ca":(1,b"connection failed")},"wrong_ca_rejection_unconfirmed"),
            ({"bad_ca":(1,b"certificate expired")},"wrong_ca_rejection_unconfirmed")]
        for options,error in cases:
            p,sql,_=self.tls_fixture(**options)
            with self.subTest(options=options),self.assertRaisesRegex(m.Stopped,error):p.tls_controls("a")
            self.assertFalse(any(text=="SELECT 1;\n" and kwargs=={} for _,text,kwargs in sql))

    def udp_fixture(self,*,code,stderr,stdout=b""):
        p=self.probe();calls=[]
        def docker(args,**kwargs):
            calls.append((args,kwargs));p.last_stderr=b""
            if "/native/timeout" in args:
                p.last_stderr=stderr;return code,stdout
            return 0,b""
        p.docker=docker
        return p,calls

    def test_udp_fixed_query_accepts_only_marked_send_eperm_or_measured_receive_expiry(self):
        socket_ready=b"KOVA_DNS_SOCKET_READY\n";receive_ready=b"KOVA_DNS_RECEIVE_READY\n"
        send_failed=b"KOVA_DNS_SEND_FAILED\n"
        eperm=b"/bin/bash: line 1: printf: write error: Operation not permitted\n"
        for code,stderr,elapsed,expired,phase in [(1,socket_ready+eperm+send_failed,0.01,143,"send-blocked"),
                (124,socket_ready+receive_ready,3,124,"receive-timeout"),
                (143,socket_ready+receive_ready,3,143,"receive-timeout")]:
            p,calls=self.udp_fixture(code=code,stderr=stderr)
            with self.subTest(code=code),patch.object(m.time,"monotonic",side_effect=[0,elapsed]):
                self.assertEqual(p.udp_dns_denial_command("a",{"timeout":"/native/timeout"},expired),phase)
            self.assertEqual(calls[0],(["exec",p.names["a"],"/bin/bash","-ceu","command -v dd >/dev/null"],{}))
            args,kwargs=calls[1]
            self.assertEqual(args[:-1],["exec",p.names["a"],"/native/timeout","3","/bin/bash","-ceu"])
            self.assertEqual(kwargs,{"timeout":5,"allow_failure":True})
            self.assertEqual(args[-1],m.udp_dns_probe_script())
            self.assertEqual(args[-1].count("exec 3<>/dev/udp/127.0.0.11/53;"),1)
            self.assertNotIn("\n",args[-1]);self.assertNotIn("/dev/tcp/",args[-1])
            self.assertIn("\\x07example\\x03com\\x00\\x00\\x01\\x00\\x01",args[-1])
            self.assertEqual(p.network_evidence,[{"container":"a","kind":"docker-dns-udp","family":4,
                "port":53,"addressSha256":m.digest(b"127.0.0.11"),"denialPhase":phase,
                "sendDenied":phase=="send-blocked","replyNotReceived":True}])

    def test_udp_unknown_error_phase_reply_status_stdout_or_fast_expiry_never_counts_as_denial(self):
        sock=b"KOVA_DNS_SOCKET_READY\n";recv=b"KOVA_DNS_RECEIVE_READY\n";failed=b"KOVA_DNS_SEND_FAILED\n"
        eperm=b"/bin/bash: line 1: printf: write error: Operation not permitted\n"
        cases=[(1,eperm,0.01,143,b""),(1,sock+eperm,0.01,143,b""),
            (1,sock+failed,0.01,143,b""),(1,sock+recv+eperm+failed,0.01,143,b""),
            (1,sock+eperm.replace(b"Operation not permitted",b"Permission denied")+failed,0.01,143,b""),
            (1,sock+eperm.replace(b"line 1",b"line 2")+failed,0.01,143,b""),
            (1,sock+b"/bin/bash: /dev/udp/1.1.1.1/53: Operation not permitted\n"+failed,0.01,143,b""),
            (1,b"extra\n"+sock+eperm+failed,0.01,143,b""),(1,sock+eperm+failed+b"extra\n",0.01,143,b""),
            (1,sock+eperm+failed,0.01,143,b"reply"),(0,sock+recv,0.01,143,b""),
            (127,sock+recv,3,143,b""),(-15,sock+recv,3,143,b""),
            (143,sock+recv,0.01,143,b""),(143,sock+recv,5,143,b""),
            (143,sock+recv,3,124,b""),(124,sock+recv,3,143,b""),
            (143,sock+eperm+failed,3,143,b""),(143,sock,3,143,b""),
            (143,recv+sock,3,143,b""),(143,sock+recv+b"extra\n",3,143,b"")]
        for code,stderr,elapsed,expired,stdout in cases:
            p,_=self.udp_fixture(code=code,stderr=stderr,stdout=stdout)
            with self.subTest(code=code,stderr=stderr,elapsed=elapsed,expired=expired),\
                 patch.object(m.time,"monotonic",side_effect=[0,elapsed]),self.assertRaises(m.Stopped):
                p.udp_dns_denial_command("a",{"timeout":"/native/timeout"},expired)
            self.assertEqual(p.network_evidence,[])
        for expired in [True,1,137,"143",None]:
            p,calls=self.udp_fixture(code=1,stderr=sock+eperm+failed)
            with self.subTest(expired=expired),self.assertRaisesRegex(m.Stopped,"embedded_dns_udp_denial_unconfirmed"):
                p.udp_dns_denial_command("a",{"timeout":"/native/timeout"},expired)
            self.assertEqual(calls,[]);self.assertEqual(p.network_evidence,[])

    def run_udp_send_body_on_local_fd(self,fd):
        original=m.udp_dns_probe_script();opening="exec 3<>/dev/udp/127.0.0.11/53;"
        self.assertEqual(original.count(opening),1)
        script=original.replace(opening,'exec 3>&"$KOVA_UNIT_FD";',1)
        self.assertNotIn("/dev/udp/",script)
        # Execute the real phase/send/receive body with only its endpoint open
        # replaced. Inherited local kernel FDs never perform a DNS/network call.
        return subprocess.run(["/bin/bash","-ceu",script],pass_fds=(fd,),capture_output=True,timeout=5,
            env={"PATH":os.environ["PATH"],"LC_ALL":"C","KOVA_UNIT_FD":str(fd)})

    def test_real_bash_sealed_memfd_write_eperm_matches_only_the_exact_send_failure_branch(self):
        fd=os.memfd_create("kova-synthetic-sealed-dns",os.MFD_ALLOW_SEALING)
        try:
            # Linux UAPI F_ADD_SEALS/F_SEAL_WRITE; some Python builds omit the
            # names although the kernel interface is available.
            fcntl.fcntl(fd,getattr(fcntl,"F_ADD_SEALS",1033),getattr(fcntl,"F_SEAL_WRITE",0x0008))
            result=self.run_udp_send_body_on_local_fd(fd)
            self.assertEqual(os.fstat(fd).st_size,0)
        finally:os.close(fd)
        expected=(b"KOVA_DNS_SOCKET_READY\n/bin/bash: line 1: printf: write error: Operation not permitted\n"
                  b"KOVA_DNS_SEND_FAILED\n")
        self.assertEqual(result.returncode,1);self.assertEqual(result.stdout,b"");self.assertEqual(result.stderr,expected)
        p,_=self.udp_fixture(code=result.returncode,stdout=result.stdout,stderr=result.stderr)
        with patch.object(m.time,"monotonic",side_effect=[0,0.01]):
            self.assertEqual(p.udp_dns_denial_command("a",{"timeout":"/native/timeout"},143),"send-blocked")

    def test_real_bash_successful_local_socket_send_and_received_byte_is_never_a_dns_denial(self):
        client,peer=socket.socketpair()
        with client,peer:
            peer.settimeout(1);peer.sendall(b"R")
            result=self.run_udp_send_body_on_local_fd(client.fileno())
            query=peer.recv(4096)
        self.assertTrue(query.startswith(b"\x12\x34"));self.assertIn(b"\x07example\x03com\x00",query)
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,b"")
        self.assertEqual(result.stderr,b"KOVA_DNS_SOCKET_READY\nKOVA_DNS_RECEIVE_READY\n")
        p,_=self.udp_fixture(code=result.returncode,stdout=result.stdout,stderr=result.stderr)
        with patch.object(m.time,"monotonic",side_effect=[0,0.01]),\
             self.assertRaisesRegex(m.Stopped,"outbound_connection_not_denied"):
            p.udp_dns_denial_command("a",{"timeout":"/native/timeout"},143)
        self.assertEqual(p.network_evidence,[])


    def test_source_bootstrap_identity_cannot_be_missing_guessed_or_non_superuser(self):
        self.assertEqual(m.validate_metadata(metadata(),source_sha="a"*40)["bootstrapRole"],"postgres")
        for mutate in [lambda c:c.pop("bootstrapRole"),lambda c:c.update(bootstrapRole="unobserved_root"),
                       lambda c:c["roles"][0].update(super=False)]:
            changed=metadata();mutate(changed)
            with self.assertRaisesRegex(m.Stopped,"source_bootstrap_role_unqualified"):
                m.validate_metadata(changed,source_sha="a"*40)


if __name__=="__main__":unittest.main()
