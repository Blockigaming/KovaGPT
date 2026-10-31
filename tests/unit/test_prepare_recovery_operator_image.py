"""Synthetic image identity/guard/archive mutations; never Docker or network."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/"scripts/release/prepare-recovery-operator-image.py"
spec=importlib.util.spec_from_file_location("generic_image",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture_spec=importlib.util.spec_from_file_location("builder_owned_fixture",Path(__file__).with_name("test_owned_noswap_volumes.py"))
fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)


def smoke():
    names=["python3","node","gpg","psql","pg_dump","pg_restore","timeout","bash","sha256sum"]
    return {"operation":"generic-recovery-client-native-smoke","nonroot":True,
        "genericSourceSha256":{name:m.file_sha(m.SOURCE/name) for name in m.FILES},
        "tools":[{"name":n,"path":"/usr/bin/"+n,"version":n+" (PostgreSQL) 17.7" if n in {"psql","pg_dump","pg_restore"} else "synthetic-version",
                  "sha256":"a"*64} for n in names],"packageInventorySha256":m.sha(b"synthetic\n"),
        "installedPackageCount":1,"signedInReleaseFiles":[{"name":"synthetic_InRelease","sha256":"b"*64}],
        "nativePythonEngineImport":True,"nativeNodeDestinationGuard":True,"nodePasswordOverrideRejected":True,
        "nativeFileBoundLauncherImport":True,"nativeSemanticDependencyClosureLoaded":True,"readonlyRootObserved":True,"noNewPrivilegesObserved":True,
        "capabilitiesDroppedObserved":True,"tmpfsNoSwapObserved":True,"memorySwapDisabledObserved":True,
        "syntheticGpgRoundtrip":True,"wrongGpgPassphraseRejected":True,"actualTargetConnected":False,
        "customerRowsUsed":False,"restorePerformed":False}


def write_oci(path,config,*,tampered=False):
    layer=b"synthetic generic layer"
    manifest=m.canonical({"schemaVersion":2,"config":{"digest":"sha256:"+m.sha(config),"size":len(config)},
        "layers":[{"digest":"sha256:"+m.sha(layer),"size":len(layer)}]})
    objects={"oci-layout":b'{"imageLayoutVersion":"1.0.0"}',
        "index.json":m.canonical({"schemaVersion":2,"manifests":[{"digest":"sha256:"+m.sha(manifest),"size":len(manifest)}]}),
        "blobs/sha256/"+m.sha(manifest):manifest,"blobs/sha256/"+m.sha(config):config,
        "blobs/sha256/"+m.sha(layer):(b"tampered generic layer" if tampered else layer)}
    with tarfile.open(path,"w") as package:
        for name,data in objects.items():
            info=tarfile.TarInfo(name);info.size=len(data);package.addfile(info,io.BytesIO(data))
    return "sha256:"+m.sha(manifest)


class PreparationTests(unittest.TestCase):
    def test_cleanup_removes_both_exact_owned_source_bound_tags_and_preserves_foreign_images(self):
        builder=self.builder();present={builder.tag,builder.roundtrip_tag,"foreign:image"};removed=[]
        def command(args,**kwargs):
            if args[:3]==["docker","image","ls"]:
                tag=next(x.removeprefix("reference=") for x in args if x.startswith("reference="))
                return json.dumps({"Repository":tag.split(":")[0],"Tag":tag.split(":")[1]}).encode() if tag in present else b""
            if args[:3]==["docker","image","inspect"]:
                return json.dumps([{"Config":{"Labels":{"org.kova.recovery.owner":builder.owner,
                    "org.opencontainers.image.revision":builder.source}}}]).encode()
            if args[:3]==["docker","image","rm"]:
                self.assertIn(args[-1],{builder.tag,builder.roundtrip_tag})
                present.remove(args[-1]);removed.append(args[-1]);return b""
            raise AssertionError("unexpected cleanup command")
        builder.command=command
        self.assertTrue(builder.cleanup_image())
        self.assertEqual(set(removed),{builder.tag,builder.roundtrip_tag});self.assertEqual(present,{"foreign:image"})

    def test_roundtrip_cleanup_rejects_matching_owner_with_changed_source(self):
        builder=self.builder();calls=[]
        def command(args,**kwargs):
            calls.append(args)
            if args[:3]==["docker","image","ls"]:
                tag=next(x.removeprefix("reference=") for x in args if x.startswith("reference="))
                return json.dumps({"Repository":tag.split(":")[0],"Tag":tag.split(":")[1]}).encode() if tag==builder.roundtrip_tag else b""
            return json.dumps([{"Config":{"Labels":{"org.kova.recovery.owner":builder.owner,
                "org.opencontainers.image.revision":"f"*40}}}]).encode()
        builder.command=command
        with self.assertRaisesRegex(m.Stopped,"foreign_image_cleanup_forbidden"):builder.cleanup_image()
        self.assertFalse(any(args[:3]==["docker","image","rm"] for args in calls))

    def test_native_failure_reports_executed_marker_and_never_private_output(self):
        with tempfile.TemporaryDirectory() as folder:
            builder=m.Builder({"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_EVENT_NAME":"workflow_dispatch",
                "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/heads/main",
                "GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,"GITHUB_RUN_ID":"123","GITHUB_RUN_ATTEMPT":"1",
                "RUNNER_TEMP":folder,"KOVA_OPERATOR_IMAGE_CONFIRMATION":"BUILD_DATA_FREE_OPERATOR_IMAGE","PATH":os.environ["PATH"]},
                Path(folder)/"operator-client-image")
            def child(_args,**kwargs):
                kwargs["stdout"].write(b"synthetic-private-key")
                kwargs["stderr"].write(b"RUN echo KOVA_OPERATOR_STAGE=pg17-client-install\n"
                    b"#8 0.2 KOVA_OPERATOR_STAGE=ubuntu-package-version-guard\n"
                    b"#8 0.3 KOVA_OPERATOR_STAGE=synthetic-private-key\nsynthetic-private-key\n")
                return subprocess.CompletedProcess(_args,17)
            with patch.object(m.subprocess,"run",side_effect=child),self.assertRaises(m.Stopped) as caught:
                builder.command(["docker","build","private-context-name"])
            error=caught.exception;error.public_stage="docker-build"
            value=m.public_failure(error)
            self.assertEqual(value["command"],{"status":"exit","exitCode":17,
                "dockerBuildStage":"ubuntu-package-version-guard"})
            self.assertNotIn("private",json.dumps(value))
            self.assertNotIn("pg17-client-install",json.dumps(value))

    def test_unknown_exceptions_and_timeout_details_remain_private(self):
        value=m.public_failure(RuntimeError("synthetic-private-key"))
        self.assertEqual(value["code"],"unclassified_private_failure")
        self.assertNotIn("synthetic-private",json.dumps(value))
        builder=self.builder()
        with patch.object(m.subprocess,"run",side_effect=subprocess.TimeoutExpired("synthetic-private-command",1)),\
             self.assertRaises(m.Stopped) as caught:
            builder.command(["synthetic-private-command"])
        self.assertEqual(m.public_failure(caught.exception)["command"],{"status":"timeout"})
        self.assertNotIn("synthetic-private",json.dumps(m.public_failure(caught.exception)))

    def test_oci_failure_keeps_primary_stage_when_cleanup_also_fails(self):
        builder=self.builder();image_id="sha256:"+"e"*64
        def command(args,**kwargs):
            if args[:2]==["git","rev-parse"]:return b"a"*40
            if args[:3]==["docker","image","inspect"]:
                if args[-1]==m.BASE_TAG:return json.dumps([{"Id":"sha256:"+"b"*64,"Os":"linux",
                    "Architecture":"amd64","RepoDigests":["ubuntu@sha256:"+"c"*64]}]).encode()
                return json.dumps([{"Id":image_id,"Os":"linux","Architecture":"amd64","Config":{
                    "User":"65532:65532","Healthcheck":{"Test":["NONE"]},"Labels":{
                    "org.kova.recovery.owner":builder.owner,"org.opencontainers.image.revision":"a"*40}}}]).encode()
            if args[:2]==["skopeo","copy"]:raise m.native_failure("exit",17)
            return b""
        builder.command=command;builder.run_args=lambda:[]
        builder.run_generic=lambda args:json.dumps(smoke()).encode() if not args else b"synthetic\n"
        builder.cleanup_storage=lambda:True
        builder.cleanup_image=lambda:(_ for _ in ()).throw(m.Stopped("generic_image_cleanup_unconfirmed"))
        with patch.object(m,"os",SimpleNamespace(getuid=lambda:1001,getgid=lambda:1001,chmod=os.chmod)),\
             self.assertRaises(m.Stopped) as caught:
            builder.execute()
        value=m.public_failure(caught.exception)
        self.assertEqual(value["stage"],"oci-export")
        self.assertEqual(value["command"],{"status":"exit","exitCode":17})
        self.assertFalse(builder.output.exists())

    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        self.root=Path(self.folder.name)
        self.env={"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_EVENT_NAME":"workflow_dispatch",
            "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/heads/main",
            "GITHUB_SHA":"a"*40,"KOVA_APPROVED_SOURCE_SHA":"a"*40,"GITHUB_RUN_ID":"123","GITHUB_RUN_ATTEMPT":"1","RUNNER_TEMP":str(self.root),
            "KOVA_OPERATOR_IMAGE_CONFIRMATION":"BUILD_DATA_FREE_OPERATOR_IMAGE","PATH":os.environ["PATH"]}

    def builder(self):
        p=m.Builder(self.env,self.root/"operator-client-image")
        fake=fixture.FakeDocker();fake.manager=p.owned_ram;p.test_ram_docker=fake
        native=p.command
        p.command=lambda args,**kwargs:fake(args,timeout=kwargs.get("timeout",90)) if args[:2] in [["docker","volume"],["docker","ps"]] else native(args,**kwargs)
        return p

    def test_only_exact_main_dispatch_and_explicit_source_can_build(self):
        self.assertEqual(m.context(self.env),"a"*40)
        for key,value in [("GITHUB_EVENT_NAME","pull_request"),("GITHUB_REF","refs/heads/unreviewed"),
                          ("GITHUB_REPOSITORY","foreign/repository"),("GITHUB_ACTIONS","false"),
                          ("KOVA_APPROVED_SOURCE_SHA","b"*40),("KOVA_OPERATOR_IMAGE_CONFIRMATION","RESTORE")]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.context({**self.env,key:value})

    def test_source_target_phrase_and_provider_secrets_stop_before_commands(self):
        for key in [*m.SENSITIVE_KEYS,"KOVA_PRODUCTION_OTHER_SECRET","APPROVED_ISOLATED_HOST","KOVA_AUTH_RESTORE_ATTESTATION"]:
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.context({**self.env,key:"synthetic-private"})
        p=m.Builder({**self.env,"ACTIONS_RUNTIME_TOKEN":"platform-private","HTTPS_PROXY":"http://policy.invalid"},self.root/"operator-client-image")
        self.assertNotIn("ACTIONS_RUNTIME_TOKEN",p.env);self.assertEqual(p.env["HTTPS_PROXY"],"http://policy.invalid")

    def test_base_digest_must_be_measured_official_ubuntu_amd64_identity(self):
        value=[{"Id":"sha256:"+"b"*64,"Os":"linux","Architecture":"amd64","RepoDigests":["ubuntu@sha256:"+"c"*64]}]
        self.assertEqual(m.measured_base(value)[0],"ubuntu@sha256:"+"c"*64)
        for key,other in [("Architecture","arm64"),("Os","windows"),("RepoDigests",["foreign@sha256:"+"c"*64]),("RepoDigests",[])]:
            altered=copy.deepcopy(value);altered[0][key]=other
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.measured_base(altered)

    def test_docker_context_is_public_source_allowlist_without_repository_or_runtime_files(self):
        hashes=m.source_context(self.root)
        self.assertEqual(set(hashes),set(m.FILES)|{"recovery-operator-client.Dockerfile"})
        self.assertEqual({str(p.relative_to(self.root)) for p in self.root.rglob("*") if p.is_file()},
                         {"Dockerfile"}|{"source/"+name for name in m.FILES})
        self.assertFalse(any(".git" in str(p) or "metadata.json" in str(p) for p in self.root.rglob("*")))

    def test_smoke_cannot_qualify_with_wrong_major_missing_tool_or_asserted_target_access(self):
        self.assertTrue(m.check_smoke(smoke())["syntheticGpgRoundtrip"])
        for mutate in [lambda v:v.update(syntheticGpgRoundtrip=False),lambda v:v.update(actualTargetConnected=True),
                       lambda v:v["tools"].pop(),lambda v:v["tools"][3].update(version="psql (PostgreSQL) 18.1"),
                       lambda v:v["tools"][0].update(sha256="invalid"),lambda v:v["tools"].append(v["tools"][0]),
                       lambda v:v.update(signedInReleaseFiles=[])]:
            value=smoke();mutate(value)
            with self.assertRaises(m.Stopped):m.check_smoke(value)

    def test_final_format3_runtime_has_exact_generic_dependency_closure(self):
        spec=importlib.util.spec_from_file_location("native_client_smoke",m.SOURCE/"recovery-operator-client-smoke.py")
        client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)
        spec=importlib.util.spec_from_file_location("semantic_capture",m.SOURCE/"extension-semantic-capture.py")
        semantic=importlib.util.module_from_spec(spec);spec.loader.exec_module(semantic)
        self.assertEqual(set(m.FILES),set(client.SOURCE_NAMES))
        self.assertEqual(set(m.FILES)-set(semantic.HELPERS),{
            "managed-auth-recovery.py","managed-auth-recovery-target.mjs","verify-isolated-restore-target.mjs",
            "empty-restore-target-catalog.sql","recovery-operator-client-smoke.py","run-isolated-recovery-client.py"})
        self.assertEqual(set(semantic.source_files()),set(semantic.HELPERS))
        self.assertTrue(semantic.audit_body().endswith(";"))
        options=semantic.relations.capture_query_options(semantic.core,semantic.generator)
        self.assertIn("pg_extension",options["manifests"])
        self.assertIn("PRIVATE_GHA_CAPTURE_ONLY",semantic.generator.build_capture_all_private_wire_query(**options))
        for field in ["nativeSemanticDependencyClosureLoaded"]:
            value=smoke();value.pop(field)
            with self.assertRaises(m.Stopped):m.check_smoke(value)

    def test_final_smoke_container_is_nonroot_readonly_unprivileged_networkless_and_healthcheck_off(self):
        p=self.builder();p.image_id="sha256:"+"d"*64
        with patch.object(m,"os",SimpleNamespace(getuid=lambda:1001,getgid=lambda:1001)):args=p.run_args()
        for item in ["--rm","--no-healthcheck","--read-only","no-new-privileges:true"]:self.assertIn(item,args)
        self.assertEqual(args[args.index("--network")+1],"none")
        self.assertEqual(args[args.index("--cap-drop")+1],"ALL")
        self.assertEqual(args[args.index("--user")+1],"1001:1001")
        self.assertEqual(args[args.index("--memory-swap")+1],args[args.index("--memory")+1])
        self.assertNotIn("--tmpfs",args)
        self.assertEqual(args[args.index("--log-driver")+1],"none")
        mount=args[args.index("--mount")+1]
        self.assertTrue(mount.startswith("type=volume,src=kova-ram-"));self.assertTrue(mount.endswith(",dst=/tmp,volume-nocopy"))
        spec=p.owned_ram().expected_mounts(p.last_ram_keys)[0]
        self.assertEqual(spec["options"]["type"],"tmpfs");self.assertEqual(spec["options"]["device"],"tmpfs")
        self.assertIn(",noswap,",spec["options"]["o"])
        self.assertEqual(spec["uid"],1001);self.assertEqual(spec["mode"],"1777")
        self.assertNotIn("--env",args);self.assertNotIn("--privileged",args)

    def test_builder_short_runs_use_distinct_volume_names_and_validate_framed_proof(self):
        p=self.builder();p.image_id="sha256:"+"d"*64;native=p.command;launches=[]
        def command(args,**kwargs):
            if args[:2]==["docker","run"]:
                specs=p.owned_ram().expected_mounts(p.last_ram_keys)
                self.assertTrue(all(spec["activated"] for spec in specs));launches.append(args)
                return b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n"+fixture.runtime_bytes(specs)+b"KOVA_PRIVATE_RAM_PROOF_END\nsynthetic stdout"
            return native(args,**kwargs)
        p.command=command
        for _ in range(2):self.assertEqual(p.run_generic(p.run_args()),b"synthetic stdout")
        self.assertEqual(set(p.owned_ram().specs),{"builder0-tmp","builder1-tmp"})
        self.assertEqual(len({spec["name"] for spec in p.owned_ram().specs.values()}),2)
        self.assertEqual(len(p.owned_ram().runtime_records),2)
        for args in launches:
            self.assertIn("/opt/kova/scripts/release/recovery-operator-client-smoke.py",args)
            self.assertEqual(args[args.index("--entrypoint")+1],"/bin/bash")
            self.assertNotIn("--tmpfs",args);self.assertNotIn("--privileged",args)
        with patch.object(p.owned_ram(),"cleanup",return_value=False) as cleanup:
            self.assertFalse(p.cleanup_storage());cleanup.assert_called_once()

    def test_missing_kernel_proof_quarantines_builder_activation(self):
        p=self.builder();p.image_id="sha256:"+"d"*64;native=p.command
        p.command=lambda args,**kwargs:b"unframed stdout" if args[:2]==["docker","run"] else native(args,**kwargs)
        args=p.run_args()
        with self.assertRaisesRegex(m.Stopped,"kernel_proof_unconfirmed"):p.run_generic(args)
        self.assertTrue(p.owned_ram().specs["builder0-tmp"]["activated"])
        self.assertEqual(p.owned_ram().runtime_records,[])
        with self.assertRaises(m.ram.Stopped):p.cleanup_storage()

    def test_output_cannot_escape_runner_or_overwrite_existing_files(self):
        for output in [self.root.parent/"operator-client-image",self.root/"receipt.json"]:
            with self.assertRaises(m.Stopped):m.Builder(self.env,output)
        output=self.root/"operator-client-image";output.mkdir()
        with self.assertRaises(m.Stopped):m.Builder(self.env,output)

    def test_foreign_image_tag_is_not_removed_on_cleanup(self):
        p=self.builder();calls=[]
        def command(args,**_):
            calls.append(args)
            if "ls" in args:return json.dumps({"Repository":p.tag.split(":")[0],"Tag":p.tag.split(":")[1]}).encode()
            return json.dumps([{"Config":{"Labels":{"org.kova.recovery.owner":"foreign"}}}]).encode()
        p.command=command
        with self.assertRaises(m.Stopped):p.cleanup_image()
        self.assertFalse(any("rm" in args for args in calls))

    def test_dockerfile_shell_and_signed_source_trust_boundaries(self):
        text=(ROOT/"scripts/release/recovery-operator-client.Dockerfile").read_text()
        for value in [m.KEY_FINGERPRINT,m.UBUNTU_KEY_FINGERPRINT,"Signed-By:","noble-pgdg","Architectures: amd64",
                      "https://apt.postgresql.org/pub/repos/apt","--proto '=https'","HEALTHCHECK NONE","USER 65532:65532"]:
            self.assertIn(value,text)
        for bad in ["apt-key","trusted=yes","allow-unauthenticated","COPY . ","--mount=type=secret"]:self.assertNotIn(bad,text)
        run=text.split("RUN ",1)[1].split("\nCOPY ",1)[0].replace("\\\n","")
        result=subprocess.run(["bash","-n"],input=run.encode(),capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_workflow_has_no_secret_or_production_binding_and_uploads_only_generic_three_files(self):
        text=(ROOT/".github/workflows/prepare-recovery-operator-image.yml").read_text()
        for bad in ["secrets.","environment:","DATABASE_URL","BACKUP_PASSPHRASE","contents: write","packages: write"]:
            self.assertNotIn(bad,text)
        for value in ["inputs.source_sha == github.sha","refs/heads/main","BUILD_DATA_FREE_OPERATOR_IMAGE",
                      "retention-days: 7","compression-level: 0","operator-client.oci.tar","client-image-inventory.json",
                      "image-preparation-receipt.json","persist-credentials: false"]:self.assertIn(value,text)
        self.assertEqual(text.count("actions/upload-artifact@"),1)

    def test_oci_archive_verifies_layout_config_identity_and_every_layer_hash(self):
        archive=self.root/"generic.oci.tar";config=b"synthetic generic config"
        manifest=write_oci(archive,config)
        self.assertEqual(m.oci_identity(archive,"sha256:"+m.sha(config)),manifest)
        with self.assertRaises(m.Stopped):m.oci_identity(archive,"sha256:"+"f"*64)
        write_oci(archive,config,tampered=True)
        with self.assertRaises(m.Stopped):m.oci_identity(archive,"sha256:"+m.sha(config))
        with tarfile.open(archive,"w") as package:
            payload=b"not an OCI archive";item=tarfile.TarInfo("manifest.json");item.size=len(payload)
            package.addfile(item,io.BytesIO(payload))
        with self.assertRaises(m.Stopped):m.oci_identity(archive,"sha256:"+m.sha(config))

    def test_mocked_build_preserves_oci_config_identity_and_does_not_claim_target_qualification(self):
        p=self.builder();calls=[];loaded=False
        runtime={"User":"65532:65532","Env":["PATH=/usr/bin"],"Entrypoint":["python3","/opt/kova/scripts/release/recovery-operator-client-smoke.py"],
            "WorkingDir":"/tmp","Labels":{"org.kova.recovery.owner":p.owner,"org.opencontainers.image.revision":"a"*40}}
        layer_id="sha256:"+m.sha(b"synthetic generic layer")
        document={"architecture":"amd64","os":"linux","config":copy.deepcopy(runtime),
            "rootfs":{"type":"layers","diff_ids":[layer_id]}}
        config=m.canonical(document);image_id="sha256:"+m.sha(config)
        built_config={**copy.deepcopy(runtime),"Healthcheck":{"Test":["NONE"]},
            "Shell":["/bin/bash","-o","pipefail","-ceu"],"Cmd":None,"Volumes":None}
        built_id="sha256:"+m.sha(m.canonical({**document,"config":built_config}))
        self.assertNotEqual(built_id,image_id)
        def command(args,**_):
            nonlocal loaded
            calls.append(args)
            if args[:2] in [["docker","volume"],["docker","ps"]]:return p.test_ram_docker(args)
            if args[:2]==["git","rev-parse"]:return b"a"*40+b"\n"
            if args[:3]==["docker","image","inspect"]:
                if args[-1]==m.BASE_TAG:return json.dumps([{"Id":"sha256:"+"b"*64,"Os":"linux","Architecture":"amd64","RepoDigests":["ubuntu@sha256:"+"c"*64]}]).encode()
                roundtrip=args[-1]==p.roundtrip_tag
                if roundtrip:self.assertTrue(loaded)
                return json.dumps([{"Id":image_id if roundtrip else built_id,"Os":"linux","Architecture":"amd64",
                    "Config":runtime if roundtrip else built_config,"RootFS":{"Type":"layers","Layers":[layer_id]}}]).encode()
            if args[:2]==["docker","run"]:
                self.assertTrue(loaded)
                self.assertEqual(p.image_id,image_id)
                specs=p.owned_ram().expected_mounts(p.last_ram_keys)
                self.assertTrue(all(spec["activated"] for spec in specs))
                stdout=b"synthetic\n" if "/bin/cat" in args else json.dumps(smoke()).encode()
                return b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n"+fixture.runtime_bytes(specs)+b"KOVA_PRIVATE_RAM_PROOF_END\n"+stdout
            if args[:2]==["skopeo","copy"]:
                if args[-1].startswith("oci-archive:"):
                    archive=Path(args[-1].removeprefix("oci-archive:").removesuffix(":operator-client"))
                    write_oci(archive,config)
                else:
                    self.assertEqual(args[-1],"docker-daemon:"+p.roundtrip_tag)
                    loaded=True
            return b""
        p.command=command;p.cleanup_image=lambda:True
        with patch.object(m,"os",SimpleNamespace(getuid=lambda:1001,getgid=lambda:1001,chmod=os.chmod)):
            receipt=p.execute()
        self.assertEqual(len(p.owned_ram().runtime_records),2)
        self.assertEqual(receipt["clientImageId"],image_id)
        self.assertEqual(receipt["buildClientImageId"],built_id)
        self.assertEqual(receipt["ociConfigDigest"],image_id)
        self.assertTrue(receipt["nativeOciArchiveRoundtripSmokePassed"])
        self.assertEqual(receipt["format"],2)
        self.assertFalse(receipt["restorePerformed"]);self.assertFalse(receipt["clientNetworkIsolationQualified"])
        self.assertFalse(receipt["futureRestoreApproved"]);self.assertFalse(receipt["customerDataReceived"])
        self.assertEqual({x.name for x in p.output.iterdir()},
                         {"operator-client.oci.tar","client-image-inventory.json","image-preparation-receipt.json"})
        self.assertTrue(any(args[:2]==["docker","build"] and "--no-cache" in args for args in calls))


if __name__=="__main__":unittest.main()
