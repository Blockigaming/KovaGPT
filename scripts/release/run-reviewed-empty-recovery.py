#!/usr/bin/env python3
"""Run an explicitly reviewed recovery recipe on a private ephemeral recipient.

Manual main only. This is not an Auth cutover or a production restore. A prior
actual native proof, exact retained generic OCI client, complete encrypted
capture and an independently reviewed manifest must all match. Customer data
is decrypted only inside the unprivileged, network-isolated, noswap client.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import tempfile
from urllib.parse import quote
import zipfile

HERE=Path(__file__).resolve().parent
REPO="Blockigaming/KovaGPT"
MAX_ZIP=4*1024**3+32*1024**2
MAX_JSON=16*1024**2


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


review=module("reviewed_recovery_plan","reviewed-empty-recovery-plan.py")
native=module("reviewed_native_operator","operator-recovery-probe.py")
base=native.base
builder=native.builder
recovery=base.recovery
require=review.require
Stopped=review.Stopped
canonical=review.canonical
sha=review.sha
SAFE_FAILURE_CODES=frozenset({"reviewed_private_recovery_unqualified","artifact_api_identity_mismatch",
    "artifact_run_identity_mismatch","artifact_name_mismatch","artifact_receipt_hash_mismatch",
    "artifact_download_unconfirmed","artifact_zip_members_rejected","reviewed_host_command_unconfirmed",
    "reviewed_plan_hash_mismatch","owner_review_stale","reviewed_fresh_baseline_mismatch",
    "source_settings_incomplete","fresh_baseline_changed","native_command_failed","native_command_unconfirmed",
    "native_extension_preload_unqualified","native_permission_unqualified","native_dependency_unqualified",
    "operator_source_files_mismatch","operator_final_source_closure_mismatch","operator_archive_hash_mismatch",
    "operator_inventory_hash_mismatch","loaded_operator_id_mismatch","native_target_contains_seed_data",
    "native_blank_census_unqualified","runtime_log_swap_or_cgroup_policy_changed","runtime_logging_policy_changed",
    "outbound_connection_not_denied","numeric_denial_cause_unconfirmed","embedded_dns_udp_denial_unconfirmed",
    "fresh_native_evidence_stale","actual_restore_receipt_unqualified","private_client_restore_failed",
    "server_transport_proof_unqualified","reviewed_server_transport_pin_mismatch","fresh_server_transport_mismatch"})
SAFE_NATIVE_STAGES=frozenset({"initial","native_tools","network_create","native_metadata_prepare",
    "native_tls_controls","native_catalog_proof","native_extension_coverage","original_destination_guard",
    "actual_egress_denial","native_proof_complete"})
ARTIFACTS={
 "nativeProbe":{"files":{"receipt.json":MAX_JSON},"receipt":"receipt.json",
     "workflow":".github/workflows/probe-empty-recovery-target.yml","prefix":"empty-recovery-proof-"},
 "operatorClient":{"files":{"operator-client.oci.tar":4*1024**3,"client-image-inventory.json":MAX_JSON,
     "image-preparation-receipt.json":MAX_JSON},"receipt":"image-preparation-receipt.json",
     "workflow":".github/workflows/prepare-recovery-operator-image.yml","prefix":"recovery-operator-client-"},
 "capture":{"files":{"managed-auth-backup.tar.gpg":4*1024**3,"capture-receipt.json":MAX_JSON},
     "receipt":"capture-receipt.json","workflow":".github/workflows/capture-managed-auth-production.yml",
     "prefix":"managed-auth-capture-"},
}


def private_file(path,limit):
    path=Path(path);info=path.lstat()
    require(stat.S_ISREG(info.st_mode) and not info.st_mode&0o077 and info.st_uid==os.getuid()
            and 0<info.st_size<=limit,"review_input_private_file_required")
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        opened=os.fstat(descriptor)
        require((info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_size)==
                (opened.st_dev,opened.st_ino,opened.st_mode,opened.st_uid,opened.st_size),"review_input_changed")
        raw=os.read(descriptor,limit+1)
        require(len(raw)==info.st_size,"review_input_changed")
        return raw
    finally:os.close(descriptor)


def strict_json(raw):
    def pairs(rows):
        out={}
        for k,v in rows:
            require(k not in out,"review_input_duplicate_key");out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def context(env):
    require(env.get("KOVA_REVIEWED_RECOVERY_CONFIRMATION")=="RESTORE_REVIEWED_PRIVATE_EMPTY_ONLY",
            "reviewed_restore_confirmation_required")
    require(env.get("GITHUB_ACTIONS")=="true" and env.get("RUNNER_OS")=="Linux"
            and env.get("GITHUB_EVENT_NAME")=="workflow_dispatch"
            and env.get("GITHUB_REPOSITORY")==REPO and env.get("GITHUB_REF")=="refs/heads/main"
            and env.get("GITHUB_ACTOR","").casefold()==env.get("GITHUB_REPOSITORY_OWNER","").casefold()=="blockigaming"
            and re.fullmatch(r"[a-f0-9]{40}",env.get("GITHUB_SHA",""))
            and env.get("GITHUB_SHA")==env.get("KOVA_APPROVED_SOURCE_SHA"),"owner_main_manual_dispatch_required")
    forbidden={k for k in env if k.startswith("KOVA_PRODUCTION_") and k!="KOVA_PRODUCTION_BACKUP_PASSPHRASE"
               or k in base.FORBIDDEN_ENV-{"KOVA_PRODUCTION_BACKUP_PASSPHRASE"}
               or k.startswith("APPROVED_ISOLATED_") or k.startswith("KOVA_AUTH_RESTORE_")}
    require(not any(env.get(k) for k in forbidden),"source_or_unreviewed_credentials_in_restore_environment")
    root=Path(env.get("RUNNER_TEMP","")).resolve()
    require(root.is_dir() and root!=Path("/"),"runner_temporary_directory_required")
    return root


def sanitized_host_env(env):
    return {k:v for k,v in env.items() if k in builder.SAFE_HOST_ENV}


class HostCommandStopped(Stopped):
    def __init__(self,code,*,completed):super().__init__(code);self.completed=completed


def command(args,env,*,output=None,timeout=120):
    """All dynamic subprocess diagnostics stay private; only fixed codes leave."""
    def limits():resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_ZIP,MAX_ZIP))
    try:
        if output is not None:
            with Path(output).open("xb") as target:
                result=subprocess.run(args,stdout=target,stderr=subprocess.DEVNULL,env=env,
                                      timeout=timeout,check=False,preexec_fn=limits)
            if result.returncode!=0:raise HostCommandStopped("artifact_download_unconfirmed",completed=type(result.returncode) is int and result.returncode>=0)
            require(0<Path(output).stat().st_size<=MAX_ZIP,"artifact_download_unconfirmed")
            return b""
        with tempfile.TemporaryFile() as target:
            result=subprocess.run(args,stdout=target,stderr=subprocess.DEVNULL,env=env,
                                  timeout=timeout,check=False,preexec_fn=limits)
            if result.returncode!=0:raise HostCommandStopped("reviewed_host_command_unconfirmed",completed=type(result.returncode) is int and result.returncode>=0)
            require(target.tell()<=MAX_JSON,"reviewed_host_command_unconfirmed")
            target.seek(0);return target.read(MAX_JSON+1)
    except (OSError,subprocess.SubprocessError):raise HostCommandStopped("reviewed_host_command_unconfirmed",completed=False) from None


def verified_github_identity(kind,pin,artifact,run):
    spec=ARTIFACTS[kind]
    require(artifact.get("id")==pin["artifactId"] and artifact.get("expired") is False
            and type(artifact.get("size_in_bytes")) is int and 0<artifact["size_in_bytes"]<=MAX_ZIP
            and artifact.get("workflow_run",{}).get("id")==pin["runId"]
            and artifact.get("workflow_run",{}).get("head_sha")==pin["sourceSha"],"artifact_api_identity_mismatch")
    require(run.get("id")==pin["runId"] and run.get("head_sha")==pin["sourceSha"]
            and run.get("head_branch")=="main" and run.get("event")=="workflow_dispatch"
            and run.get("status")=="completed" and run.get("conclusion")=="success"
            and run.get("repository",{}).get("full_name")==REPO and run.get("path")==spec["workflow"]
            and type(run.get("run_attempt")) is int and run["run_attempt"]>0,
            "artifact_run_identity_mismatch")
    require(artifact.get("name")==spec["prefix"]+pin["sourceSha"]+"-"+str(pin["runId"])+"-"+str(run["run_attempt"]),
            "artifact_name_mismatch")


def unpack_artifact(path,destination,expected):
    require(not destination.exists(),"artifact_output_exists")
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(path) as archive:
        entries=archive.infolist()
        require(len(entries)==len(expected) and {v.filename for v in entries}==set(expected)
                and all(v.filename in expected and not v.is_dir() and not v.flag_bits&1
                        and 0<v.file_size<=expected[v.filename]
                        and stat.S_IFMT(v.external_attr>>16) in {0,stat.S_IFREG} for v in entries),
                "artifact_zip_members_rejected")
        for item in entries:
            output=destination/item.filename
            with archive.open(item) as source,output.open("xb") as target:
                remaining=item.file_size
                while remaining:
                    block=source.read(min(remaining,1024**2));require(bool(block),"artifact_member_truncated")
                    target.write(block);remaining-=len(block)
                require(not source.read(1),"artifact_member_size_changed")
            output.chmod(0o600)


def fetch_artifacts(manifest,root,env):
    gh_env={**sanitized_host_env(env),"GH_TOKEN":env.get("GH_TOKEN","")}
    require(gh_env["GH_TOKEN"],"github_read_token_required")
    receipts={};paths={}
    for kind,spec in ARTIFACTS.items():
        pin=review.artifact_pin(manifest.get(kind),oci=kind=="operatorClient")
        api="repos/"+REPO+"/actions/"
        artifact=strict_json(command(["gh","api",api+"artifacts/"+str(pin["artifactId"])],gh_env))
        run=strict_json(command(["gh","api",api+"runs/"+str(pin["runId"])],gh_env))
        verified_github_identity(kind,pin,artifact,run)
        archive=root/(kind+".zip")
        command(["gh","api",api+"artifacts/"+str(pin["artifactId"])+"/zip"],gh_env,output=archive,timeout=300)
        directory=root/kind;unpack_artifact(archive,directory,spec["files"]);archive.unlink()
        raw=private_file(directory/spec["receipt"],MAX_JSON)
        require(sha(raw)==pin["receiptSha256"],"artifact_receipt_hash_mismatch")
        receipts[kind]={"runId":pin["runId"],"artifactId":pin["artifactId"],"sourceSha":pin["sourceSha"],
            "receiptSha256":sha(raw),"repository":REPO,"githubIdentityVerified":True,"receipt":strict_json(raw)}
        paths[kind]=directory
    return receipts,paths


def recipe_hashes():
    return {name:builder.file_sha(HERE/name) for name in review.RECIPE_FILES}


def load_exact_operator(plan,paths,run,tag):
    pin=plan["operatorClient"];directory=paths["operatorClient"]
    archive=directory/"operator-client.oci.tar"
    require(archive.stat().st_size==pin["archiveBytes"] and builder.file_sha(archive)==pin["archiveSha256"],
            "operator_archive_hash_mismatch")
    oci=builder.inspect_oci(archive)
    require(oci["configDigest"]==pin["imageId"],"operator_archive_hash_mismatch")
    raw=private_file(directory/"client-image-inventory.json",MAX_JSON)
    require(sha(raw)==pin["inventorySha256"],"operator_inventory_hash_mismatch")
    inventory=strict_json(raw)
    expected={name:builder.file_sha(HERE/name) for name in [*builder.FILES,"recovery-operator-client.Dockerfile"]}
    require(inventory.get("format")==2 and inventory.get("nativeOciArchiveRoundtripSmokePassed") is True
            and inventory.get("ociConfigDigest")==pin["imageId"]
            and re.fullmatch(r"sha256:[a-f0-9]{64}",inventory.get("buildClientImageId",""))
            and inventory.get("clientImageId")==pin["imageId"] and inventory.get("sourceSha")==pin["sourceSha"]
            and all(inventory.get("genericSourceSha256",{}).get(k)==v for k,v in expected.items()),
            "operator_final_source_closure_mismatch")
    built=inventory.get("genericBuildImage",{})
    require(type(built) is dict and built.get("Id")==inventory["buildClientImageId"],
            "operator_final_source_closure_mismatch")
    binding=builder.verify_oci_runtime_binding(built,json.loads(oci["configBytes"]),source_sha=pin["sourceSha"],
        owner=built.get("Config",{}).get("Labels",{}).get("org.kova.recovery.owner"))
    require(binding==inventory.get("ociRuntimeBinding"),"operator_final_source_closure_mismatch")
    listed=run(["docker","image","ls","--format","{{json .}}",tag])
    require(not listed.strip(),"operator_load_tag_already_exists")
    run(["skopeo","copy","oci-archive:"+str(archive)+":operator-client","docker-daemon:"+tag],timeout=300)
    info=strict_json(run(["docker","image","inspect",tag]))
    require(type(info) is list and len(info)==1 and info[0].get("Id")==pin["imageId"],"loaded_operator_id_mismatch")
    return inventory


def target_bindings(plan,attestation,attestation_sha):
    host=attestation["host"]
    return {"KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED",
        "KOVA_AUTH_RESTORE_BASELINE_MODE":"empty-database",
        "KOVA_AUTH_BACKUP_ENCRYPTED_SHA256":plan["capture"]["ciphertextSha256"],
        "KOVA_APPROVED_BACKUP_SOURCE_SHA":plan["capture"]["sourceSha"],
        "APPROVED_ISOLATED_PG17_DATABASE_URL":"postgresql://"+base.OPERATOR+"@"+host+
            ":5432/postgres?sslmode=verify-full&sslrootcert="+quote("/run/client/ca.crt",safe="/"),
        "APPROVED_ISOLATED_HOST":host,"APPROVED_ISOLATED_DBNAME":"postgres","APPROVED_ISOLATED_PORT":"5432",
        "APPROVED_ISOLATED_SERVER_IP":attestation["serverIp"],
        "APPROVED_ISOLATED_SYSTEM_IDENTIFIER":attestation["systemIdentifier"],
        "PGPASSFILE":"/run/client/pgpass","KOVA_AUTH_RESTORE_ATTESTATION":"/run/client/attestation.json",
        "KOVA_AUTH_RESTORE_ATTESTATION_SHA256":attestation_sha}


class Coordinator:
    def __init__(self,env,manifest_file,manifest_sha,metadata_file,output):
        self.root=context(env);self.env=dict(env);self.probe=None;self.image_loaded=False
        self.output=Path(output);self.tag=None;self.private_root=None;self.stage="review-input";self.import_pending=False
        require(self.output.name=="receipt.json" and self.output.parent.resolve().is_relative_to(self.root)
                and not self.output.exists(),"reviewed_output_path_rejected")
        run_id,attempt=env.get("GITHUB_RUN_ID",""),env.get("GITHUB_RUN_ATTEMPT","")
        require(re.fullmatch(r"[1-9][0-9]*",run_id) and re.fullmatch(r"[1-9][0-9]*",attempt),"github_run_identity_missing")
        self.state_path=self.root/("kova-reviewed-owned-"+run_id+"-"+attempt+".json")
        require(not self.state_path.exists(),"reviewed_attempt_already_reserved")
        self.raw=private_file(manifest_file,64*1024)
        require(review.exact_hash(manifest_sha) and sha(self.raw)==manifest_sha,"reviewed_plan_hash_mismatch")
        self.manifest=strict_json(self.raw);self.manifest_sha=manifest_sha
        require(self.manifest.get("sourceSha")==env["GITHUB_SHA"],"reviewed_source_pin_mismatch")
        self.metadata=base.validate_metadata(strict_json(private_file(metadata_file,8*1024**2)),source_sha=env["GITHUB_SHA"])
        self.safe_env=sanitized_host_env(env)
        require(command(["git","rev-parse","HEAD"],self.safe_env,timeout=5).decode().strip()==env["GITHUB_SHA"],
                "reviewed_checkout_source_mismatch")

    def run(self,args,**kwargs):
        importing=args[:2]==["skopeo","copy"]
        if importing:self.import_pending=True;self.save_state()
        try:
            result=command(args,self.safe_env,**kwargs)
            if importing:self.import_pending=False;self.save_state()
            return result
        except HostCommandStopped as error:
            if importing and error.completed:self.import_pending=False;self.save_state()
            raise

    def save_state(self):
        value={"format":1,"sourceSha":self.env["GITHUB_SHA"],"runId":self.env["GITHUB_RUN_ID"],
            "attempt":self.env["GITHUB_RUN_ATTEMPT"],"uid":os.getuid(),"tag":self.tag,
            "expectedImageId":self.manifest["operatorClient"]["imageId"],"importPending":self.import_pending,
            "privateInputs":str(self.private_root) if self.private_root else None}
        if self.state_path.exists():
            old=strict_json(private_file(self.state_path,64*1024))
            require(all(old.get(k)==value[k] for k in ["sourceSha","runId","attempt","uid"]),"reviewed_owned_state_changed")
            temporary=self.state_path.with_name(self.state_path.name+".new")
            base.write_private(temporary,canonical(value));os.replace(temporary,self.state_path)
        else:base.write_private(self.state_path,canonical(value))

    def cleanup_image(self):
        require(not self.import_pending,"operator_import_outcome_unknown")
        if self.tag:
            # A successful census proves absence; inspect exit1 alone cannot.
            rows=self.run(["docker","image","ls","--no-trunc","--format","{{json .}}",self.tag])
            if rows.strip():
                loaded=strict_json(self.run(["docker","image","inspect",self.tag]))
                require(type(loaded) is list and len(loaded)==1
                        and loaded[0].get("Id")==self.manifest["operatorClient"]["imageId"],
                        "operator_cleanup_identity_changed")
                self.run(["docker","image","rm",self.tag])
                require(not self.run(["docker","image","ls","--no-trunc","--format","{{json .}}",self.tag]).strip(),
                        "operator_tag_removal_unconfirmed")
        return True

    def check_plan(self):
        return review.validated_plan(self.raw,self.manifest_sha,self.env,self.receipts,recipe_hashes())

    def qualify(self):
        reviewed=self.check_plan();plan=reviewed.value()
        clean={k:v for k,v in self.env.items() if k not in base.FORBIDDEN_ENV and not k.startswith("KOVA_PRODUCTION_")}
        clean["KOVA_EMPTY_PROBE_CONFIRMATION"]="PROBE_EMPTY_ONLY"
        p=native.OperatorProbe(self.metadata,clean,self.root/("unused-proof-"+self.env["GITHUB_RUN_ID"])/"receipt.json",
            operator_image_id=plan["operatorClient"]["imageId"],operator_source_sha=plan["operatorClient"]["sourceSha"],
            resources=plan.get("resources"))
        self.probe=p;p.save_state();p.initialize()
        p.private_root=Path(tempfile.mkdtemp(prefix="kova-empty-"+p.run_id+"-"+p.attempt+"-",dir=p.runner_temp))
        p.private_root.chmod(0o700)
        base.write_private(p.private_root/"ownership.json",base.encoded({"token":p.token,"source":p.source,"runId":p.run_id,"attempt":p.attempt}))
        p.save_state();p.make_private_files(p.private_root);p.create_network();p.start_container("client")
        snapshots=[];ids=[];systems=[]
        for key in ["a","b"]:
            info=p.start_container(key);ids.append(info["Id"]);p.static_ipv6_neighbors(key);p.prepare_native(key)
            system=p.tls_controls(key);systems.append(system);p.original_destination_guard(key,system);p.consumer_proof(key)
            snapshots.append(p.native_snapshot(key))
        require(len(set(ids))==len(set(systems))==2,"independent_native_targets_not_distinct")
        require(all(s["fingerprints"]==plan["reviewedBaselineFingerprints"]
                    and all(s[k] is True for k in ["roleMatch","namespaceMatch","extensionMatch"]) for s in snapshots),
                "reviewed_fresh_baseline_mismatch")
        require(self.metadata["sourceSettingsComplete"] is True and self.metadata["withheldSettingCount"]==0,
                "source_settings_incomplete")
        p.verify_effective_firewalls();p.denial_probes(base.denial_targets(self.metadata));p.verify_effective_firewalls()
        for key,old in zip(["a","b"],snapshots):
            p.inspect_and_recheck_runtime(key);p.consumer_proof(key)
            require(p.native_snapshot(key)["fingerprints"]==old["fingerprints"],"fresh_baseline_changed")
        p.inspect_and_recheck_runtime("client")
        actual={"observedAt":datetime.now(timezone.utc).isoformat(),
            "baselineFingerprints":snapshots[0]["fingerprints"],"clientImageId":p.operator_image_id,
            "clientInventorySha256":plan["operatorClient"]["inventorySha256"],
            "serverImageRepoDigest":p.server_image_qualification["actualRepoDigest"],
            "serverImageTransport":p.server_image_qualification,
            "networkEvidenceSha256":base.digest(base.encoded(p.network_evidence+p.neighbors)),
            "freshDistinctIdsCreated":True,"originalDestinationGuardPassed":True,"privateTlsIpv4Passed":True,
            "privateTlsIpv6Passed":True,"wrongCaRejected":True,"wrongHostnameRejected":True,
            "productionRoutesDenied":True,"internetEgressDenied":True,"consumersStopped":True,"allRowsEmpty":True,
            "privateTmpfsNoswapObserved":True,"containerSwapDisabledObserved":True,"cronLaunchActiveJobs":False,
            "target":{"host":p.hosts["a"],"database":"postgres","port":5432,
                "serverIp":p.addresses["a"][0],"systemIdentifier":systems[0]}}
        # Revalidate independent review immediately before binding fresh IDs.
        attestation=review.bound_fresh_attestation(self.check_plan(),actual)
        return plan,attestation

    def import_qualified(self,plan,attestation):
        p=self.probe
        ciphertext=self.paths["capture"]/"managed-auth-backup.tar.gpg"
        require(ciphertext.stat().st_size==plan["capture"]["ciphertextBytes"]
                and builder.file_sha(ciphertext)==plan["capture"]["ciphertextSha256"],"capture_ciphertext_hash_mismatch")
        destination=p.client_dir/"managed-auth-backup.tar.gpg"
        shutil.copyfile(ciphertext,destination);destination.chmod(0o600)
        raw=canonical(attestation);base.write_private(p.client_dir/"attestation.json",raw)
        bindings=target_bindings(plan,attestation,sha(raw));base.write_private(p.client_dir/"bindings.json",canonical(bindings))
        self.check_plan();p.verify_effective_firewalls();p.inspect_and_recheck_runtime("client")
        for key in ["a","b"]:p.inspect_and_recheck_runtime(key);p.consumer_proof(key)
        # Phrase enters only the qualified nonroot client's noswap /work. It is
        # never a Docker Config env, command argument or host plaintext file.
        require(0<=datetime.now(timezone.utc).timestamp()-review.timestamp(attestation["observedAt"])<=900,
                "fresh_native_evidence_stale")
        phrase=self.env.pop("KOVA_PRODUCTION_BACKUP_PASSPHRASE","")
        require(type(phrase) is str and len(phrase)>=32 and not any(c in phrase for c in "\r\n\x00"),"backup_passphrase_missing")
        writer="import os,sys; p='/work/phrase'; fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); v=sys.stdin.buffer.read(8193); assert 32<=len(v)<=8192 and not any(c in v for c in (b'\\n',b'\\r',b'\\0')); os.write(fd,v); os.close(fd)"
        p.docker(["exec","-i","--user",str(p.uid)+":"+str(p.gid),p.names["client"],p.client_tools["python3"],"-c",writer],data=phrase.encode())
        del phrase
        code,client_output=p.docker(["exec","--user",str(p.uid)+":"+str(p.gid),p.names["client"],p.client_tools["python3"],
            "/opt/kova/scripts/release/run-isolated-recovery-client.py","--execute","--bindings","/run/client/bindings.json",
            "--phrase-file","/work/phrase","--archive","/run/client/managed-auth-backup.tar.gpg",
            "--output","/work/restore-receipt.json","--engine-sha256",builder.file_sha(HERE/"managed-auth-recovery.py")],timeout=960,allow_failure=True)
        if code:
            try:
                failure=strict_json(client_output)
                if failure.get("stage") in recovery.PUBLIC_STAGES and failure.get("code") in recovery.PUBLIC_FAILURE_CODES:
                    self.client_failure={"stage":failure["stage"],"code":failure["code"]}
            except Exception:pass
            raise Stopped("private_client_restore_failed")
        _,raw=p.docker(["exec",p.names["client"],p.client_tools["python3"],"-c",
            "from pathlib import Path; import sys; p=Path('/work/restore-receipt.json'); assert p.stat().st_size<=65536; sys.stdout.buffer.write(p.read_bytes())"])
        result=strict_json(raw)
        require(result.get("operation")=="managed-auth-isolated-restore" and result.get("restoredDatabaseStateVerified") is True
                and result.get("tablesSequencesLargeObjectsVerified") is True
                and result.get("schemaOwnersPoliciesPrivilegesVerified") is True and result.get("extensionSemanticsVerified") is True
                and result.get("extensionSemanticCanonicalSha256")==plan["sourceCanonicalSemanticsSha256"]
                and result.get("actualImageRepoDigest")==attestation["actualImageRepoDigest"]
                and result.get("originalApprovedImageRepoDigest")==review.ORIGINAL_SERVER_IMAGE
                and result.get("serverImageTransportSha256")==attestation["serverImageTransportSha256"],
                "actual_restore_receipt_unqualified")
        p.verify_effective_firewalls()
        for key in ["client","a","b"]:p.inspect_and_recheck_runtime(key)
        for key in ["a","b"]:p.consumer_proof(key)
        return result

    def execute(self):
        result={"operation":"reviewed-private-empty-recovery","sourceSha":self.env["GITHUB_SHA"],
            "reviewedManifestSha256":self.manifest_sha,"restoreVerified":False,"productionMutated":False,
            "customerPlaintextUploaded":False,"cleanupConfirmed":False}
        try:
            self.private_root=Path(tempfile.mkdtemp(prefix="kova-reviewed-inputs-"+self.env["GITHUB_RUN_ID"]+"-"+self.env["GITHUB_RUN_ATTEMPT"]+"-",dir=self.root));self.private_root.chmod(0o700);self.save_state()
            self.stage="artifact-provenance";self.receipts,self.paths=fetch_artifacts(self.manifest,self.private_root,self.env)
            plan=self.check_plan().value()
            self.stage="operator-identity";self.tag="kova-reviewed-load:"+self.env["GITHUB_RUN_ID"]+"-"+self.env["GITHUB_RUN_ATTEMPT"]+"-"+os.urandom(5).hex();self.save_state()
            load_exact_operator(plan,self.paths,self.run,self.tag);self.image_loaded=True
            self.stage="fresh-native-qualification";plan,attestation=self.qualify()
            self.stage="qualified-private-restore";restored=self.import_qualified(plan,attestation)
            result.update(restoreVerified=True,sourceCanonicalSemanticsSha256=plan["sourceCanonicalSemanticsSha256"],
                targetIdentitySha256=sha(canonical({k:attestation[k] for k in ["host","database","port","serverIp","systemIdentifier"]})),
                clientImageId=plan["operatorClient"]["imageId"],serverImageRepoDigest=attestation["actualImageRepoDigest"],
                originalApprovedServerImageRepoDigest=review.ORIGINAL_SERVER_IMAGE,
                serverImageTransport=attestation["serverImageTransport"],
                serverImageTransportSha256=attestation["serverImageTransportSha256"],
                restoredFingerprintSha256=sha(canonical(restored)),networkEvidenceSha256=attestation["networkEvidenceSha256"])
        except Exception as error:
            # Only explicit fixed enums leave the private process.
            code=str(error) if isinstance(error,(Stopped,base.Stopped,builder.Stopped)) else ""
            result["errorCode"]=code if code in SAFE_FAILURE_CODES else "reviewed_private_recovery_unqualified"
            result["failedStage"]=self.stage
            if self.probe and getattr(self.probe,"stage",None) in SAFE_NATIVE_STAGES:
                result["nativeStage"]=self.probe.stage
            if getattr(self,"client_failure",None):result["clientFailure"]=self.client_failure
        finally:
            try:safe=self.probe.cleanup() if self.probe else True
            except Exception:safe=False
            if safe:
                try:self.cleanup_image()
                except Exception:safe=False
            if safe and self.private_root:
                try:shutil.rmtree(self.private_root)
                except Exception:safe=False
            result["cleanupConfirmed"]=bool(safe)
            if not safe:result["cleanupErrorCode"]="owned_cleanup_unconfirmed";result["restoreVerified"]=False
            result["checkedAtUtc"]=datetime.now(timezone.utc).isoformat()
            self.output.parent.mkdir(mode=0o700,parents=True,exist_ok=True);base.write_private(self.output,canonical(result))
        return result


def cleanup_from_state(env):
    root=context(env);run_id,attempt=env.get("GITHUB_RUN_ID",""),env.get("GITHUB_RUN_ATTEMPT","")
    require(re.fullmatch(r"[1-9][0-9]*",run_id) and re.fullmatch(r"[1-9][0-9]*",attempt),"github_run_identity_missing")
    clean={k:v for k,v in env.items() if k not in base.FORBIDDEN_ENV and not k.startswith("KOVA_PRODUCTION_")}
    clean["KOVA_EMPTY_PROBE_CONFIRMATION"]="PROBE_EMPTY_ONLY"
    try:safe=native.cleanup_operator_state(clean)
    except Exception:safe=False
    path=root/("kova-reviewed-owned-"+run_id+"-"+attempt+".json")
    if not path.exists():return safe
    state=strict_json(private_file(path,64*1024))
    require(state.get("format")==1 and state.get("sourceSha")==env["GITHUB_SHA"]
            and state.get("runId")==run_id and state.get("attempt")==attempt and state.get("uid")==os.getuid()
            and type(state.get("importPending")) is bool,"reviewed_cleanup_state_unqualified")
    require(state.get("tag") is None or re.fullmatch("kova-reviewed-load:"+run_id+"-"+attempt+r"-[a-f0-9]{10}",state["tag"]),
            "reviewed_cleanup_tag_unqualified")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}",state.get("expectedImageId","")),"reviewed_cleanup_image_unqualified")
    p=object.__new__(Coordinator);p.tag=state["tag"];p.import_pending=state["importPending"]
    p.safe_env=sanitized_host_env(env);p.manifest={"operatorClient":{"imageId":state["expectedImageId"]}}
    if safe:
        try:p.cleanup_image()
        except Exception:safe=False
    if safe and state.get("privateInputs"):
        folder=Path(state["privateInputs"])
        require(folder.parent.resolve()==root and re.fullmatch("kova-reviewed-inputs-"+run_id+"-"+attempt+r"-[a-z0-9_]+",folder.name)
                and not folder.is_symlink(),"reviewed_cleanup_path_unqualified")
        if folder.exists():
            info=folder.lstat();require(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid(),"reviewed_cleanup_owner_unqualified")
            shutil.rmtree(folder)
    return safe


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--execute",action="store_true");parser.add_argument("--cleanup-only",action="store_true")
    parser.add_argument("--manifest");parser.add_argument("--manifest-sha256")
    parser.add_argument("--metadata");parser.add_argument("--output")
    args=parser.parse_args()
    if args.cleanup_only:
        require(not args.execute and not any([args.manifest,args.manifest_sha256,args.metadata,args.output]),"cleanup_mode_mixed")
        require(cleanup_from_state(os.environ),"owned_cleanup_unconfirmed")
        print('{"ok":true,"ownedCleanupConfirmed":true}');return
    require(args.execute and all([args.manifest,args.manifest_sha256,args.metadata,args.output]),"explicit_execution_required")
    result=Coordinator(os.environ,args.manifest,args.manifest_sha256,args.metadata,args.output).execute()
    print(json.dumps({"ok":result["restoreVerified"] and result["cleanupConfirmed"],"receiptWritten":True},separators=(",",":")))
    if not result["restoreVerified"] or not result["cleanupConfirmed"]:raise SystemExit(1)


if __name__=="__main__":
    def interrupted(*_):raise Stopped("reviewed_recovery_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception:
        print('{"ok":false,"error":"reviewed_private_recovery_unqualified"}')
        raise SystemExit(1)
