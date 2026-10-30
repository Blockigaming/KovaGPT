"""Synthetic guard/recipe tests; no Docker, source endpoint, data or restore."""
import copy
import errno
import hashlib
import io
import importlib.util
import json
import os
import re
import shutil
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
        args=p._container_args(key)
        specs=[p.tmpfs_spec(p.names[key],args[i+1]) for i,value in enumerate(args) if value=="--tmpfs"]
        p.tmpfs_volumes.update({spec["name"]:spec for spec in specs})
        p.inspect_tmpfs_volume=lambda spec:"/docker/volumes/"+spec["name"]+"/_data"
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
            *[{"Type":"volume","Name":spec["name"],"Driver":"local","Destination":spec["destination"],
               "Source":p.inspect_tmpfs_volume(spec),"RW":True} for spec in specs]]}

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
            script=args[args.index("-ceu")+1]
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
        p.timeout_control=lambda key,tools:124
        def docker(args,**_):
            calls.append(args)
            key=next(k for k in ["a","b","client"] if p.names[k] in args)
            if args[-1:]==["/bin/bash"] and any(x.endswith("/sha") for x in args):return 0,(p.bash_pins[key]+"  /bin/bash\n").encode()
            if "3" in args:return 124,b""
            return 0,b""
        p.docker=docker
        with patch.object(o.time,"monotonic",side_effect=[x for _ in range(40) for x in (0,3)]):
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

    def test_native_toolchain_failure_preserves_exact_attempt_and_sanitized_stderr_before_cleanup(self):
        for failed in ["git-head","docker-info","pinned-server-pull"]:
            p=self.probe();p.save_state=lambda:None;p._diagnostic_secrets=("SYNTHETIC_ENV_CANARY",)
            calls=[]
            def command(argv,**kwargs):
                calls.append(argv)
                attempted=m.native_command_stage(argv)
                if attempted==failed:
                    kwargs["stderr"].write(b"safe pull diagnostic\n"+b"x"*5000+
                        b"\nSYNTHETIC_ENV_CANARY Authorization: Basic U1lOVEhFVElDX0NBTkFSWQ==\nsafe final diagnostic\n")
                    return subprocess.CompletedProcess(argv,1)
                kwargs["stdout"].write((p.source+"\n").encode() if attempted=="git-head" else b"linux\n")
                return subprocess.CompletedProcess(argv,0)
            def cleanup():
                p.last_stderr=b"CLEANUP_REPLACED_STDERR"
                p.native_attempted_stage="native-other"
                return True
            p.cleanup=cleanup
            with self.subTest(failed=failed),patch.object(m.os,"getuid",return_value=1001), \
                 patch.object(m.subprocess,"run",side_effect=command):
                result=p.execute_synthetic()
            self.assertFalse(result["syntheticNativeProofComplete"])
            self.assertTrue(result["nativeResourcesCleanupConfirmed"])
            self.assertEqual(result["errorCode"],"native_command_failed")
            self.assertEqual(result["primaryFailure"]["code"],"native_command_failed")
            self.assertEqual(result["failedStage"],"native_tools")
            evidence=result["nativeFailure"]
            self.assertEqual(evidence["commandStage"],failed)
            self.assertEqual(evidence["exceptionType"],"Stopped")
            self.assertEqual(evidence["commandCount"],len(calls))
            self.assertIn("safe final diagnostic",evidence["stderrTail"])
            self.assertIn("[redacted]",evidence["stderrTail"])
            self.assertLessEqual(len(evidence["stderrTail"].encode("ascii")),m.MAX_DIAGNOSTIC_BYTES)
            for hidden in ["SYNTHETIC_ENV_CANARY","U1lOVEhFVElDX0NBTkFSWQ==","CLEANUP_REPLACED_STDERR"]:
                self.assertNotIn(hidden,json.dumps(result))
            self.assertEqual(calls[-1],["git","rev-parse","HEAD"] if failed=="git-head" else
                ["docker","info","--format","{{.OSType}}"] if failed=="docker-info" else
                ["docker","pull","--platform","linux/amd64",m.base.IMAGE])
            for field in ["sourceProof","sourceMetadataCompatible","independentlyReviewed","restoreQualified"]:
                self.assertIs(result[field],False)

    def test_native_attempt_classification_does_not_echo_unknown_commands_or_exception_names(self):
        for argv in [["docker","pull","--platform","linux/arm64",m.base.IMAGE],
                     ["docker","pull","--platform","linux/amd64","unreviewed:tag"],
                     ["synthetic-private-argument"]]:
            self.assertEqual(m.native_command_stage(argv),"native-other")
        class SyntheticPrivateExceptionName(RuntimeError):pass
        self.assertEqual(m.safe_exception_type(SyntheticPrivateExceptionName("PRIVATE_EXCEPTION_ARGUMENT")),"UnknownException")
        self.assertEqual(m.safe_exception_type(ValueError("PRIVATE_EXCEPTION_ARGUMENT")),"ValueError")
        self.assertNotIn("PRIVATE_EXCEPTION_ARGUMENT",m.safe_exception_type(RuntimeError("PRIVATE_EXCEPTION_ARGUMENT")))
        self.assertTrue(all(m.native_command_stage(argv) in m.NATIVE_COMMAND_STAGES for argv in [[],["unknown"]]))
        for code in ["native_command_failed","native_command_unconfirmed","native_permission_unqualified",
                     "native_extension_preload_unqualified","native_dependency_unqualified","private_command_output_bound"]:
            self.assertEqual(m.failure_details(m.Stopped(code))["code"],code)

    def test_unknown_native_phase_is_replaced_by_fixed_fallback(self):
        p=self.probe();p.save_state=lambda:None;p.cleanup=lambda:True
        def fail():
            p.stage="SYNTHETIC_PRIVATE_STAGE_CANARY";p.native_attempted_stage="SYNTHETIC_PRIVATE_ATTEMPT_CANARY"
            raise m.Stopped("native_command_failed")
        p.initialize=fail
        result=p.execute_synthetic()
        self.assertEqual(result["failedStage"],"native-stage-unconfirmed")
        self.assertEqual(result["nativeFailure"]["commandStage"],"native-other")
        self.assertNotIn("SYNTHETIC_PRIVATE_STAGE_CANARY",json.dumps(result))
        self.assertNotIn("SYNTHETIC_PRIVATE_ATTEMPT_CANARY",json.dumps(result))

    def test_uncertain_native_attempt_does_not_reuse_old_stderr(self):
        p=self.probe();p.last_stderr=b"STALE_SYNTHETIC_PRIVATE_CANARY"
        with patch.object(m.subprocess,"run",side_effect=OSError("PRIVATE_OSERROR_ARGUMENT")):
            with self.assertRaisesRegex(m.Stopped,"native_command_unconfirmed"):
                p.run(["docker","info","--format","{{.OSType}}"])
        self.assertEqual(p.native_failure["commandStage"],"docker-info")
        self.assertEqual(p.native_failure["stderrTail"],"")
        self.assertNotIn("PRIVATE_OSERROR_ARGUMENT",json.dumps(p.native_failure))

    def test_cleanup_exception_does_not_erase_native_primary_failure(self):
        p=self.probe();p.save_state=lambda:None
        def fail():
            p.stage="native_tools";p.native_attempted_stage="pinned-server-pull"
            raise m.Stopped("native_command_failed")
        def cleanup():raise ValueError("SYNTHETIC_PRIVATE_CLEANUP_ARGUMENT")
        p.initialize=fail;p.cleanup=cleanup
        result=p.execute_synthetic()
        self.assertEqual(result["errorCode"],"native_command_failed")
        self.assertEqual(result["nativeFailure"]["commandStage"],"pinned-server-pull")
        self.assertFalse(result["nativeResourcesCleanupConfirmed"])
        self.assertEqual(result["cleanupFailure"]["native"]["exceptionType"],"ValueError")
        self.assertNotIn("SYNTHETIC_PRIVATE_CLEANUP_ARGUMENT",json.dumps(result))

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

    def test_basic_quoted_headers_standalone_bearer_and_common_query_tokens_are_redacted(self):
        basic="U1lOVEhFVElDX0NBTkFSWQ==";bearer="SYNTHETIC_BEARER_CANARY";query="SYNTHETIC_QUERY_CANARY"
        cases=[f"Authorization: Basic {basic}\n",f'curl -H "Authorization: Basic {basic}"\n',
            f'"Authorization": "Basic {basic}"\n',f'\\"Authorization\\": \\"Basic {basic}\\"\n',
            f"Proxy-Authorization: Basic {basic}\n  {basic}\n",f"Bearer {bearer}\n",f'Bearer "{bearer}"\n',
            f"https://registry.invalid/?access_token={query}&api_key={query}\n",
            f"https://registry.invalid/?Access-Token={query}#id_token={query}\n"]
        for raw in cases:
            with self.subTest(raw=raw):
                result=m.safe_diagnostic((raw+"actual safe Docker error\n").encode())
                for secret in [basic,bearer,query]:self.assertNotIn(secret,result)
                self.assertIn("actual safe Docker error",result)

    def test_buildkit_markers_only_trust_executed_lines_before_large_error_frame(self):
        actual=(b"#7 [2/4] RUN printf '%s\\n' 'KOVA_OPERATOR_STAGE=build-temporary-clean'\n"
          b"#7 0.100 KOVA_OPERATOR_STAGE=ubuntu-release-read\n"
          b"#7 0.101 KOVA_OPERATOR_STAGE=ubuntu-release-guard\n"
          b"#7 0.102 KOVA_OPERATOR_STAGE=ubuntu-architecture-guard\n"
          b"#7 0.103 KOVA_OPERATOR_STAGE=not-an-allowed-stage\n")
        frame=b"Dockerfile:12\n--------------------\n"+b"".join(
            ("  42 | >>> printf '%s\\n' 'KOVA_OPERATOR_STAGE="+stage+"'; \\\n").encode()
            for stage in sorted(m.DOCKER_BUILD_STAGES))*8
        raw=actual+frame+b"#7 ERROR: process did not complete successfully: exit code: 1\n"
        observed=m.observed_docker_build_stages(raw)
        self.assertEqual(observed["observedStage"],"ubuntu-architecture-guard")
        self.assertEqual(observed["lastStage"],"ubuntu-architecture-guard")
        self.assertEqual(observed["observedStageCount"],3)
        self.assertIsNone(m.observed_docker_build_stages(frame)["observedStage"])
        self.assertIsNone(m.observed_docker_build_stages(
            b"#7 0.104 printf '%s\\n' 'KOVA_OPERATOR_STAGE=apt-cache-clean'\n"
            b"#7 0.105 + printf KOVA_OPERATOR_STAGE=apt-cache-clean\n")["observedStage"])
        b=m.SyntheticBuilder(self.env);b.set_build_stage("build")
        def command(argv,**kwargs):
            kwargs["stderr"].write(raw)
            return subprocess.CompletedProcess(argv,1)
        with patch.object(m.subprocess,"run",side_effect=command),self.assertRaises(m.SyntheticCommandFailure) as caught:
            b.command(["docker","build","--progress=plain","public-context"])
        details=caught.exception.details
        self.assertEqual(details["observedStage"],"ubuntu-architecture-guard")
        self.assertIn("#7 0.102 KOVA_OPERATOR_STAGE=ubuntu-architecture-guard",details["stderrTail"])
        self.assertEqual(details["stderrTailKind"],"buildkit-executed")
        self.assertNotIn("Dockerfile:",details["stderrTail"])
        self.assertLessEqual(len(details["stderrTail"])+len(details["stdoutTail"]),m.MAX_DIAGNOSTIC_BYTES)

    def test_executed_build_output_survives_large_frame_is_redacted_and_bounded(self):
        canary="SYNTHETIC_ENV_CANARY"
        raw=(b"#7 [2/4] RUN printf source-command-echo\n"
             b"#7 1.01 KOVA_OPERATOR_STAGE=pgdg-index-refresh\n"
             b"#7 1.02 E: Malformed entry (Component) in fixture.sources\n"
             b"#7 1.03 Authorization: Basic U1lOVEhFVElDX0NBTkFSWQ==\n"
             b"#7 1.04 https://fixture.invalid/?access_token=SYNTHETIC_QUERY_CANARY\n"
             b"#7 1.05 SYNTHETIC_ENV_CANARY\n" + b"Dockerfile frame source echo\n"*1000)
        tail=m.executed_buildkit_diagnostic(raw,(canary,))
        self.assertIn("Malformed entry (Component)",tail)
        self.assertNotIn("Dockerfile frame",tail);self.assertNotIn("source-command-echo",tail)
        for hidden in [canary,"U1lOVEhFVElDX0NBTkFSWQ==","SYNTHETIC_QUERY_CANARY"]:self.assertNotIn(hidden,tail)
        self.assertIn("[redacted]",tail)
        huge=b"".join(("#7 2.01 safe output line "+str(i)+"\n").encode() for i in range(1000))
        bounded=m.executed_buildkit_diagnostic(huge)
        self.assertLessEqual(len(bounded.encode("ascii")),m.MAX_DIAGNOSTIC_BYTES)
        self.assertIn("safe output line 999",bounded)
        self.assertIsNone(m.executed_buildkit_diagnostic(b"Dockerfile:12\n12 | RUN source echo\n"))
        b=m.SyntheticBuilder(self.env);b.set_build_stage("build");b._diagnostic_secrets=(canary,)
        def command(argv,**kwargs):
            kwargs["stderr"].write(raw)
            return subprocess.CompletedProcess(argv,1)
        with patch.object(m.subprocess,"run",side_effect=command),self.assertRaises(m.SyntheticCommandFailure) as caught:
            b.command(["docker","build","--progress=plain","public-context"])
        details=caught.exception.details
        self.assertIn("Malformed entry (Component)",details["stderrTail"])
        self.assertEqual(details["observedStage"],"pgdg-index-refresh")
        self.assertEqual(details["stderrTailKind"],"buildkit-executed")
        for hidden in [canary,"U1lOVEhFVElDX0NBTkFSWQ==","SYNTHETIC_QUERY_CANARY"]:self.assertNotIn(hidden,details["stderrTail"])
        self.assertLessEqual(len(details["stderrTail"])+len(details["stdoutTail"]),m.MAX_DIAGNOSTIC_BYTES)

    def test_buildkit_prefixed_folded_authorization_cannot_escape_redaction(self):
        for header in ["Authorization", "Proxy-Authorization"]:
            raw=("#7 1.00 "+header+": Basic\n#7 1.01    U1lOVEhFVElDX0NBTkFSWQ==\n"
                 "#7 1.02 E: safe next diagnostic\n").encode()
            for sanitize in [m.safe_diagnostic,m.executed_buildkit_diagnostic]:
                with self.subTest(header=header,sanitize=sanitize.__name__):
                    clean=sanitize(raw)
                    self.assertNotIn("U1lOVEhFVElDX0NBTkFSWQ==",clean)
                    self.assertIn("[redacted]",clean)
                    self.assertIn("E: safe next diagnostic",clean)

    def test_docker_stage_markers_precede_guards_and_do_not_change_original_commands(self):
        source=m.HERE.joinpath("recovery-operator-client.Dockerfile").read_text()
        stages=set(re.findall(r"KOVA_OPERATOR_STAGE=([a-z0-9-]+)",source))
        self.assertEqual(stages,m.DOCKER_BUILD_STAGES)
        body=source.split("RUN ",1)[1].split("\nCOPY ",1)[0]
        checked=subprocess.run(["bash","-n","-c",body.replace("\\\n"," ")],capture_output=True)
        self.assertEqual(checked.returncode,0,checked.stderr.decode())
        lines=body.splitlines()
        for i,line in enumerate(lines):
            stripped=line.strip()
            if stripped.startswith(("[[", "if [[", "if grep", "grep -q")):
                self.assertRegex(lines[i-1],r"printf '%s\\n' 'KOVA_OPERATOR_STAGE=[a-z0-9-]+';")
        for stage,predicate in [
            ("pgdg-key-count-guard",'assert sum(x[0]=="pub" for x in rows)==1'),
            ("pgdg-key-fingerprint-guard",'assert next(x[9] for x in rows if x[0]=="fpr")=="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"')]:
            self.assertIn('print("KOVA_OPERATOR_STAGE='+stage+'",flush=True);'+predicate,body)
        # This normalized public recipe hash pins EVERY original command, guard,
        # signing fingerprint and URL, excluding only the new fixed markers.
        stripped=[];inside_case=False
        for line in lines:
            command=line.rstrip().removesuffix(chr(92)).strip()
            if command=='case "$package" in':inside_case=True;continue
            if inside_case:
                if command=='esac;':inside_case=False;continue
                self.assertRegex(command,r"^(?:bash|ca-certificates|coreutils|curl|gnupg|nodejs|python3)\) printf '%s\\n' 'KOVA_OPERATOR_STAGE=[a-z0-9-]+';;$")
                continue
            if re.fullmatch(r"printf '%s\\n' 'KOVA_OPERATOR_STAGE=[a-z0-9-]+';",command):continue
            line=re.sub(r'print\("KOVA_OPERATOR_STAGE=[a-z0-9-]+",flush=True\);',"",line)
            line=line.replace("if grep -Eiq '^(Trusted|Allow-Insecure):[[:space:]]*yes' /etc/apt/sources.list.d/ubuntu.sources; then exit 1; fi;",
                              "! grep -Eiq '^(Trusted|Allow-Insecure):[[:space:]]*yes' /etc/apt/sources.list.d/ubuntu.sources;")
            line=line.replace("if [[ -e /etc/apt/sources.list || -L /etc/apt/sources.list ]]; then [[ -f /etc/apt/sources.list && ! -L /etc/apt/sources.list ]]; awk '/^[[:space:]]*($|#)/ {next} {exit 1}' /etc/apt/sources.list; fi;",
                              "[[ ! -s /etc/apt/sources.list ]];")
            line=line.replace("'Architectures: amd64' 'Components: main'", "'Architectures: amd64'")
            stripped.append(line)
        normalized=" ".join("\n".join(stripped).replace("\\\n"," ").split())
        self.assertEqual(hashlib.sha256(normalized.encode()).hexdigest(),
                         "d830f8159ff4b57a8ef9923c04f5bf6d0ab66b8c8bb8c9e551cb624a92dd1c8c")

    def test_pgdg_deb822_source_writer_has_required_main_component_and_parses_offline(self):
        source=m.HERE.joinpath("recovery-operator-client.Dockerfile").read_text()
        lines=source.splitlines()
        start=next(i for i,line in enumerate(lines) if "'KOVA_OPERATOR_STAGE=pgdg-source-write'" in line)+1
        end=next(i for i in range(start,len(lines)) if "'KOVA_OPERATOR_STAGE=pgdg-index-refresh'" in lines[i])
        fixture=self.root/"synthetic-pgdg.sources"
        command=" ".join(line.rstrip().removesuffix(chr(92)).strip() for line in lines[start:end]).replace("/etc/apt/sources.list.d/kova-pgdg.sources",'"$1"')
        result=subprocess.run(["bash","-o","pipefail","-ceu",command,"canary",str(fixture)],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        self.assertEqual(result.stdout,b"")
        expected={"Types":"deb","URIs":"https://apt.postgresql.org/pub/repos/apt","Suites":"noble-pgdg",
                  "Architectures":"amd64","Components":"main",
                  "Signed-By":"/usr/share/postgresql-common/pgdg/kova-pgdg.asc"}
        fields=dict(line.split(": ",1) for line in fixture.read_text().splitlines())
        self.assertEqual(fields,expected)
        # apt-cache policy only parses fixture metadata: no index update, network,
        # package installation or host APT source changes occur.
        apt=Path("/usr/bin/apt-cache")
        if not apt.exists():self.skipTest("offline APT parser unavailable")
        lists=self.root/"synthetic-lists";lists.mkdir()
        cache=self.root/"synthetic-cache";cache.mkdir()
        args=[str(apt),"-o","Dir::Etc::sourcelist="+str(fixture),"-o","Dir::Etc::sourceparts=-",
              "-o","Dir::State::lists="+str(lists),"-o","Dir::Cache="+str(cache),"policy"]
        self.assertEqual(subprocess.run(args,capture_output=True).returncode,0)
        fixture.write_text(fixture.read_text().replace("Components: main\n",""))
        self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0)

    def test_legacy_apt_sources_accepts_only_absent_empty_comments_or_blank_lines(self):
        source=m.HERE.joinpath("recovery-operator-client.Dockerfile").read_text()
        line=next(line for line in source.splitlines() if line.strip().startswith("if [[ -e /etc/apt/sources.list"))
        command=line.strip().removesuffix(chr(92)).strip().replace("/etc/apt/sources.list",'"$1"')
        fixture=self.root/"synthetic-legacy-sources.list"
        def execute():
            return subprocess.run(["bash","-o","pipefail","-ceu",command+" printf accepted", "canary",str(fixture)],capture_output=True)
        absent=execute()
        self.assertEqual(absent.returncode,0)
        self.assertEqual(absent.stdout,b"accepted")
        for value,rejected in [("",False),("\n \t\n",False),("# official source moved\n   # comment\n",False),
                               ("deb http://archive.ubuntu.com/ubuntu noble main\n",True),
                               ("\tdeb-src https://archive.ubuntu.com/ubuntu noble main\n",True),
                               (" # comment\nUNREVIEWED_ENTRY\n",True),("Types: deb\n",True)]:
            fixture.write_text(value)
            result=execute()
            with self.subTest(value=value):
                self.assertEqual(result.returncode!=0,rejected)
                self.assertEqual(result.stdout,b"" if rejected else b"accepted")
        fixture.unlink();fixture.mkdir()
        self.assertNotEqual(execute().returncode,0)
        fixture.rmdir();target=self.root/"synthetic-legacy-target";target.write_text("# harmless\n")
        fixture.symlink_to(target)
        self.assertNotEqual(execute().returncode,0)
        fixture.unlink();fixture.symlink_to(self.root/"synthetic-absent-target")
        self.assertNotEqual(execute().returncode,0)

    def test_unsigned_apt_source_guard_actually_aborts_under_errexit(self):
        source=m.HERE.joinpath("recovery-operator-client.Dockerfile").read_text()
        line=next(line for line in source.splitlines() if line.strip().startswith("if grep -Eiq"))
        self.assertIn("then exit 1; fi;",line)
        self.assertNotIn("    ! grep -Eiq",source)
        command=line.strip().removesuffix(chr(92)).strip().replace("/etc/apt/sources.list.d/ubuntu.sources",'"$1"')
        fixture=self.root/"synthetic-apt.sources"
        for value,rejected in [("Trusted: yes\n",True),("Allow-Insecure:\tyes\n",True),
                               ("trusted: YES\n",True),("Trusted: no\n",False),("Types: deb\n",False)]:
            fixture.write_text(value)
            result=subprocess.run(["bash","-o","pipefail","-ceu",command+" printf accepted", "canary",str(fixture)],capture_output=True)
            with self.subTest(value=value):
                self.assertEqual(result.returncode!=0,rejected)
                self.assertEqual(b"accepted" not in result.stdout,rejected)

    def test_every_build_phase_is_pinpointed_and_completed_build_exit_can_be_cleaned(self):
        for index,stage in enumerate(["git","pull","inspect","context","build","final-inspect"],2):
            env={**self.env,"GITHUB_RUN_ATTEMPT":str(index)};b=m.SyntheticBuilder(env)
            commands=[]
            def command(argv,**_kwargs):
                commands.append(argv)
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
            if stage=="final-inspect":self.assertTrue(any(a[:2]==["docker","build"] and "--progress=plain" in a for a in commands))
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

    def test_owned_volume_conversion_keeps_kernel_noswap_without_docker_tmpfs_parser(self):
        p=self.probe();calls=[];p.reserve_tmpfs_volume=lambda spec:calls.append(spec)
        args=p._container_args("client")
        converted=p.owned_tmpfs_run_args(args)
        self.assertNotIn("--tmpfs",converted)
        self.assertEqual({s["destination"] for s in calls},{"/tmp","/work"})
        self.assertTrue(all("noswap" in s["options"].split(",") for s in calls))
        mounts=[converted[i+1] for i,value in enumerate(converted) if value=="--mount"]
        self.assertEqual(sum(x.startswith("type=volume,") and x.endswith(",volume-nocopy") for x in mounts),2)
        self.assertEqual(sum(x.startswith("type=bind,") and x.endswith(",readonly") for x in mounts),1)
        self.assertNotIn("--privileged",converted);self.assertNotIn("docker.sock",str(converted))

    def test_tmpfs_specs_reject_missing_noswap_unbounded_or_host_mount_options(self):
        p=self.probe();good="/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m"
        for invalid in [good.replace(",noswap",""),good.replace(",size=128m",""),
          good.replace("128m","32769m"),good+",device=/etc",good.replace("0700","0777"),
          good.replace("/work:","/proc/data:"),good.replace("/work:","/../work:"),
          good+",size=128m",good.replace("128m","1g")]:
            with self.subTest(value=invalid),self.assertRaises(m.Stopped):p.tmpfs_spec(p.names["client"],invalid)
        with self.assertRaises(m.Stopped):p.tmpfs_spec("foreign-container",good)

    def volume_info(self,p,spec):
        labels={p.labels()[i+1].split("=",1)[0]:p.labels()[i+1].split("=",1)[1]
                for i,value in enumerate(p.labels()) if value=="--label"}
        labels.update({"kova.empty-probe.container":spec["containerKey"],
                       "kova.empty-probe.destination":o.digest(spec["destination"].encode())})
        return {"Name":spec["name"],"Driver":"local","Scope":"local","Labels":labels,
                "Options":{"type":"tmpfs","device":"tmpfs","o":spec["options"]},
                "Mountpoint":"/docker/volumes/"+spec["name"]+"/_data"}

    def test_volume_reservation_is_saved_before_uncertain_create_and_never_claims_cleanup(self):
        p=self.probe();spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        events=[];p.tmpfs_volume_absent=lambda name:True
        p.save_state=lambda:events.append(("saved",copy.deepcopy(p.tmpfs_volumes)))
        def docker(args,**_):
            events.append(("command",args));raise m.Stopped("native_command_unconfirmed")
        with patch.object(o.base.Probe,"docker",side_effect=docker),self.assertRaises(m.Stopped):p.reserve_tmpfs_volume(spec)
        self.assertEqual(events[0],("saved",{spec["name"]:spec}))
        create=events[1][1]
        self.assertEqual(create[:4],["volume","create","--driver","local"])
        self.assertIn("type=tmpfs",create);self.assertIn("device=tmpfs",create)
        self.assertIn("o="+spec["options"],create)
        self.assertEqual(p.tmpfs_volumes[spec["name"]],spec)

    def test_volume_identity_rejects_disk_driver_foreign_owner_and_option_drift(self):
        p=self.probe();spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        original=self.volume_info(p,spec)
        mutations=[lambda v:v.update(Driver="nfs"),lambda v:v.update(Name="other"),
          lambda v:v["Options"].update(device="/dev/sda"),lambda v:v["Options"].update(type="ext4"),
          lambda v:v["Options"].update(o=spec["options"].replace(",noswap","")),
          lambda v:v["Labels"].update({"kova.empty-probe.source":"f"*40}),
          lambda v:v["Labels"].update({"kova.empty-probe.destination":"0"*64}),
          lambda v:v.update(Mountpoint="/host/secret"),lambda v:v.update(Scope="global")]
        with patch.object(o.base.Probe,"docker",return_value=(0,json.dumps([original]).encode())):
            self.assertEqual(p.inspect_tmpfs_volume(spec),original["Mountpoint"])
        for mutation in mutations:
            value=copy.deepcopy(original);mutation(value)
            with self.subTest(case=mutations.index(mutation)), \
                 patch.object(o.base.Probe,"docker",return_value=(0,json.dumps([value]).encode())),self.assertRaises(m.Stopped):
                p.inspect_tmpfs_volume(spec)

    def test_volume_absence_requires_complete_successful_daemon_census(self):
        p=self.probe()
        with patch.object(o.base.Probe,"docker",side_effect=m.Stopped("native_command_unconfirmed")),self.assertRaises(m.Stopped):
            p.tmpfs_volume_absent("owned")
        with patch.object(o.base.Probe,"docker",return_value=(1,b"")),self.assertRaises(m.Stopped):
            p.tmpfs_volume_absent("owned")
        with patch.object(o.base.Probe,"docker",return_value=(0,b'{"Name":"owned"}\n')):
            self.assertFalse(p.tmpfs_volume_absent("owned"));self.assertTrue(p.tmpfs_volume_absent("absent"))

    def test_cleanup_refuses_foreign_or_attached_volumes_and_never_uses_force_or_prune(self):
        p=self.probe();spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        p.tmpfs_volumes={spec["name"]:spec};calls=[]
        p.tmpfs_volume_absent=lambda name:False
        p.inspect_tmpfs_volume=lambda spec:None
        with patch.object(o.base.Probe,"docker",side_effect=lambda args,**_:calls.append(args) or (_ for _ in ()).throw(m.Stopped("in_use"))):
            self.assertFalse(p.cleanup_tmpfs_volumes(True))
        self.assertEqual(calls,[["volume","rm",spec["name"]]])
        calls.clear();self.assertFalse(p.cleanup_tmpfs_volumes(False));self.assertFalse(calls)
        def foreign(spec):raise m.Stopped("operator_tmpfs_identity_unqualified")
        p.inspect_tmpfs_volume=foreign
        with patch.object(o.base.Probe,"docker",side_effect=lambda args,**_:calls.append(args)):
            self.assertFalse(p.cleanup_tmpfs_volumes(True))
        self.assertFalse(calls)

    def test_cleanup_requires_positive_post_removal_absence(self):
        p=self.probe();spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        p.tmpfs_volumes={spec["name"]:spec};p.inspect_tmpfs_volume=lambda spec:None
        with patch.object(o.base.Probe,"docker",return_value=(0,b"")):
            p.tmpfs_volume_absent=lambda name:False
            self.assertFalse(p.cleanup_tmpfs_volumes(True))
            values=iter([False,True]);p.tmpfs_volume_absent=lambda name:next(values)
            self.assertTrue(p.cleanup_tmpfs_volumes(True))

    def test_volume_failure_preserves_private_backing_files_and_is_recorded_in_crash_state(self):
        p=self.probe();p.private_root=self.root/"private";p.private_root.mkdir()
        spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        p.tmpfs_volumes={spec["name"]:spec};p.cleanup_tmpfs_volumes=lambda gone:False
        self.assertFalse(p.cleanup());self.assertTrue(p.private_root.exists())
        self.assertEqual(json.loads(p.state_path.read_bytes())["tmpfsVolumes"],p.tmpfs_volumes)

    def test_crash_state_rejects_another_attempt_or_arbitrary_volume(self):
        p=self.probe();p.uid=os.getuid();spec=p.tmpfs_spec(p.names["client"],"/work:rw,nosuid,nodev,noexec,noswap,mode=0700,size=128m")
        p.tmpfs_volumes={spec["name"]:spec};p.save_state()
        state=json.loads(p.state_path.read_bytes());bad=copy.deepcopy(spec);bad["name"]="foreign-data"
        state["tmpfsVolumes"]={"foreign-data":bad};p.state_path.write_bytes(o.encoded(state));p.state_path.chmod(0o600)
        with self.assertRaisesRegex(m.Stopped,"operator_tmpfs_state_unqualified"):
            o.cleanup_operator_state(self.env,context_validator=m.synthetic_context)

    def test_actual_kernel_runtime_check_requires_noswap_every_mount_and_bounded_memory(self):
        p=self.probe();calls=[];p.docker=lambda args,**_:(calls.append(args) or (0,b""))
        p.assert_runtime_policy("client");args=calls[0];script=args[args.index("-ceu")+1]
        paths={"/proc/self/status":self.root/"status","/proc/mounts":self.root/"mounts",
               "/sys/fs/cgroup/memory.swap.max":self.root/"swap","/sys/fs/cgroup/memory.max":self.root/"memory"}
        for src,dst in paths.items():script=script.replace(src,str(dst))
        script="id() { printf '1001\\n'; };\n"+script
        paths["/proc/self/status"].write_text("CapEff:\t0000000000000000\nNoNewPrivs:\t1\n")
        paths["/sys/fs/cgroup/memory.swap.max"].write_text("0\n")
        paths["/sys/fs/cgroup/memory.max"].write_text(str(768*1024**2)+"\n")
        good="overlay / overlay ro 0 0\ntmpfs /tmp tmpfs rw,nosuid,nodev,noexec,noswap,size=131072k 0 0\ntmpfs /work tmpfs rw,nosuid,nodev,noexec,noswap,size=131072k 0 0\n"
        command=["bash","-ceu",script,"--",*args[args.index("--")+1:]]
        paths["/proc/mounts"].write_text(good)
        self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
        for bad in [good.replace(",noswap",""),good.replace("size=131072k","size=131073k"),
                    good.replace("overlay ro","overlay rw"),good+good.splitlines()[-1]+"\n"]:
            paths["/proc/mounts"].write_text(bad)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
        paths["/proc/mounts"].write_text(good);paths["/sys/fs/cgroup/memory.swap.max"].write_text("1\n")
        self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)

    def test_timeout_control_proves_actual_host_implementation_without_version_flag(self):
        p=self.probe();timeout=shutil.which("timeout");sha=shutil.which("sha256sum")
        self.assertIsNotNone(timeout);self.assertIsNotNone(sha)
        def command(args,**kwargs):
            value=subprocess.run(args[2:],capture_output=True,timeout=kwargs.get("timeout",5))
            return value.returncode,value.stdout
        p.docker=command
        status=p.timeout_control("a",{"timeout":timeout,"sha256sum":sha})
        self.assertIn(status,{124,143});self.assertIn("a",p.timeout_pins)
        self.assertTrue(p.network_evidence[-1]["positiveControlPassed"])
        self.assertTrue(p.network_evidence[-1]["expiryControlPassed"])

    def test_timeout_expiry_must_be_measured_and_preserve_fast_positive_control(self):
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        for status,output,elapsed,positive in [(143,b"timeout-control-started\n",0.1,True),
          (127,b"timeout-control-started\n",1,True),(124,b"unexpected\n",1,True),
          (124,b"timeout-control-started\n",1,False)]:
            p=self.probe()
            def command(args,**_):
                if "/native/sha" in args:return 0,b"a"*64+b"  /native/timeout\n"
                if "printf 'timeout-control-positive\\n'" in args:return (0,b"timeout-control-positive\n") if positive else (1,b"")
                return status,output
            p.docker=command
            with self.subTest(status=status,elapsed=elapsed,positive=positive), \
                 patch.object(o.time,"monotonic",side_effect=[0,elapsed]),self.assertRaises(m.Stopped):
                p.timeout_control("a",tools)

    def test_timeout_client_pin_and_changed_server_binary_are_rejected(self):
        p=self.probe();p.operator_smoke={"tools":[{"name":"timeout","sha256":"a"*64}]}
        p.docker=lambda args,**_:(0,b"b"*64+b"  /native/timeout\n")
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        with self.assertRaisesRegex(m.Stopped,"timeout_control_identity_unconfirmed"):p.timeout_control("client",tools)
        p.timeout_pins["a"]="a"*64
        with self.assertRaisesRegex(m.Stopped,"timeout_control_identity_unconfirmed"):p.timeout_control("a",tools)

    def test_route_timeout_status_is_accepted_only_for_measured_proven_implementation(self):
        tools={"timeout":"/native/timeout"}
        for code,out,elapsed,expected,accept in [(143,b"",3,143,True),(124,b"",3,124,True),
          (143,b"",0.1,143,False),(143,b"",3,124,False),(0,b"",0.1,124,False),
          (127,b"",3,124,False),(124,b"data",3,124,False)]:
            p=self.probe();p.docker=lambda args,**_:(code,out)
            with self.subTest(code=code,elapsed=elapsed,expected=expected),patch.object(o.time,"monotonic",side_effect=[0,elapsed]):
                if accept:self.assertEqual(p.timed_denial_command("a",tools,"network-control",expected),code)
                else:
                    with self.assertRaises(m.Stopped):p.timed_denial_command("a",tools,"network-control",expected)


if __name__=="__main__":unittest.main()
