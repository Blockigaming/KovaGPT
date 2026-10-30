"""Synthetic metadata and mocked commands; never Docker or a live database."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
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
            "sourcePackagingBuildObservedBySql":False,
            "roles":[role],"memberships":[],"roleSettings":[],
            "schemas":[{"name":"public","owner":"postgres","acl":None,"comment":None}],
            "extensions":[{"name":"plpgsql","version":"1.0","schema":"pg_catalog","owner":"postgres"}],
            "sourceSettingsComplete":True,"withheldSettingCount":0}


class NativeProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.env={"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_REPOSITORY":"Blockigaming/KovaGPT",
                  "GITHUB_REF":"refs/heads/main","GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,
                  "KOVA_EMPTY_PROBE_CONFIRMATION":"PROBE_EMPTY_ONLY","GITHUB_RUN_ID":"123",
                  "GITHUB_RUN_ATTEMPT":"1","RUNNER_TEMP":str(self.root),"PATH":os.environ["PATH"]}

    def probe(self):return m.Probe(metadata(),self.env,self.root/"output"/"receipt.json")

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

    def test_setting_policy_is_shared_with_collector_and_rejects_secret_or_preload_values(self):
        self.assertEqual(m.SAFE_SETTINGS,m.metadata_source.SAFE_GUC_KEYS)
        for raw in ["statement_timeout=30000","pgrst.db_root_spec=public.root_spec","default_transaction_read_only=on"]:
            self.assertEqual(m.safe_setting(raw),tuple(raw.split("=",1)))
        for raw in ["session_preload_libraries=pg_net","local_preload_libraries=unsafe","pgrst.jwt_secret=private",
                    "search_path=https://private.invalid","search_path=x\nALTER SYSTEM SET ssl=off"]:
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

    def test_native_snapshot_compares_complete_extension_owner_metadata(self):
        p=self.probe();p.native_tools={"pg_dump":"/native/pg_dump"};p.uid=1001;p.gid=1001
        catalog={k:copy.deepcopy(p.metadata[k]) for k in ["roles","memberships","schemas","extensions"]}
        catalog.update(tables=[],sequences=[],roleSettings=[],largeObjects=[])
        census={"serverVersionNum":170006,"counts":{"unownedNamespaceObjects":0},
                "tables":[],"namespaceObjects":[],"globalObjects":[]}
        def client_sql(_target,sql,**_):
            if m.recovery.CATALOG_SQL in sql:return 0,json.dumps(catalog).encode()
            if "pg_extension e JOIN pg_namespace" in sql:return 0,json.dumps(catalog["extensions"]).encode()
            return 0,json.dumps(census).encode()
        p.client_sql=client_sql;p.docker=lambda *_args,**_kwargs:(0,b"-- schema\n")
        self.assertTrue(p.native_snapshot("a")["extensionMatch"])
        catalog["extensions"][0]["owner"]="wrong_owner"
        self.assertFalse(p.native_snapshot("a")["extensionMatch"])

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


if __name__=="__main__":unittest.main()
