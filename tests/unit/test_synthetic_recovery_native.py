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
from types import SimpleNamespace
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

fixture_spec=importlib.util.spec_from_file_location("synthetic_owned_fixture",Path(__file__).with_name("test_owned_noswap_volumes.py"))
fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)


runtime_bytes=fixture.runtime_bytes


class SyntheticTests(unittest.TestCase):
    def test_native_blank_failure_keeps_only_fixed_catalog_counts(self):
        error=m.Stopped("native_blank_census_unqualified")
        value=m.base.native_blank_observations({"serverVersionNum":170006,
            "counts":{"unownedNamespaceObjects":0},"namespaceObjects":[],"tables":[]},
            {"largeObjects":[]},{"plpgsql"},[])
        error.native_blank_observations=value;error.raw_catalog="PRIVATE_CATALOG_CANARY"
        result=m.failure_details(error,"native_catalog_proof")
        self.assertEqual(result["blankCatalog"],value)
        self.assertNotIn("PRIVATE_",json.dumps(result))

    def test_catalog_comparison_failure_uses_fixed_native_stage_without_raw_catalog_values(self):
        actual=m.failure_details(m.Stopped("synthetic_image_baselines_differ"),"native_catalog_proof")
        self.assertEqual(actual,{"code":"synthetic_image_baselines_differ","stage":"native_catalog_proof"})
        actual=m.failure_details(m.Stopped("synthetic_image_baselines_differ PRIVATE_CATALOG_CANARY"),"PRIVATE_STAGE_CANARY")
        self.assertEqual(actual,{"code":"synthetic_native_unconfirmed","stage":"setup"})

    def test_numeric_denial_diagnostic_uses_existing_exact_stopped_type_and_fixed_code_only(self):
        error=o.base.Stopped("numeric_denial_cause_unconfirmed")
        self.assertIs(type(error),m.Stopped)
        self.assertIs(o.Stopped,m.base.Stopped)
        self.assertEqual(m.failure_details(error),{"code":"numeric_denial_cause_unconfirmed","stage":"setup"})
        for error in [ValueError("numeric_denial_cause_unconfirmed"),
                      RuntimeError("numeric_denial_cause_unconfirmed"),
                      m.Stopped("SYNTHETIC_PRIVATE_ROUTE_CANARY"),
                      m.Stopped("numeric_denial_cause_unconfirmed SYNTHETIC_PRIVATE_ROUTE_CANARY")]:
            actual=m.failure_details(error)
            self.assertEqual(actual["code"],"synthetic_native_unconfirmed")
            self.assertNotIn("PRIVATE_ROUTE_CANARY",json.dumps(actual))

    def test_mount_policy_output_accepts_only_exact_typed_boolean_diagnostics(self):
        observed={"filesystemTmpfs":True,"sourceTmpfs":True,"filesystemRoot":True,"readWrite":True,
            "nosuid":True,"nodev":True,"noexec":True,"readOnlyAbsent":True,"noswap":False,
            "optionalFieldsEmpty":True,"sharedPropagation":False,"masterPropagation":False,
            "propagateFrom":False,"unbindable":False,"unknownOptionalField":False}
        for module in [o.volume_proof,m.builder.volume_proof]:
            error=module.Stopped("volume_runtime_mount_policy_unqualified")
            error.mount_policy_observations=observed;error.raw_mountinfo="/PRIVATE_RAW_MOUNT_CANARY"
            error.details={"volume":"PRIVATE_VOLUME_CANARY"}
            result=m.failure_details(error)
            self.assertEqual(result,{"code":"volume_runtime_mount_policy_unqualified","stage":"setup",
                                     "mountPolicy":observed})
            self.assertNotIn("PRIVATE_",json.dumps(result))
            for value in [{**observed,"PRIVATE_FIELD_CANARY":True},
                    {key:item for key,item in observed.items() if key!="noswap"},
                    {**observed,"noswap":1},{**observed,"noswap":"PRIVATE_VALUE_CANARY"},[],None]:
                error.mount_policy_observations=value
                with self.subTest(module=module.__name__,value=value):
                    result=m.failure_details(error)
                    self.assertNotIn("mountPolicy",result);self.assertNotIn("PRIVATE_",json.dumps(result))
            for foreign in [module.Stopped("volume_runtime_capacity_mismatch"),
                    m.Stopped("volume_runtime_mount_policy_unqualified"),
                    ValueError("volume_runtime_mount_policy_unqualified")]:
                foreign.mount_policy_observations=observed
                self.assertNotIn("mountPolicy",m.failure_details(foreign))
        class ForeignPropertyError(Exception):
            @property
            def mount_policy_observations(self):raise AssertionError("PRIVATE_PROPERTY_CANARY")
        self.assertEqual(m.failure_details(ForeignPropertyError("PRIVATE_EXCEPTION_CANARY")),
                         {"code":"synthetic_native_unconfirmed","stage":"setup"})

    def test_mount_policy_primary_and_fixed_storage_failures_preserve_quarantine(self):
        expected_codes={"owned_volume_creation_outcome_unknown","owned_volume_activated_runtime_unconfirmed",
            "owned_volume_census_unqualified","owned_volume_configuration_changed","owned_volume_inspect_unqualified",
            "owned_volume_container_references_present","owned_volume_removal_unconfirmed",
            "owned_volume_command_unconfirmed","owned_volume_command_output_unqualified"}
        self.assertEqual(o.CLEANUP_STORAGE_CODES,expected_codes)
        spec={"name":"PRIVATE_VOLUME_CANARY","destination":"/PRIVATE_DESTINATION_CANARY",
            "mountpoint":"/PRIVATE_HOST_CANARY","driver":"local","device":"tmpfs",
            "size_mib":128,"nr_inodes":131072,"uid":1001,"gid":1001,"mode":"0700"}
        with self.assertRaises(o.volume_proof.Stopped) as caught:
            o.volume_proof.validate_runtime_proof(runtime_bytes([spec]).replace(b"rw,noswap",b"rw"),[spec])
        primary=caught.exception
        class DerivedStopped(o.ram.Stopped):pass
        cases=[(o.ram.Stopped(code),code) for code in sorted(expected_codes)]+[
            (o.ram.Stopped("PRIVATE_CLEANUP_CANARY"),"owned_storage_cleanup_unconfirmed"),
            (ValueError("owned_volume_activated_runtime_unconfirmed"),"owned_storage_cleanup_unconfirmed"),
            (DerivedStopped("owned_volume_activated_runtime_unconfirmed"),"owned_storage_cleanup_unconfirmed"),
            (o.ram.Stopped("owned_volume_activated_runtime_unconfirmed","PRIVATE_EXTRA_ARG_CANARY"),
             "owned_storage_cleanup_unconfirmed")]
        for error,expected in cases:
            p=self.probe();p.save_state=lambda:None
            p.ram_volumes=SimpleNamespace(owner=p.token,cleanup=unittest.mock.Mock(side_effect=error))
            def fail():p.stage="native_tools";raise primary
            p.initialize=fail;p.cleanup=p.cleanup_storage
            with self.subTest(error=type(error).__name__,expected=expected):
                result=p.execute_synthetic()
                self.assertEqual(result["errorCode"],"volume_runtime_mount_policy_unqualified")
                self.assertFalse(result["primaryFailure"]["mountPolicy"]["noswap"])
                self.assertEqual(result["cleanupFailure"]["native"]["storageCode"],expected)
                for field in ["syntheticNativeProofComplete","nativeResourcesCleanupConfirmed","sourceProof",
                        "sourceMetadataCompatible","independentlyReviewed","restoreQualified","restorePerformed"]:
                    self.assertIs(result[field],False,field)
                self.assertNotIn("PRIVATE_",json.dumps(result))
                p.ram_volumes.cleanup.assert_called_once_with()

    def test_cleanup_backstop_reports_only_fixed_storage_code_and_keeps_image_quarantined(self):
        for code,expected in [("owned_volume_activated_runtime_unconfirmed","owned_volume_activated_runtime_unconfirmed"),
                ("owned_storage_cleanup_unconfirmed","owned_storage_cleanup_unconfirmed"),
                ("PRIVATE_BACKSTOP_CANARY",None),(["PRIVATE_BACKSTOP_CANARY"],None)]:
            p=self.probe();p.uid=os.getuid();p.gid=os.getgid();p.save_state();details={}
            def cleanup(instance):instance.storage_cleanup_code=code;return False
            with self.subTest(code=code),patch.object(o.OperatorProbe,"cleanup",cleanup), \
                 patch.object(m,"cleanup_image_from_state") as image:
                self.assertEqual(m.cleanup_all(self.env,details=details),(False,False))
                image.assert_not_called()
            self.assertEqual(details["native"].get("storageCode"),expected)
            self.assertNotIn("PRIVATE_",json.dumps(details));p.state_path.unlink()

    def test_new_runtime_and_volume_failures_emit_only_literal_safe_codes(self):
        for error_type in m.RAM_STOPPED_TYPES:
            known=error_type("volume_runtime_mount_policy_unqualified")
            self.assertEqual(m.failure_details(known)["code"],"volume_runtime_mount_policy_unqualified")
            self.assertEqual(m.safe_exception_type(known),"Stopped")
            private=error_type("SYNTHETIC_PRIVATE_ROW_SECRET_CANARY")
            result=m.failure_details(private)
            self.assertEqual(result["code"],"synthetic_native_unconfirmed")
            self.assertNotIn("PRIVATE_ROW_SECRET",json.dumps(result))
        self.assertEqual(m.failure_details(ValueError("volume_runtime_mount_policy_unqualified"))["code"],
                         "synthetic_native_unconfirmed")

    def test_server_failure_codes_and_command_stages_are_fixed_to_exact_hub_digest(self):
        server=m.base.server_image
        for code in server.PUBLIC_FAILURE_CODES:
            self.assertEqual(m.failure_details(server.Stopped(code))["code"],code)
            self.assertEqual(m.safe_exception_type(server.Stopped(code)),"Stopped")
        for error in [server.Stopped("SYNTHETIC_PRIVATE_REGISTRY_CANARY"),
                      ValueError("server_image_manifest_digest_mismatch")]:
            result=m.failure_details(error)
            self.assertEqual(result["code"],"synthetic_native_unconfirmed")
            self.assertNotIn("PRIVATE_REGISTRY",json.dumps(result))
        commands=[(["docker","buildx","version"],"server-buildx-version"),
                  (["docker","buildx","imagetools","inspect","--raw",server.TRANSPORT_REF],"server-raw-manifest"),
                  (["docker","buildx","imagetools","inspect","--format","{{json .Image}}",server.TRANSPORT_REF],"server-semantic-config"),
                  (["docker","image","inspect",server.TRANSPORT_REF],"server-loaded-image"),
                  (["docker","pull","--platform","linux/amd64",server.TRANSPORT_REF],"pinned-server-pull")]
        for command,stage in commands:
            self.assertEqual(m.native_command_stage(command),stage)
            if server.TRANSPORT_REF in command:
                altered=[server.ORIGINAL_ECR_REF if value==server.TRANSPORT_REF else value for value in command]
                self.assertEqual(m.native_command_stage(altered),"native-other")

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
        p.server_image_qualification={"syntheticFixture":True,"operation":"verified-official-server-image-transport",
            "imageId":p.server_image_id,"actualRepoDigest":m.base.server_image.TRANSPORT_REF,
            "transportReference":m.base.server_image.TRANSPORT_REF,
            "originalEcrReference":m.base.server_image.ORIGINAL_ECR_REF}
        fake=fixture.FakeDocker();fake.manager=p.owned_ram;p.test_ram_docker=fake
        original_run=p.run
        def run(argv,**kwargs):
            if argv[:2] in [["docker","volume"],["docker","ps"]]:return 0,fake(argv,timeout=kwargs.get("timeout",90))
            return original_run(argv,**kwargs)
        p.run=run
        return p

    def info(self,p,key):
        client=key=="client";env={**(p.operator_env if client else p.image_env),"HOME":"/tmp","TZ":"UTC"}
        env["TMPDIR" if client else "PGDATA"]="/work" if client else "/run/server/data"
        memory=(p.resources["clientMemoryMiB"] if client else p.resources["serverMemoryMiB"][key])*1024**2
        p._container_args(key)
        volumes=[{"Type":"volume","Name":spec["name"],"Source":spec["mountpoint"],"Driver":"local",
                  "Destination":spec["destination"],"RW":True,"Propagation":""}
                 for spec in p.owned_ram().expected_mounts(p.ram_keys[key])]
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
            "Destination":"/run/client" if client else "/run/server","RW":False},*volumes]}

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
            binds=[value for value in mounts if value.startswith("type=bind,")]
            self.assertEqual(len(binds),1);self.assertTrue(binds[0].endswith(",readonly"))
            self.assertNotIn("--tmpfs",args)
            temporary=p.owned_ram().expected_mounts(p.ram_keys[key])
            self.assertTrue(all(",noswap," in x["options"]["o"] and ",noexec," in x["options"]["o"] for x in temporary))
            self.assertEqual({x["destination"] for x in temporary},{"/tmp","/work" if key=="client" else "/run/server/data"})
            self.assertTrue(all(value.endswith(",volume-nocopy") for value in mounts if value.startswith("type=volume,")))
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
        p=self.probe();calls=[]
        for key in ["a","client"]:
            p._container_args(key);p.owned_ram().record_activation(p.ram_keys[key])
        def docker(args,**kwargs):
            calls.append(args)
            key=next(key for key in ["a","client"] if p.names[key] in args)
            return 0,runtime_bytes(p.owned_ram().expected_mounts(p.ram_keys[key]))
        p.docker=docker
        for key in ["a","client"]:self.assertTrue(p.assert_runtime_policy(key)["tmpfsNoSwapObserved"])
        for args in calls:
            script=args[args.index("-ceu")+1]
            check=subprocess.run(["bash","-n","-c",script],capture_output=True)
            self.assertEqual(check.returncode,0,check.stderr.decode())
            for required in ["/proc/self/status","NoNewPrivs","CapEff","memory.swap.max","/proc/self/mountinfo"]:
                self.assertIn(required,script)
        p.docker=lambda args,**kwargs:(0,runtime_bytes(p.owned_ram().expected_mounts(p.ram_keys["a"])).replace(b"rw,noswap",b"rw"))
        with self.assertRaises(o.volume_proof.Stopped):p.assert_runtime_policy("a")

    def test_every_exact_declared_server_image_volume_is_masked_by_owned_ram(self):
        p=self.probe();p.image_volumes=["/var/lib/postgresql/data","/var/log/postgresql"]
        args=p._container_args("a")
        specs=p.owned_ram().expected_mounts(p.ram_keys["a"])
        self.assertEqual({spec["destination"] for spec in specs},
                         {"/tmp","/run/server/data",*p.image_volumes})
        self.assertEqual(len({spec["name"] for spec in specs}),4)
        self.assertNotIn("--tmpfs",args)
        self.assertTrue(all(spec["options"]["type"]==spec["options"]["device"]=="tmpfs" for spec in specs))
        self.assertTrue(all(spec["mode"]=="0700" for spec in specs if spec["destination"]!="/tmp"))
        actual=self.info(p,"a")
        p.verify_container("a",actual)
        actual["Mounts"].append({"Type":"volume","Name":"anonymous","Destination":"/extra","RW":True})
        with self.assertRaises(m.Stopped):p.verify_container("a",actual)

    def short_probe(self,payload=None):
        p=self.probe();p.save_state=lambda:None;p.reserve_absent=lambda name:p.containers_reserved.append(name)
        p.resource_absent=lambda *args,**kwargs:True
        original_run=p.run;launches=[]
        def run(argv,**kwargs):
            if argv[:2]==["docker","run"]:
                specs=[spec for spec in p.owned_ram().specs.values() if any("src="+spec["name"]+"," in arg for arg in argv)]
                self.assertTrue(all(spec["activated"] for spec in specs))
                launches.append(argv)
                raw=b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n"+runtime_bytes(specs)+b"KOVA_PRIVATE_RAM_PROOF_END\nsynthetic stdout\n"
                return 0,raw if payload is None else payload
            return original_run(argv,**kwargs)
        p.run=run
        return p,launches

    def test_short_tools_have_distinct_volume_keys_and_prove_kernel_before_returning_stdout(self):
        p,launches=self.short_probe()
        for _ in range(2):
            code,raw=p.docker(["run","--rm","--network","none","--cap-drop","ALL","--security-opt",
                "no-new-privileges:true","--read-only","--entrypoint","/bin/bash",o.IMAGE,"-ceu",":"])
            self.assertEqual(code,0);self.assertEqual(raw,b"synthetic stdout\n")
        self.assertEqual(set(p.owned_ram().specs),{"toolcheck0-tmp","toolcheck1-tmp"})
        self.assertEqual(len({spec["name"] for spec in p.owned_ram().specs.values()}),2)
        self.assertEqual(len(p.owned_ram().runtime_records),2)
        for args in launches:
            self.assertEqual(args[args.index("--entrypoint")+1],"/bin/bash")
            self.assertIn("--log-driver",args);self.assertEqual(args[args.index("--log-driver")+1],"none")
            self.assertNotIn("--privileged",args);self.assertNotIn("--tmpfs",args)
            self.assertIn("exec \"$@\"",args[args.index("-ceu")+1])

    def test_operator_smoke_initializer_uses_matching_owned_key_and_proven_default_entrypoint(self):
        p=self.probe();p.save_state=lambda:None;p.reserve_absent=lambda name:p.containers_reserved.append(name)
        p.resource_absent=lambda *args,**kwargs:True;p.native_tools={"sha256sum":"/server/sha256sum"}
        prepared_spec=importlib.util.spec_from_file_location("operator_smoke_fixture",Path(__file__).with_name("test_prepare_recovery_operator_image.py"))
        prepared=importlib.util.module_from_spec(prepared_spec);prepared_spec.loader.exec_module(prepared)
        expected_smoke=prepared.smoke();native=p.run;launches=[]
        def run(argv,**kwargs):
            if argv[:3]==["docker","image","inspect"]:
                client=argv[-1]==p.operator_image_id
                return 0,json.dumps([{"Id":p.operator_image_id if client else p.server_image_id,
                    "Architecture":"amd64","Os":"linux","Config":{"Env":["PATH=/usr/bin"],
                    "Healthcheck":{"Test":["NONE"]},"Labels":{"org.opencontainers.image.revision":p.source}}}]).encode()
            if argv[:2]==["docker","run"]:
                specs=[spec for spec in p.owned_ram().specs.values() if any("src="+spec["name"]+"," in arg for arg in argv)]
                self.assertTrue(all(spec["activated"] for spec in specs));launches.append(argv)
                stdout=json.dumps(expected_smoke).encode() if p.operator_image_id in argv else b"f"*64+b"  /bin/bash\n"
                return 0,b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n"+runtime_bytes(specs)+b"KOVA_PRIVATE_RAM_PROOF_END\n"+stdout
            return native(argv,**kwargs)
        p.run=run
        with patch.object(o.base.Probe,"initialize",return_value=None), \
             patch.object(o.os,"sysconf",side_effect=lambda key:2**21 if key=="SC_PHYS_PAGES" else 4096):
            p.initialize()
        self.assertEqual(set(p.owned_ram().specs),{"toolcheck0-tmp","smoke-tmp"})
        self.assertEqual(p.operator_smoke,expected_smoke)
        self.assertEqual(len(p.owned_ram().runtime_records),2)
        self.assertIn("/opt/kova/scripts/release/recovery-operator-client-smoke.py",launches[-1])
        self.assertEqual(p.bash_pins["a"],"f"*64)

    def test_unframed_short_run_output_quarantines_activation_and_cannot_claim_cleanup(self):
        for raw in [b"ordinary stdout",b"KOVA_PRIVATE_RAM_PROOF_BEGIN\nmissing end",
                    b"KOVA_PRIVATE_RAM_PROOF_BEGIN\nKOVA_PRIVATE_RAM_PROOF_END\nKOVA_PRIVATE_RAM_PROOF_END\n"]:
            p,_=self.short_probe(raw)
            with self.subTest(raw=raw),self.assertRaises(m.Stopped):
                p.docker(["run","--rm","--network","none","--entrypoint","/bin/bash",o.IMAGE,"-ceu",":"])
            self.assertTrue(all(spec["activated"] for spec in p.owned_ram().specs.values()))
            self.assertEqual(p.owned_ram().runtime_records,[])
            self.assertFalse(p.cleanup_storage())

    def test_owned_storage_failure_retains_firewall_and_private_inputs(self):
        for reason in ["activation-without-proof","foreign-volume","live-volume-reference"]:
            p=self.probe();p.save_state=lambda:None;p._container_args("client")
            manager=p.owned_ram();spec=manager.expected_mounts(p.ram_keys["client"])[-1]
            if reason=="activation-without-proof":manager.record_activation(p.ram_keys["client"])
            if reason=="foreign-volume":p.test_ram_docker.volumes[spec["name"]]["Labels"]={}
            if reason=="live-volume-reference":p.test_ram_docker.references=b'{"Names":"synthetic-active-container"}\n'
            p.firewall_reserved=["iptables"];p.private_root=Path(tempfile.mkdtemp(prefix="kova-empty-123-1-",dir=self.root))
            sentinel=p.private_root/"synthetic-input";sentinel.write_text("synthetic retained input")
            native=p.run;calls=[]
            def run(args,**kwargs):
                calls.append(args)
                self.assertFalse(args[:1]==["sudo"],"firewalls/private inputs must remain until storage reconciled")
                return native(args,**kwargs)
            p.run=run
            with self.subTest(reason=reason):
                self.assertFalse(p.cleanup())
                self.assertTrue(p.private_root.is_dir());self.assertEqual(sentinel.read_text(),"synthetic retained input")
                self.assertFalse(any(args[:1]==["sudo"] for args in calls))

    def test_server_startup_keeps_logging_collector_off_and_logs_in_tmpfs(self):
        p=self.probe();calls=[]
        p.reserve_absent=lambda *_:None;p.save_state=lambda:None
        p.docker=lambda args,**_:(calls.append(args) or (0,b""));p.inspect=lambda *_:self.info(p,"a")
        p.namespace_firewall=lambda *_:None;p.assert_runtime_policy=lambda *_:None
        volume_run=p.run
        p.run=lambda args,**kwargs:volume_run(args,**kwargs) if args[:2] in [["docker","volume"],["docker","ps"]] else (0,b"")
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

    def test_executed_operator_uses_shared_snapshot_guards_and_its_own_dump_tool(self):
        self.assertIs(o.OperatorProbe.native_snapshot,m.base.Probe.native_snapshot)
        self.assertIs(m.SyntheticProbe.native_snapshot,m.base.Probe.native_snapshot)
        p=self.probe();p.client_tools={"pg_dump":"/operator/pg_dump"};p.native_tools={"pg_dump":"/server/pg_dump"}
        self.assertEqual(p.native_schema_dump_tool(),"/operator/pg_dump")
        self.assertEqual(m.base.Probe.native_schema_dump_tool(p),"/server/pg_dump")
        p.metadata={"extensions":[{"name":"plpgsql"}]}
        catalog={"largeObjects":[]}
        census={"serverVersionNum":170006,"counts":{"unownedNamespaceObjects":0},
                "namespaceObjects":[],"tables":[{"schema":"public","name":"unrelated",
                    "kind":"r","directExtension":None,"internalExtension":None}]}
        p.client_sql=lambda _target,sql,**_:(0,json.dumps(catalog if m.base.recovery.CATALOG_SQL in sql else census).encode())
        with patch.object(p,"docker") as docker:
            with self.assertRaisesRegex(m.Stopped,"native_blank_census_unqualified") as caught:
                p.native_snapshot("a")
        docker.assert_not_called()
        self.assertEqual(m.base.safe_native_blank_observations(caught.exception)["ordinaryTableCount"],1)

    def test_separate_server_client_bash_hashes_and_native_paths_are_verified(self):
        p=self.probe();p.native_tools={"timeout":"/server/timeout","sha256sum":"/server/sha"}
        p.client_tools={"timeout":"/operator/timeout","sha256sum":"/operator/sha"}
        p.bash_pins={"a":"a"*64,"b":"a"*64,"client":"b"*64};calls=[]
        p.timeout_control=lambda key,tools:124
        def docker(args,**_):
            calls.append(args)
            key=next(k for k in ["a","b","client"] if p.names[k] in args)
            if args[-1:]==["/bin/bash"] and any(x.endswith("/sha") for x in args):return 0,(p.bash_pins[key]+"  /bin/bash\n").encode()
            if "/dev/udp/" in args[-1]:p.last_stderr=b"KOVA_DNS_SOCKET_READY\nKOVA_DNS_RECEIVE_READY\n"
            if "3" in args:return 124,b""
            return 0,b""
        p.docker=docker
        with patch.object(m.base.time,"monotonic",side_effect=[x for _ in range(40) for x in (0,3)]):
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
        self.assertEqual(result["serverImageTransport"],p.server_image_qualification)
        self.assertEqual(result["serverImageTransport"]["actualRepoDigest"],m.base.server_image.TRANSPORT_REF)
        self.assertNotEqual(result["serverImageTransport"]["actualRepoDigest"],m.base.server_image.ORIGINAL_ECR_REF)
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
            def qualify(callback):
                # Exercise the actual native callback and exact transport command;
                # cryptographic helper behavior has its own dedicated suite.
                callback(["docker","pull","--platform","linux/amd64",m.base.server_image.TRANSPORT_REF],timeout=300)
                raise AssertionError("synthetic fixture must fail at its selected native boundary")
            with self.subTest(failed=failed),patch.object(m.os,"getuid",return_value=1001), \
                 patch.object(m.subprocess,"run",side_effect=command),\
                 patch.object(m.base.server_image,"qualify",side_effect=qualify) as qualification:
                result=p.execute_synthetic()
            self.assertEqual(qualification.call_count,int(failed=="pinned-server-pull"))
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
        self.assertEqual(m.FIXTURE_EXTENSIONS,("pg_cron","pg_net","pgcrypto","vector"))
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

    def test_rehydrated_cleanup_preserves_source_and_rejects_foreign_image_before_remove(self):
        b=m.SyntheticBuilder(self.env)
        b.build_invoked=True;b.build_returned=True;b.write_state("123","1")
        for source in [b.source,"f"*40]:
            calls=[];listed={"Repository":"kova-recovery-operator","Tag":b.owner}
            def command(instance,args,**kwargs):
                calls.append(args)
                if args[:3]==["docker","image","ls"]:
                    return (json.dumps(listed)+"\n").encode() if len(calls)==1 else b""
                if args[:3]==["docker","image","inspect"]:
                    return json.dumps([{"Config":{"Labels":{"org.kova.recovery.owner":b.owner,
                        "org.opencontainers.image.revision":source}}}]).encode()
                if args[:3]==["docker","image","rm"]:return b""
                raise AssertionError("unexpected synthetic cleanup command")
            with self.subTest(source=source),patch.object(m.SyntheticBuilder,"command",command):
                if source==b.source:self.assertTrue(m.cleanup_image_from_state(self.env))
                else:
                    with self.assertRaisesRegex(m.builder.Stopped,"foreign_image_cleanup_forbidden"):
                        m.cleanup_image_from_state(self.env)
                    self.assertFalse(any(a[:3]==["docker","image","rm"] for a in calls))

    def test_image_fixture_uses_actual_control_versions_and_requires_every_requested_extension(self):
        p=self.probe();p.wait_native=lambda *_:None
        role={"name":"pg_database_owner","super":False,"inherit":True,"createRole":False,"createDb":False,
              "login":False,"replication":False,"bypassRls":False,"connectionLimit":-1,"validUntil":None}
        bootstrap={**role,"name":m.FIXTURE_BOOTSTRAP,"super":True,"createRole":True,"createDb":True,"login":True}
        fixture={"bootstrapRole":m.FIXTURE_BOOTSTRAP,"roles":[role,bootstrap,{**role,"name":m.FIXTURE_OWNER},
                   {**role,"name":m.FIXTURE_GRANT_ROLE},{**role,"name":m.FIXTURE_GRANT_MEMBER}],
                 "memberships":[{"role":m.FIXTURE_GRANT_ROLE,"member":m.FIXTURE_GRANT_MEMBER,
                    "grantor":m.FIXTURE_BOOTSTRAP,"admin":False,"inherit":True,"set":True}],
                 "schemas":[{"name":"public","owner":"pg_database_owner","acl":None,"comment":None}],
                 "available":[{"name":"plpgsql","version":"1.0","schema":"pg_catalog"},
                   {"name":"pg_cron","version":"1.6","schema":"pg_catalog"},
                   {"name":"pg_net","version":"0.20.4","schema":None},
                   {"name":"pgcrypto","version":"1.3","schema":None},{"name":"vector","version":"0.8.0","schema":None}]}
        calls=[];targets=[]
        p.bootstrap_sql=lambda target,sql:(targets.append(target) or calls.append(sql) or (0,json.dumps(fixture).encode()))
        p.derive_image_fixture()
        self.assertEqual({e["name"]:e["version"] for e in p.metadata["extensions"]},
                         {"plpgsql":"1.0","pg_cron":"1.6","pg_net":"0.20.4","pgcrypto":"1.3","vector":"0.8.0"})
        self.assertNotIn("sourceCommit",p.metadata);self.assertNotIn("sourceSettingsComplete",p.metadata)
        self.assertTrue(p.metadata["syntheticFixtureDerivedOnlyFromPinnedImage"])
        self.assertEqual(p.metadata["bootstrapRole"],m.FIXTURE_BOOTSTRAP)
        self.assertEqual(p.metadata["roles"],fixture["roles"])
        self.assertEqual(p.metadata["extensionNamespaces"],[{"name":"cron","extension":"pg_cron"},
                                                           {"name":"net","extension":"pg_net"}])
        self.assertEqual(next(s for s in p.metadata["schemas"] if s["name"]=="cron"),
                         {"name":"cron","owner":m.FIXTURE_BOOTSTRAP,"acl":None,
                          "comment":"Credential-free extension namespace fixture."})
        self.assertNotIn('"cron"',m.base.schema_setup_sql(p.metadata))
        self.assertNotIn('"net"',m.base.schema_setup_sql(p.metadata))
        self.assertIn('ALTER SCHEMA "cron" OWNER TO '+m.base.ident(m.FIXTURE_BOOTSTRAP),m.base.schema_metadata_sql(p.metadata))
        positions=[calls[0].index("CREATE ROLE "+m.base.ident(n)) for n in
                   sorted([m.FIXTURE_OWNER,m.FIXTURE_GRANT_MEMBER,m.FIXTURE_GRANT_ROLE])]
        self.assertEqual(positions,sorted(positions))
        self.assertEqual(targets,["a","b","a"])
        self.assertEqual(calls[0],calls[1])
        self.assertIn("GRANTED BY "+m.base.ident(m.FIXTURE_BOOTSTRAP),calls[0])
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
                 patch.object(m.base.time,"monotonic",side_effect=[0,elapsed]),self.assertRaises(m.Stopped):
                p.timeout_control("a",tools)

    def test_timeout_client_pin_and_changed_server_binary_are_rejected(self):
        tools={"timeout":"/native/timeout","sha256sum":"/native/sha"}
        for smoke_hash,accept in [("a"*64,False),("b"*64,True)]:
            p=self.probe();p.operator_smoke={"tools":[{"name":"timeout","sha256":smoke_hash}]}
            def command(args,**_):
                if "/native/sha" in args:return 0,b"b"*64+b"  /native/timeout\n"
                if "printf 'timeout-control-positive\\n'" in args:return 0,b"timeout-control-positive\n"
                return 143,b"timeout-control-started\n"
            p.docker=command
            with self.subTest(smoke_hash=smoke_hash),patch.object(m.base.time,"monotonic",side_effect=[0,1]):
                if accept:self.assertEqual(p.timeout_control("client",tools),143)
                else:
                    with self.assertRaisesRegex(m.Stopped,"timeout_control_identity_unconfirmed"):
                        p.timeout_control("client",tools)
        p.timeout_pins["a"]="a"*64
        with self.assertRaisesRegex(m.Stopped,"timeout_control_identity_unconfirmed"):p.timeout_control("a",tools)

    def test_route_timeout_status_is_accepted_only_for_measured_proven_implementation(self):
        tools={"timeout":"/native/timeout"}
        for code,out,elapsed,expected,accept in [(143,b"",3,143,True),(124,b"",3,124,True),
          (143,b"",0.1,143,False),(143,b"",3,124,False),(0,b"",0.1,124,False),
          (127,b"",3,124,False),(124,b"data",3,124,False)]:
            p=self.probe();p.docker=lambda args,**_:(code,out)
            with self.subTest(code=code,elapsed=elapsed,expected=expected),patch.object(m.base.time,"monotonic",side_effect=[0,elapsed]):
                if accept:self.assertEqual(p.timed_denial_command("a",tools,"network-control",expected),code)
                else:
                    with self.assertRaises(m.Stopped):p.timed_denial_command("a",tools,"network-control",expected)

    def test_operator_route_denials_use_actual_bash_wording_and_preserve_client_tools_and_udp_guard(self):
        diagnostics=[b"/bin/bash: connect: Network unreachable\n/bin/bash: line 1: /dev/tcp/1.1.1.1/443: Network unreachable\n",
                     b"/bin/bash: connect: Network is unreachable\n",b"/bin/bash: connect: No route to host\n",
                     b"connection refused",b"permission denied",b"/bin/bash: connect: Operation not permitted\n",
                     b"command not found",b"arbitrary failure",b""]
        for diagnostic in diagnostics:
            p=self.probe();p.native_tools={"timeout":"/server/timeout","sha256sum":"/server/sha"}
            p.client_tools={"timeout":"/operator/timeout","sha256sum":"/operator/sha"}
            p.bash_pins={"a":"a"*64,"b":"a"*64,"client":"b"*64};p.timeout_control=lambda key,tools:143
            calls=[];clock={"value":0.0}
            def docker(args,**kwargs):
                calls.append(args);p.last_stderr=b""
                key=next(key for key in ["a","b","client"] if p.names[key] in args)
                if any(arg.endswith("/sha") for arg in args):return 0,(p.bash_pins[key]+"  /bin/bash\n").encode()
                if not any(arg.endswith("/timeout") for arg in args):return 0,b""
                self.assertTrue(kwargs.get("allow_failure"))
                if "/dev/udp/" in args[-1]:
                    p.last_stderr=b"KOVA_DNS_SOCKET_READY\nKOVA_DNS_RECEIVE_READY\n"
                    clock["value"]+=3;return 143,b""
                p.last_stderr=diagnostic;return 1,b""
            p.docker=docker
            with self.subTest(diagnostic=diagnostic),patch.object(m.base.time,"monotonic",side_effect=lambda:clock["value"]):
                if b"unreachable" in diagnostic.lower() or b"no route to host" in diagnostic.lower():
                    self.assertEqual(p.denial_probes([("public-https","1.1.1.1",443)]),18)
                    self.assertEqual(len([r for r in p.network_evidence if r.get("connectDenied")]),15)
                    self.assertTrue(any(p.names["client"] in args and "/operator/timeout" in args for args in calls))
                    self.assertEqual(len([args for args in calls if "/dev/udp/" in args[-1]]),3)
                else:
                    with self.assertRaisesRegex(m.Stopped,"numeric_denial_cause_unconfirmed"):
                        p.denial_probes([("public-https","1.1.1.1",443)])
                    self.assertFalse(any(r.get("connectDenied") for r in p.network_evidence))

    def tls_fixture(self,*,mutation=None,bad_host=(1,b"server certificate does not match host"),
                    bad_ca=(1,b"certificate verify failed")):
        p=self.probe();p.native_tools={"timeout":"/server/timeout"};p.client_tools={"timeout":"/operator/timeout"}
        sql_calls=[];tcp_calls=[]
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

    def test_operator_actual_tls_controls_project_plain_hosts_and_use_final_operator_client_tools(self):
        p,sql,tcp=self.tls_fixture()
        self.assertEqual(p.tls_controls("a"),"123456789")
        self.assertEqual([kwargs["family"] for _,_,kwargs in sql[:2]],[4,6])
        self.assertEqual(len(tcp),2)
        for family,(args,kwargs) in zip([4,6],tcp):
            self.assertEqual(args,["exec",p.names["client"],"/operator/timeout","3","/bin/bash","-ceu",
                "exec 3<>/dev/tcp/"+p.addresses["a"][family==6]+"/5432"])
            self.assertNotIn("/server/timeout",args);self.assertEqual(kwargs,{"timeout":5})
        self.assertEqual(sql[2][2],{"host":"wrong-host.invalid","allow_failure":True})
        self.assertEqual(sql[3][2],{"ca":"/run/client/wrong-ca.crt","allow_failure":True})
        self.assertEqual(sql[4],("a","SELECT 1;\n",{}))

    def test_operator_actual_tls_controls_reject_wrong_or_prefixed_addresses_tls_version_and_cluster_drift(self):
        for family,wrong in [(4,"172.30.240.99"),(6,"fd68:6b6f:7661:240::99")]:
            for key,value,error in [("address",wrong,m.Stopped),("tls",False,m.Stopped),
                    ("version",170007,m.Stopped),("systemIdentifier","not-a-cluster-id",m.Stopped)]:
                p,sql,_=self.tls_fixture(mutation=(family,key,value))
                with self.subTest(family=family,key=key),self.assertRaises(error):p.tls_controls("a")
                self.assertFalse(any(kwargs.get("allow_failure") for _,_,kwargs in sql))
            p,_,_=self.tls_fixture();prefixed=p.addresses["a"][family==6]+("/32" if family==4 else "/128")
            p,sql,_=self.tls_fixture(mutation=(family,"address",prefixed))
            with self.subTest(family=family,prefix=True),self.assertRaises(ValueError):p.tls_controls("a")
            self.assertFalse(any(kwargs.get("allow_failure") for _,_,kwargs in sql))
        p,_,tcp=self.tls_fixture(mutation=(6,"systemIdentifier","987654321"))
        with self.assertRaisesRegex(m.Stopped,"target_cluster_changed"):p.tls_controls("a")
        self.assertEqual(len(tcp),2)

    def test_operator_actual_tls_controls_preserve_wrong_hostname_and_wrong_ca_rejection(self):
        cases=[({"bad_host":(0,b"does not match")},"wrong_hostname_rejection_unconfirmed"),
            ({"bad_host":(1,b"connection failed")},"wrong_hostname_rejection_unconfirmed"),
            ({"bad_ca":(0,b"certificate verify failed")},"wrong_ca_rejection_unconfirmed"),
            ({"bad_ca":(1,b"connection failed")},"wrong_ca_rejection_unconfirmed"),
            ({"bad_ca":(1,b"certificate expired")},"wrong_ca_rejection_unconfirmed")]
        for options,error in cases:
            p,sql,_=self.tls_fixture(**options)
            with self.subTest(options=options),self.assertRaisesRegex(m.Stopped,error):p.tls_controls("a")
            self.assertFalse(any(text=="SELECT 1;\n" and kwargs=={} for _,text,kwargs in sql))

    def test_operator_uses_shared_fixed_udp_send_guard_for_each_server_and_final_client(self):
        p=self.probe();p.native_tools={"timeout":"/server/timeout","sha256sum":"/server/sha"}
        p.client_tools={"timeout":"/operator/timeout","sha256sum":"/operator/sha"}
        p.bash_pins={"a":"a"*64,"b":"a"*64,"client":"b"*64};p.timeout_control=lambda key,tools:143
        calls=[]
        eperm=(b"KOVA_DNS_SOCKET_READY\n/bin/bash: line 1: printf: write error: Operation not permitted\n"
               b"KOVA_DNS_SEND_FAILED\n")
        def docker(args,**kwargs):
            calls.append(args);p.last_stderr=b""
            key=next(key for key in ["a","b","client"] if p.names[key] in args)
            if any(arg.endswith("/sha") for arg in args):return 0,(p.bash_pins[key]+"  /bin/bash\n").encode()
            if not any(arg.endswith("/timeout") for arg in args):return 0,b""
            if "/dev/udp/" in args[-1]:
                self.assertEqual(args[-1],m.base.udp_dns_probe_script());p.last_stderr=eperm;return 1,b""
            p.last_stderr=b"/bin/bash: connect: Network unreachable\n";return 1,b""
        p.docker=docker
        with patch.object(m.base.time,"monotonic",side_effect=[0,0.01]*30):
            self.assertEqual(p.denial_probes([("public-https","1.1.1.1",443)]),18)
        dns=[row for row in p.network_evidence if row.get("kind")=="docker-dns-udp"]
        self.assertEqual({row["container"] for row in dns},{"a","b","client"})
        self.assertTrue(all(row["sendDenied"] and row["replyNotReceived"] and row["denialPhase"]=="send-blocked" for row in dns))
        udp_calls=[args for args in calls if "/dev/udp/" in args[-1]]
        self.assertEqual(len(udp_calls),3)
        self.assertTrue(any(p.names["client"] in args and "/operator/timeout" in args for args in udp_calls))
        self.assertFalse(any(p.names["client"] in args and "/server/timeout" in args for args in udp_calls))
        self.assertIs(o.OperatorProbe.udp_dns_denial_command,m.base.Probe.udp_dns_denial_command)


if __name__=="__main__":unittest.main()
