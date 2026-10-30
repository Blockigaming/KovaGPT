"""Synthetic guard/recipe tests; no Docker, source endpoint, data or restore."""
import copy
import errno
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from contextlib import redirect_stdout
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/smoke-synthetic-recovery-native.py"
spec=importlib.util.spec_from_file_location("synthetic_native_smoke",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
o=m.operator


class SyntheticTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.env={"KOVA_SYNTHETIC_NATIVE_CONFIRMATION":"SYNTHETIC_ONLY","GITHUB_ACTIONS":"true","RUNNER_OS":"Linux",
          "GITHUB_EVENT_NAME":"pull_request","GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/pull/42/merge",
          "GITHUB_SHA":"a"*40,"KOVA_SYNTHETIC_SOURCE_SHA":"a"*40,"GITHUB_RUN_ID":"123","GITHUB_RUN_ATTEMPT":"1",
          "RUNNER_TEMP":str(self.root),"PATH":os.environ.get("PATH","")}

    def probe(self):
        p=m.SyntheticProbe(self.env,self.root/"proof"/"receipt.json",operator_image_id="sha256:"+"1"*64)
        p.uid=1001;p.gid=1001;p.pg_uid=999;p.pg_gid=999
        p.client_dir=self.root/"client";p.server_dirs={k:self.root/k for k in ["a","b"]}
        p.image_env={"PATH":"/pg/bin"};p.image_volumes=[];p.operator_env={"PATH":"/usr/bin"}
        p.server_image_id="sha256:"+"2"*64
        return p

    def info(self,p,key):
        client=key=="client";env={**(p.operator_env if client else p.image_env),"HOME":"/tmp","TZ":"UTC"}
        env["TMPDIR" if client else "PGDATA"]="/work" if client else "/run/server/data"
        memory=(p.resources["clientMemoryMiB"] if client else p.resources["serverMemoryMiB"][key])*1024**2
        return {"Image":p.operator_image_id if client else p.server_image_id,
          "State":{"Running":True,"Pid":4321},"Config":{"Labels":{"kova.empty-probe.owner":p.token},
            "Healthcheck":{"Test":["NONE"]},"Env":[k+"="+v for k,v in env.items()],
            "User":"1001:1001" if client else "999:999"},
          "HostConfig":{"Privileged":False,"ReadonlyRootfs":True,"CapDrop":["ALL"],"CapAdd":[],
            "NetworkMode":p.network,"PortBindings":{},"PidMode":"","IpcMode":"private","CgroupnsMode":"private",
            "Memory":memory,"MemorySwap":memory,"LogConfig":{"Type":"none"}},
          "NetworkSettings":{"Ports":{},"Networks":{p.network:{"IPAddress":p.addresses[key][0],
            "GlobalIPv6Address":p.addresses[key][1]}}},
          "Mounts":[{"Type":"bind","Source":str(p.client_dir if client else p.server_dirs[key]),
            "Destination":"/run/client" if client else "/run/server","RW":False},
            {"Type":"tmpfs","Destination":"/tmp","RW":True},
            {"Type":"tmpfs","Destination":"/work" if client else "/run/server/data","RW":True}]}

    def test_only_pr_merge_context_with_no_sensitive_bindings_is_accepted(self):
        self.assertEqual(m.synthetic_context(self.env),"a"*40)
        for key,value in [("GITHUB_EVENT_NAME","pull_request_target"),("GITHUB_REF","refs/heads/main"),
          ("GITHUB_SHA","b"*40),("GITHUB_REPOSITORY","other/repo"),("KOVA_PRODUCTION_DATABASE_URL","synthetic"),
          ("KOVA_PRODUCTION_BACKUP_PASSPHRASE","synthetic"),("APPROVED_ISOLATED_HOST","synthetic"),
          ("KOVA_AUTH_RESTORE_ATTESTATION","synthetic"),("OPENAI_API_KEY","synthetic")]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.synthetic_context({**self.env,key:value})

    def test_real_operator_constructor_retains_main_guard_and_does_not_accept_pr(self):
        with self.assertRaises(m.Stopped):
            o.OperatorProbe({},self.env,self.root/"receipt.json",operator_image_id="sha256:"+"1"*64)

    def test_runtime_recipe_has_no_docker_log_or_host_plaintext_data_backing(self):
        p=self.probe()
        for key in ["a","b","client"]:
            args=p._container_args(key)
            self.assertEqual(args[args.index("--log-driver")+1],"none")
            self.assertEqual(args[args.index("--memory")+1],args[args.index("--memory-swap")+1])
            self.assertEqual(args[args.index("--cgroupns")+1],"private")
            mounts=[args[i+1] for i,x in enumerate(args) if x=="--mount"]
            self.assertEqual(len(mounts),1);self.assertTrue(mounts[0].endswith(",readonly"))
            temporary=[args[i+1] for i,x in enumerate(args) if x=="--tmpfs"]
            self.assertTrue(all(",noswap" in x and ",noexec" in x for x in temporary))
            self.assertTrue(any(x.startswith(("/work:" if key=="client" else "/run/server/data:")) for x in temporary))
            self.assertNotIn("docker.sock",str(args));self.assertNotIn("--publish",args)

    def test_actual_json_logging_swap_root_mount_or_image_drift_is_rejected(self):
        p=self.probe()
        for key in ["a","client"]:
            p.verify_container(key,self.info(p,key))
            mutations=[lambda d:d["HostConfig"]["LogConfig"].update(Type="json-file"),
              lambda d:d["HostConfig"].update(MemorySwap=-1),lambda d:d["HostConfig"].update(CgroupnsMode="host"),
              lambda d:d.update(Image="sha256:"+"9"*64),lambda d:d["Mounts"][0].update(RW=True),
              lambda d:d["HostConfig"].update(PortBindings={"5432/tcp":[{"HostPort":"5432"}]}),
              lambda d:d["Mounts"].pop()]
            for mutate in mutations:
                value=self.info(p,key);mutate(value)
                with self.subTest(key=key,mutation=mutations.index(mutate)),self.assertRaises(m.Stopped):p.verify_container(key,value)

    def test_runtime_kernel_checks_use_exact_noswap_no_capability_and_private_data_mounts(self):
        p=self.probe();calls=[];p.docker=lambda args,**_:(calls.append(args) or (0,b""))
        for key in ["a","client"]:p.assert_runtime_policy(key)
        for args in calls:
            script=args[-1]
            check=subprocess.run(["bash","-n","-c",script],capture_output=True)
            self.assertEqual(check.returncode,0,check.stderr.decode())
            for required in ["/proc/self/status","NoNewPrivs","CapEff","memory.swap.max","noswap","/proc/mounts"]:
                self.assertIn(required,script)

    def test_server_startup_keeps_logging_collector_off_and_logs_in_tmpfs(self):
        p=self.probe();calls=[]
        p.reserve_absent=lambda *_:None;p.save_state=lambda:None
        p.docker=lambda args,**_:(calls.append(args) or (0,b""));p.inspect=lambda *_:self.info(p,"a")
        p.namespace_firewall=lambda *_:None;p.assert_runtime_policy=lambda *_:None;p.run=lambda *_args,**_kwargs:(0,b"")
        p.start_container("a")
        script=calls[0][-1]
        result=subprocess.run(["bash","-n","-c",script],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        self.assertIn("logging_collector=off",script);self.assertIn("log_destination='stderr'",script)
        self.assertIn("/tmp/postgres.log",script);self.assertIn("log_statement=none",script)

    def test_client_sql_uses_final_client_paths_and_target_only_environment(self):
        p=self.probe();p.client_tools={"psql":"/operator/psql"};p.native_tools={"psql":"/server/psql"};calls=[]
        p.docker=lambda args,**kwargs:(calls.append(args) or (0,b"1\n"))
        p.client_sql("a","SELECT 1;")
        args=calls[0];self.assertIn("/operator/psql",args);self.assertNotIn("/server/psql",args)
        values=[args[i+1] for i,x in enumerate(args) if x=="--env"]
        self.assertIn("PGSSLMODE=verify-full",values)
        self.assertFalse(any("PASSWORD" in x or "PRODUCTION" in x for x in values))

    def test_separate_server_client_bash_hashes_and_native_paths_are_verified(self):
        p=self.probe();p.native_tools={"timeout":"/server/timeout","sha256sum":"/server/sha"}
        p.client_tools={"timeout":"/operator/timeout","sha256sum":"/operator/sha"}
        p.bash_pins={"a":"a"*64,"b":"a"*64,"client":"b"*64};calls=[]
        def docker(args,**_):
            calls.append(args)
            key=next(k for k in ["a","b","client"] if p.names[k] in args)
            if args[-1:]==["/bin/bash"] and any(x.endswith("/sha") for x in args):return 0,(p.bash_pins[key]+"  /bin/bash\n").encode()
            if "3" in args:return 124,b""
            return 0,b""
        p.docker=docker
        self.assertGreater(p.denial_probes([("synthetic","1.1.1.1",443),("synthetic","2606:4700::1111",443)]),0)
        self.assertTrue(any(p.names["client"] in a and "/operator/timeout" in a for a in calls))
        self.assertFalse(any(p.names["client"] in a and "/server/timeout" in a for a in calls))
        def wrong_hash(args,**_):
            if args[-1:]==["/bin/bash"] and any(x.endswith("/sha") for x in args):return 0,("f"*64+"  /bin/bash\n").encode()
            return 0,b""
        p.docker=wrong_hash
        with self.assertRaisesRegex(m.Stopped,"bash_control_identity_changed"):p.denial_probes([])

    def test_completed_synthetic_probe_never_grants_source_review_or_restore_authority(self):
        p=self.probe();p.initialize=lambda:setattr(p,"operator_smoke",{"generic":"fixture"})
        p.make_private_files=lambda *_:None;p.create_network=lambda:None
        p.start_container=lambda key:{"Id":key};p.static_ipv6_neighbors=lambda *_:None
        p.derive_image_fixture=lambda:setattr(p,"metadata",{"sourceSettingsComplete":True})
        p.prepare_native=lambda *_:None;p.tls_controls=lambda key:{"a":"111","b":"222"}[key]
        p.original_destination_guard=lambda *_:None;p.consumer_proof=lambda *_:None
        pins={k:"c"*64 for k in ["emptyBaselineCensusSha256","emptyBaselineCatalogSha256","emptyBaselineRowsSha256","emptyBaselineSchemaSha256"]}
        p.native_snapshot=lambda *_:{"fingerprints":pins,"roleMatch":True,"namespaceMatch":True,"extensionMatch":True}
        p.verify_effective_firewalls=lambda:None;p.denial_probes=lambda *_:12;p.inspect_and_recheck_runtime=lambda *_:None
        p.cleanup=lambda:True
        result=p.execute_synthetic();self.assertTrue(result["syntheticNativeProofComplete"])
        for field in ["sourceProof","sourceMetadataCompatible","independentlyReviewed","restoreQualified",
                      "futureTargetApproved","customerRowsUsed","productionMutated","ociArchiveUploaded"]:
            self.assertIs(result[field],False,field)
        p.cleanup=lambda:False
        result=p.execute_synthetic();self.assertFalse(result["syntheticNativeProofComplete"])
        self.assertFalse(result["nativeResourcesCleanupConfirmed"])

    def test_synthetic_builder_builds_only_allowlisted_recipe_and_never_exports_archive(self):
        self.assertNotIn("oci-archive:",m.SyntheticBuilder.build.__code__.co_consts)
        self.assertEqual(m.FIXTURE_EXTENSIONS,("pgcrypto","vector"))
        self.assertNotIn("sourceCommit",m.SyntheticProbe.derive_image_fixture.__code__.co_consts)

    def test_inherited_execute_entrypoint_also_cannot_emit_source_authority(self):
        p=self.probe()
        sentinel={"syntheticNativeProofComplete":True,"sourceMetadataCompatible":False,"sourceProof":False,
                  "independentlyReviewed":False,"restoreQualified":False}
        with patch.object(p,"execute_synthetic",return_value=sentinel) as execute:
            self.assertIs(p.execute(),sentinel)
        execute.assert_called_once_with()

    def test_unknown_docker_build_completion_never_proves_image_cleanup(self):
        b=m.SyntheticBuilder(self.env)
        b.build_invoked=True;b.write_state("123","1")
        with patch.object(m.builder.Builder,"cleanup_image",return_value=True) as cleanup:
            with self.assertRaisesRegex(m.Stopped,"synthetic_build_completion_unknown"):
                m.cleanup_image_from_state(self.env)
        cleanup.assert_not_called()
        b.build_returned=True;b.write_state("123","1")
        with patch.object(m.builder.Builder,"cleanup_image",return_value=True):
            self.assertTrue(m.cleanup_image_from_state(self.env))

    def test_unknown_container_cleanup_keeps_generic_image_and_never_becomes_success(self):
        with patch.object(o,"cleanup_operator_state",side_effect=m.Stopped("daemon_unknown")), \
             patch.object(m,"cleanup_image_from_state") as image:
            self.assertEqual(m.cleanup_all(self.env),(False,False))
        image.assert_not_called()

    def test_image_fixture_uses_actual_control_versions_and_requires_every_requested_extension(self):
        p=self.probe();p.wait_native=lambda *_:None
        role={"name":"pg_database_owner","super":False,"inherit":True,"createRole":False,"createDb":False,
              "login":False,"replication":False,"bypassRls":False,"connectionLimit":-1,"validUntil":None}
        fixture={"roles":[role],"memberships":[],"schemas":[{"name":"public","owner":"pg_database_owner","acl":None,"comment":None}],
                 "available":[{"name":"plpgsql","version":"1.0","schema":"pg_catalog"},
                   {"name":"pgcrypto","version":"1.3","schema":None},{"name":"vector","version":"0.8.0","schema":None}]}
        calls=[]
        p.bootstrap_sql=lambda target,sql:(calls.append(sql) or (0,json.dumps(fixture).encode()))
        p.derive_image_fixture()
        self.assertEqual({e["name"]:e["version"] for e in p.metadata["extensions"]},
                         {"plpgsql":"1.0","pgcrypto":"1.3","vector":"0.8.0"})
        self.assertNotIn("sourceCommit",p.metadata);self.assertNotIn("sourceSettingsComplete",p.metadata)
        self.assertTrue(p.metadata["syntheticFixtureDerivedOnlyFromPinnedImage"])
        self.assertFalse(any("auth.users" in sql or "pg_authid" in sql for sql in calls))
        fixture["available"].pop()
        with self.assertRaisesRegex(m.Stopped,"synthetic_image_fixture_unavailable"):p.derive_image_fixture()

    def test_generic_context_modes_allow_nonroot_reads_without_copying_private_inputs(self):
        source=self.root/"generic-source";source.mkdir(mode=0o700)
        for name in m.builder.FILES:(source/name).write_text("generic public fixture\n")
        (source/"recovery-operator-client.Dockerfile").write_text("FROM public-fixture\n")
        private=source/"private-input.json";private.write_text("SYNTHETIC_PRIVATE_INPUT_NEVER_COPY");private.chmod(0o600)
        context=self.root/"generic-context";context.mkdir(mode=0o700)
        previous=os.umask(0o077)
        try:
            with patch.object(m.builder,"SOURCE",source):hashes=m.builder.source_context(context)
        finally:os.umask(previous)
        self.assertEqual(context.stat().st_mode&0o777,0o700)
        self.assertEqual((context/"source").stat().st_mode&0o777,0o755)
        self.assertEqual(set(x.name for x in (context/"source").iterdir()),set(m.builder.FILES))
        for path in [context/"Dockerfile",*((context/"source").iterdir())]:
            self.assertEqual(path.stat().st_mode&0o777,0o644)
            self.assertNotIn("SYNTHETIC_PRIVATE_INPUT",path.read_text())
        self.assertEqual(private.stat().st_mode&0o777,0o600)
        self.assertEqual(set(hashes),set(m.builder.FILES)|{"recovery-operator-client.Dockerfile"})

    def test_completed_command_diagnostic_preserves_actual_exit_and_redacts_environment_credentials(self):
        secret="SYNTHETIC_RUNTIME_TOKEN_NEVER_ECHO"
        b=m.SyntheticBuilder({**self.env,"ACTIONS_RUNTIME_TOKEN":secret})
        b.set_build_stage("build");seen=[]
        def command(argv,**kwargs):
            seen.append(kwargs["env"])
            kwargs["stderr"].write(("Docker build failed: missing signed repository\n"+secret+
                "\nhttps://alice:password@registry.invalid/v2/\nAuthorization: Bearer unknown-token\n").encode())
            return subprocess.CompletedProcess(argv,17)
        with patch.object(m.subprocess,"run",side_effect=command),self.assertRaises(m.SyntheticCommandFailure) as caught:
            b.command(["docker","build","public-context"])
        error=caught.exception;details=error.details
        self.assertTrue(error.completed);self.assertEqual(details["exitCode"],17)
        self.assertEqual(details["stage"],"build");self.assertEqual(details["status"],"exit")
        self.assertIn("missing signed repository",details["stderrTail"])
        rendered=json.dumps(details)
        for value in [secret,"alice:password","unknown-token"]:self.assertNotIn(value,rendered)
        self.assertNotIn("ACTIONS_RUNTIME_TOKEN",seen[0])
        self.assertEqual(str(error),"synthetic_command_nonzero_exit")

    def test_unknown_command_timeout_os_error_or_signal_remains_distinct_and_uncompleted(self):
        b=m.SyntheticBuilder(self.env);b.set_build_stage("pull")
        failures=[(subprocess.TimeoutExpired(["docker"],1),"timeout",None),
                  (OSError(errno.ENOENT,"SYNTHETIC_PRIVATE_EXCEPTION_TEXT"),"os-error",None),
                  (subprocess.CompletedProcess(["docker"],-9),"signal",-9)]
        for answer,status,exit_code in failures:
            def command(_argv,**kwargs):
                kwargs["stderr"].write(b"safe native diagnostic\n")
                if isinstance(answer,Exception):raise answer
                return answer
            with self.subTest(status=status),patch.object(m.subprocess,"run",side_effect=command), \
                 self.assertRaises(m.SyntheticCommandFailure) as caught:
                b.command(["docker","pull","public"])
            self.assertFalse(caught.exception.completed)
            self.assertEqual(caught.exception.details["status"],status)
            self.assertEqual(caught.exception.details["exitCode"],exit_code)
            self.assertNotIn("SYNTHETIC_PRIVATE_EXCEPTION",json.dumps(caught.exception.details))

    def test_diagnostic_bounds_strip_controls_and_redact_before_truncating(self):
        secret="SYNTHETIC_BOUNDARY_SECRET"
        value=m.safe_diagnostic(("x"*5000+"\x1b[31m"+secret+"\x1b[0m end").encode(),(secret,))
        self.assertLessEqual(len(value.encode()),m.MAX_DIAGNOSTIC_BYTES)
        self.assertNotIn(secret,value);self.assertNotIn("\x1b",value)
        self.assertNotIn("SECRET",m.safe_diagnostic((secret+"end").encode(),(secret,),7))
        b=m.SyntheticBuilder(self.env);b.set_build_stage("inspect")
        def command(argv,**kwargs):
            kwargs["stderr"].write(b"z"*(m.MAX_COMMAND_OUTPUT_BYTES+1))
            return subprocess.CompletedProcess(argv,1)
        with patch.object(m.subprocess,"run",side_effect=command),self.assertRaises(m.SyntheticCommandFailure) as caught:
            b.command(["docker","image","inspect","public"])
        self.assertEqual(str(caught.exception),"synthetic_command_output_bound")
        details=caught.exception.details
        self.assertFalse(details["outputWithinBound"])
        self.assertLessEqual(len(details["stderrTail"])+len(details["stdoutTail"]),m.MAX_DIAGNOSTIC_BYTES)
        with patch.object(m.resource,"setrlimit") as limit:m.bounded_diagnostic_child()
        limit.assert_called_once_with(m.resource.RLIMIT_FSIZE,(m.MAX_COMMAND_OUTPUT_BYTES,m.MAX_COMMAND_OUTPUT_BYTES))

    def test_every_build_phase_is_pinpointed_and_completed_build_exit_can_be_cleaned(self):
        for index,stage in enumerate(["git","pull","inspect","context","build","final-inspect"],2):
            env={**self.env,"GITHUB_RUN_ATTEMPT":str(index)};b=m.SyntheticBuilder(env)
            def command(argv,**_kwargs):
                if b.build_stage==stage:
                    raise m.SyntheticCommandFailure("synthetic_command_nonzero_exit",
                        {"stage":stage,"status":"exit","exitCode":1,"completed":True,
                         "outputWithinBound":True,"stderrTail":"safe phase failure","stdoutTail":""},completed=True)
                if b.build_stage=="git":return (b.source+"\n").encode()
                if b.build_stage=="inspect":return json.dumps([{"Id":"sha256:"+"b"*64,"Architecture":"amd64",
                    "Os":"linux","RepoDigests":["ubuntu@sha256:"+"b"*64]}]).encode()
                return b""
            def context(_folder):
                if stage=="context":raise m.builder.Stopped("generic_source_file_unqualified")
            actual_uid=os.getuid();uid_calls={"n":0}
            def first_nonroot_guard():
                uid_calls["n"]+=1
                return 1001 if uid_calls["n"]==1 else actual_uid
            with self.subTest(stage=stage),patch.object(b,"command",side_effect=command), \
                 patch.object(m.os,"getuid",side_effect=first_nonroot_guard),patch.object(m.builder,"source_context",side_effect=context), \
                 self.assertRaises((m.Stopped,m.builder.Stopped)) as caught:
                b.build()
            self.assertEqual(b.build_stage,stage)
            self.assertEqual(m.failure_details(caught.exception,b.build_stage)["stage"],stage)
            state=json.loads(b.state.read_bytes())
            self.assertEqual(state["buildInvoked"],stage in {"build","final-inspect"})
            self.assertEqual(state["buildReturned"],stage in {"build","final-inspect"})

    def test_primary_failure_survives_cleanup_failure_in_written_receipt_and_log(self):
        output=self.root/"failure-proof"/"receipt.json"
        failure=m.SyntheticCommandFailure("synthetic_command_nonzero_exit",
            {"stage":"pull","status":"exit","exitCode":23,"completed":True,
             "outputWithinBound":True,"stderrTail":"actual safe Docker error","stdoutTail":""},completed=True)
        class Build:
            build_stage="pull"
            def build(self):raise failure
        def cleanup(_env,*,details=None):
            details["image"]={"code":"synthetic_build_completion_unknown","stage":"cleanup"}
            return True,False
        capture=io.StringIO()
        with patch.dict(os.environ,self.env,clear=True),patch.object(m,"SyntheticBuilder",return_value=Build()), \
             patch.object(m,"cleanup_all",side_effect=cleanup), \
             patch.object(sys,"argv",["smoke","--execute","--output",str(output)]), \
             redirect_stdout(capture),self.assertRaises(SystemExit) as caught:
            m.main()
        self.assertEqual(caught.exception.code,1)
        receipt=json.loads(output.read_bytes())
        self.assertEqual(receipt["errorCode"],"synthetic_command_nonzero_exit")
        self.assertEqual(receipt["primaryFailure"]["command"]["exitCode"],23)
        self.assertEqual(receipt["primaryFailure"]["stage"],"pull")
        self.assertEqual(receipt["cleanupFailure"]["image"]["code"],"synthetic_build_completion_unknown")
        self.assertIn("actual safe Docker error",capture.getvalue())
        self.assertFalse(receipt["cleanupConfirmed"]);self.assertFalse(receipt["syntheticNativeProofComplete"])
        self.assertFalse(receipt["sourceProof"])

    def test_memory_policy_rejects_data_plane_larger_than_limit(self):
        p=self.probe();resources=copy.deepcopy(p.resources);resources["clientTmpfsMiB"]=768
        with self.assertRaises(m.Stopped):
            p.configure_operator(p.operator_image_id,p.source,resources)

    def test_image_environment_rejects_duplicates_and_source_or_provider_keys(self):
        for values in [["PATH=a","PATH=b"],["KOVA_PRODUCTION_DATABASE_URL=synthetic"],["OPENAI_API_KEY=synthetic"]]:
            with self.assertRaises(m.Stopped):o.environment(values)


if __name__=="__main__":unittest.main()
