#!/usr/bin/env python3
"""Build and archive generic tooling before all production/recovery inputs.

This never prepares a database, receives ciphertext/passphrase, or performs a
restore. The measured OCI artifact is generic and must be pinned, reviewed and
requalified with the final target/network policy before sensitive use.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/"scripts/release"
spec=importlib.util.spec_from_file_location("operator_owned_ram_volumes",SOURCE/"owned-noswap-volumes.py")
ram=importlib.util.module_from_spec(spec);spec.loader.exec_module(ram)
spec=importlib.util.spec_from_file_location("operator_ram_kernel_proof",SOURCE/"noswap-volume-proof.py")
volume_proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(volume_proof)
BASE_TAG="ubuntu:24.04"
KEY_FINGERPRINT="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"
UBUNTU_KEY_FINGERPRINT="F6ECB3762474EDA9D21B7022871920D1991BC93C"
FILES=["managed-auth-recovery.py","managed-auth-recovery-target.mjs","verify-isolated-restore-target.mjs",
       "empty-restore-target-catalog.sql","recovery-operator-client-smoke.py","run-isolated-recovery-client.py",
       "extension-semantic-capture.py","extension-routine-type-payloads.py",
       "extension-routine-type-hash-query.py","extension-relation-payloads.py",
       "extension-relation-query-hooks.py","pg17-extension-relation-manifest.json",
       "canonicalize-pg17-extension-nodes.py","pg17-extension-node-schema.json",
       "extension-regclass-datum-byteorder-audit.sql"]
SAFE_HOST_ENV={"PATH","HOME","LANG","LC_ALL","TZ","TMPDIR","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY",
               "NO_PROXY","http_proxy","https_proxy","all_proxy","no_proxy","SSL_CERT_FILE","SSL_CERT_DIR"}
SENSITIVE_KEYS={"KOVA_PRODUCTION_DATABASE_URL","KOVA_PRODUCTION_BACKUP_PASSPHRASE","PGPASSWORD",
                "OPENAI_API_KEY","ELEVENLABS_API_KEY","RESEND_API_KEY","SUPABASE_SERVICE_ROLE_KEY",
                "KOVA_AUTH_JWT_PRIVATE_KEY","KOVA_AUTH_ENCRYPTION_KEY"}
MAX_ARCHIVE_BYTES=4*1024**3
MAX_INVENTORY_BYTES=16*1024**2


class Stopped(Exception):pass


PUBLIC_FAILURE_CODES=frozenset({
    'base_image_identity_unconfirmed',
    'built_client_identity_unconfirmed',
    'checked_out_source_mismatch',
    'data_free_image_native_command_unconfirmed',
    'explicit_execution_required',
    'foreign_image_cleanup_forbidden',
    'generic_dockerfile_unqualified',
    'generic_image_cleanup_identity_unconfirmed',
    'generic_image_cleanup_unconfirmed',
    'generic_image_run_identity_required',
    'generic_inventory_bound',
    'generic_loaded_image_identity_unqualified',
    'generic_oci_archive_size_unqualified',
    'generic_ram_kernel_proof_unconfirmed',
    'generic_ram_volume_cleanup_unconfirmed',
    'generic_roundtrip_tag_already_exists',
    'generic_source_file_unqualified',
    'github_main_dispatch_required',
    'image_generic_source_changed',
    'native_client_smoke_unqualified',
    'native_package_inventory_unqualified',
    'native_tool_inventory_incomplete',
    'native_tool_inventory_unqualified',
    'nonroot_host_runner_required',
    'oci_archive_image_config_mismatch',
    'oci_archive_layout_unconfirmed',
    'oci_archive_manifest_ambiguous',
    'oci_archive_manifest_digest_missing',
    'oci_archive_manifest_integrity_failed',
    'oci_blob_descriptor_unqualified',
    'oci_blob_integrity_failed',
    'oci_blob_size_mismatch',
    'oci_build_healthcheck_not_disabled',
    'oci_docker_build_metadata_unqualified',
    'oci_docker_host_config_unqualified',
    'oci_docker_interactive_config_unqualified',
    'oci_docker_security_hook_unqualified',
    'oci_environment_not_generic',
    'oci_generic_ports_or_volumes_unqualified',
    'oci_image_platform_changed',
    'oci_layout_version_unqualified',
    'oci_metadata_bound',
    'oci_metadata_shape_unqualified',
    'oci_rootfs_changed',
    'oci_runtime_array_unqualified',
    'oci_runtime_boolean_unqualified',
    'oci_runtime_config_changed',
    'oci_runtime_config_shape_unqualified',
    'oci_runtime_labels_unqualified',
    'oci_runtime_map_unqualified',
    'oci_runtime_string_unqualified',
    'oci_source_binding_unqualified',
    'official_ubuntu_amd64_digest_unconfirmed',
    'owned_volume_activated_runtime_unconfirmed',
    'owned_volume_attempt_reserved',
    'owned_volume_census_unqualified',
    'owned_volume_cleanup_recipe_unqualified',
    'owned_volume_cleanup_state_unqualified',
    'owned_volume_command_output_unqualified',
    'owned_volume_command_unconfirmed',
    'owned_volume_configuration_changed',
    'owned_volume_container_mount_unqualified',
    'owned_volume_container_references_present',
    'owned_volume_context_unqualified',
    'owned_volume_create_unconfirmed',
    'owned_volume_creation_outcome_unknown',
    'owned_volume_creation_unconfirmed',
    'owned_volume_destination_unqualified',
    'owned_volume_duplicate_json_key',
    'owned_volume_existing_plan_unqualified',
    'owned_volume_identity_unqualified',
    'owned_volume_inspect_unqualified',
    'owned_volume_json_unqualified',
    'owned_volume_mode_unqualified',
    'owned_volume_mount_count_unqualified',
    'owned_volume_mount_keys_unqualified',
    'owned_volume_name_not_absent',
    'owned_volume_recipe_unqualified',
    'owned_volume_removal_unconfirmed',
    'owned_volume_runtime_identity_changed',
    'owned_volume_runtime_shape_unqualified',
    'owned_volume_runtime_state_unqualified',
    'owned_volume_state_bound',
    'owned_volume_state_changed',
    'owned_volume_state_identity_changed',
    'owned_volume_state_private_required',
    'package_inventory_changed',
    'pg17_client_required',
    'private_image_output_unqualified',
    'reviewed_source_pin_required',
    'runner_temporary_directory_required',
    'sensitive_input_in_image_preparation',
    'volume_mountinfo_bound',
    'volume_mountinfo_duplicate_id',
    'volume_mountinfo_escape_unqualified',
    'volume_mountinfo_shape',
    'volume_runtime_capability_or_swap_unqualified',
    'volume_runtime_capacity_mismatch',
    'volume_runtime_descendant_mount',
    'volume_runtime_mount_missing_or_shadowed',
    'volume_runtime_mount_policy_unqualified',
    'volume_runtime_output_bound',
    'volume_runtime_output_duplicate',
    'volume_runtime_output_unqualified',
    'volume_runtime_owner_mode_or_device_mismatch',
    'volume_runtime_root_not_readonly',
    'volume_runtime_shared_superblock',
    'volume_runtime_specs_duplicate',
    'volume_runtime_specs_unqualified',
    'volume_runtime_stat_coverage',
    'volume_runtime_stat_unqualified',
})
PUBLIC_STAGES=frozenset({
    'base-inspect',
    'base-pull',
    'build-context',
    'client-identity',
    'docker-build',
    'image-cleanup',
    'loaded-client-identity',
    'native-smoke',
    'oci-export',
    'oci-load',
    'oci-verification',
    'package-inventory',
    'ram-cleanup',
    'receipt',
    'setup',
    'source-check',
    'source-hashes',
})
DOCKER_BUILD_STAGES=frozenset({
    'apt-cache-clean',
    'build-temporary-clean',
    'pg17-candidate-query',
    'pg17-client-install',
    'pg17-version-guard',
    'pgdg-index-refresh',
    'pgdg-key-count-guard',
    'pgdg-key-directory',
    'pgdg-key-download',
    'pgdg-key-fingerprint-guard',
    'pgdg-key-read',
    'pgdg-source-write',
    'sbom-directory',
    'sbom-package-query',
    'sbom-release-copy',
    'ubuntu-architecture-guard',
    'ubuntu-candidate-bash',
    'ubuntu-candidate-ca-certificates',
    'ubuntu-candidate-coreutils',
    'ubuntu-candidate-curl',
    'ubuntu-candidate-gnupg',
    'ubuntu-candidate-nodejs',
    'ubuntu-candidate-python3',
    'ubuntu-enable-https',
    'ubuntu-index-refresh',
    'ubuntu-insecure-source-guard',
    'ubuntu-legacy-sources-empty-guard',
    'ubuntu-official-uris-guard',
    'ubuntu-package-candidate-query',
    'ubuntu-package-list',
    'ubuntu-package-loop',
    'ubuntu-package-select',
    'ubuntu-package-version-guard',
    'ubuntu-packages-install',
    'ubuntu-release-guard',
    'ubuntu-release-read',
    'ubuntu-scope-signing-key',
    'ubuntu-signed-by-guard',
    'ubuntu-source-count-guard',
    'ubuntu-source-glob',
    'ubuntu-sources-present-guard',
})


def public_failure(error):
    code=str(error) if isinstance(error,(Stopped,ram.Stopped,volume_proof.Stopped)) else ''
    value={'ok':False,'error':'data_free_operator_image_unqualified',
           'code':code if code in PUBLIC_FAILURE_CODES else 'unclassified_private_failure',
           'stage':getattr(error,'public_stage','setup')}
    if type(value['stage']) is not str or value['stage'] not in PUBLIC_STAGES:value['stage']='setup'
    details=getattr(error,'command_details',None)
    if type(details) is dict and type(details.get('status')) is str and details.get('status') in {'exit','signal','timeout','os-error','output-bound'}:
        value['command']={'status':details['status']}
        exit_code=details.get('exitCode')
        if type(exit_code) is int and -255<=exit_code<=255:value['command']['exitCode']=exit_code
        marker=details.get('dockerBuildStage')
        if type(marker) is str and marker in DOCKER_BUILD_STAGES:value['command']['dockerBuildStage']=marker
    return value


def native_failure(status,exit_code=None,stderr=b''):
    error=Stopped('data_free_image_native_command_unconfirmed')
    details={'status':status,'exitCode':exit_code}
    for line in stderr.splitlines():
        match=re.fullmatch(rb'#[0-9]+[ \t]+[0-9]+(?:\.[0-9]+)?[ \t]+KOVA_OPERATOR_STAGE=([a-z0-9-]+)',line)
        if match and match[1].decode('ascii') in DOCKER_BUILD_STAGES:
            details['dockerBuildStage']=match[1].decode('ascii')
    error.command_details=details
    return error


def require(condition,code):
    if not condition:raise Stopped(code)


def canonical(value):return (json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()
def sha(data):return hashlib.sha256(data).hexdigest()


def file_sha(path):
    value=hashlib.sha256()
    with Path(path).open("rb") as source:
        while block:=source.read(1024**2):value.update(block)
    return value.hexdigest()


def context(env):
    source=env.get("GITHUB_SHA","")
    require(env.get("GITHUB_ACTIONS")=="true" and env.get("RUNNER_OS")=="Linux"
            and env.get("GITHUB_EVENT_NAME")=="workflow_dispatch"
            and env.get("GITHUB_REPOSITORY")=="Blockigaming/KovaGPT"
            and env.get("GITHUB_REF")=="refs/heads/main","github_main_dispatch_required")
    require(env.get("KOVA_OPERATOR_IMAGE_CONFIRMATION")=="BUILD_DATA_FREE_OPERATOR_IMAGE"
            and re.fullmatch(r"[a-f0-9]{40}",source)
            and env.get("KOVA_APPROVED_SOURCE_SHA")==source,"reviewed_source_pin_required")
    forbidden={k for k in env if k in SENSITIVE_KEYS or k.startswith("KOVA_PRODUCTION_")
               or k.startswith("APPROVED_ISOLATED_") or k.startswith("KOVA_AUTH_RESTORE_")}
    require(not any(env.get(k) for k in forbidden),"sensitive_input_in_image_preparation")
    return source


def measured_base(info):
    require(isinstance(info,list) and len(info)==1,"base_image_identity_unconfirmed")
    image=info[0]
    digests=[x for x in image.get("RepoDigests",[]) if re.fullmatch(r"ubuntu@sha256:[a-f0-9]{64}",x)]
    require(image.get("Os")=="linux" and image.get("Architecture")=="amd64"
            and len(digests)==1 and re.fullmatch(r"sha256:[a-f0-9]{64}",image.get("Id","")),
            "official_ubuntu_amd64_digest_unconfirmed")
    return digests[0],image["Id"]


def source_context(directory):
    """Only the reviewed generic source allowlist enters Docker build context."""
    path=Path(directory);(path/"source").mkdir(mode=0o755)
    # COPY preserves these reviewed public-code modes into the nonroot image;
    # the enclosing host context stays private and contains no runtime inputs.
    (path/"source").chmod(0o755)
    source_hashes={}
    for name in FILES:
        item=SOURCE/name
        require(item.is_file() and not item.is_symlink(),"generic_source_file_unqualified")
        shutil.copyfile(item,path/"source"/name);(path/"source"/name).chmod(0o644);source_hashes[name]=file_sha(item)
    dockerfile=SOURCE/"recovery-operator-client.Dockerfile"
    require(dockerfile.is_file() and not dockerfile.is_symlink(),"generic_dockerfile_unqualified")
    shutil.copyfile(dockerfile,path/"Dockerfile");(path/"Dockerfile").chmod(0o644)
    source_hashes["recovery-operator-client.Dockerfile"]=file_sha(dockerfile)
    return source_hashes


OCI_RUNTIME_KEYS=frozenset({"User","ExposedPorts","Env","Entrypoint","Cmd","Volumes",
    "WorkingDir","Labels","StopSignal","ArgsEscaped"})
DOCKER_BUILD_ONLY_KEYS=frozenset({"Healthcheck","Shell","OnBuild","Image","Hostname","Domainname",
    "AttachStdin","AttachStdout","AttachStderr","Tty","OpenStdin","StdinOnce"})


def runtime_config_projection(config,*,oci):
    """Only the documented OCI omitempty defaults are normalized.

    All runtime fields and all rootfs diff IDs are compared separately. The
    known Docker-only build fields must be inert before transport drops them.
    This function never rewrites a config or manufactures an image identity.
    """
    require(type(config) is dict and set(config)<=OCI_RUNTIME_KEYS|(set() if oci else DOCKER_BUILD_ONLY_KEYS),
            "oci_runtime_config_shape_unqualified")
    if not oci:
        health=config.get("Healthcheck")
        require(health is None or (type(health) is dict and health.get("Test")==["NONE"]
            and set(health)<={"Test","Interval","Timeout","StartPeriod","StartInterval","Retries"}
            and all(type(v) is int and v==0 for k,v in health.items() if k!="Test")),
            "oci_docker_security_hook_unqualified")
        require(config.get("OnBuild") in (None,[]) and config.get("Shell") in
                (None,[],["/bin/bash","-o","pipefail","-ceu"]),"oci_docker_security_hook_unqualified")
        for key in {"AttachStdin","AttachStdout","AttachStderr","Tty","OpenStdin","StdinOnce"}:
            require(key not in config or config[key] is False,"oci_docker_interactive_config_unqualified")
        for key in {"Hostname","Domainname"}:
            require(key not in config or config[key]=="","oci_docker_host_config_unqualified")
        image=config.get("Image","")
        require(type(image) is str and (image=="" or re.fullmatch(r"sha256:[a-f0-9]{64}",image)),
                "oci_docker_build_metadata_unqualified")
    projected={}
    for key in {"User","WorkingDir","StopSignal"}:
        value=config.get(key,"")
        require(type(value) is str and len(value)<=4096,"oci_runtime_string_unqualified")
        projected[key]=value
    for key in {"Env","Entrypoint","Cmd"}:
        value=config.get(key,[])
        if value is None and not oci:value=[]
        require(type(value) is list and len(value)<=256
                and all(type(v) is str and len(v)<=65536 for v in value),"oci_runtime_array_unqualified")
        projected[key]=value
    for key in {"ExposedPorts","Volumes","Labels"}:
        value=config.get(key,{})
        if value is None and not oci:value={}
        require(type(value) is dict and len(value)<=256,"oci_runtime_map_unqualified")
        if key=="Labels":
            require(all(type(k) is str and type(v) is str for k,v in value.items()),"oci_runtime_labels_unqualified")
        else:require(not value,"oci_generic_ports_or_volumes_unqualified")
        projected[key]=value
    value=config.get("ArgsEscaped",False)
    require(type(value) is bool,"oci_runtime_boolean_unqualified")
    projected["ArgsEscaped"]=value
    keys=[value.split("=",1)[0] for value in projected["Env"]]
    require(all("=" in value for value in projected["Env"]) and len(keys)==len(set(keys))
            and set(keys)<={"PATH","LANG","LC_ALL","TZ","PYTHONDONTWRITEBYTECODE"},
            "oci_environment_not_generic")
    return projected


def verify_oci_runtime_binding(built,document,*,source_sha,owner):
    """Bind the converted OCI runtime to the measured Docker build, not its old JSON digest."""
    require(type(built) is dict and type(document) is dict
            and re.fullmatch(r"[a-f0-9]{40}",source_sha or "")
            and re.fullmatch(r"[a-f0-9]{24}",owner or ""),"oci_source_binding_unqualified")
    require(set(document)<={"architecture","os","config","rootfs","history","created","author",
                "variant","os.version","os.features"}
            and built.get("Architecture")==document.get("architecture")=="amd64"
            and built.get("Os")==document.get("os")=="linux"
            and document.get("variant","")==document.get("os.version","")==""
            and document.get("os.features",[])==[],"oci_image_platform_changed")
    before=runtime_config_projection(built.get("Config"),oci=False)
    after=runtime_config_projection(document.get("config"),oci=True)
    require(before==after,"oci_runtime_config_changed")
    require(before["User"]=="65532:65532"
            and before["Labels"].get("org.opencontainers.image.revision")==source_sha
            and before["Labels"].get("org.kova.recovery.owner")==owner,"oci_source_binding_unqualified")
    health=built.get("Config",{}).get("Healthcheck")
    require(type(health) is dict and health.get("Test")==["NONE"],"oci_build_healthcheck_not_disabled")
    root=built.get("RootFS");converted=document.get("rootfs")
    require(type(root) is dict and set(root)=={"Type","Layers"} and root.get("Type")=="layers"
            and type(root.get("Layers")) is list and 0<len(root["Layers"])<=256
            and all(type(v) is str and re.fullmatch(r"sha256:[a-f0-9]{64}",v) for v in root["Layers"])
            and type(converted) is dict and set(converted)=={"type","diff_ids"}
            and converted=={"type":"layers","diff_ids":root["Layers"]},"oci_rootfs_changed")
    for key in {"created","author"}:
        require(key not in document or type(document[key]) is str,"oci_metadata_shape_unqualified")
    history=document.get("history",[])
    require(type(history) is list and len(history)<=4096 and all(type(v) is dict
            and set(v)<={"created","created_by","author","comment","empty_layer"}
            and all(type(x) is (bool if k=="empty_layer" else str) for k,x in v.items()) for v in history),
            "oci_metadata_shape_unqualified")
    content={"architecture":"amd64","os":"linux","config":before,"rootfs":converted}
    return {"operation":"oci-runtime-config-binding","sourceSha":source_sha,
            "runtimeAndRootfsSha256":sha(canonical(content)),"allRuntimeFieldsPreserved":True,
            "allRootfsDiffIdsPreserved":True,"buildHealthcheckDisabled":True,
            "archiveHealthcheckAbsent":True,"configurationRewrittenLocally":False,
            "nativeLoadAndToolSmokeRequired":True}


def check_smoke(value):
    require(isinstance(value,dict) and value.get("operation")=="generic-recovery-client-native-smoke"
            and all(value.get(k) is True for k in ["nonroot","nativePythonEngineImport","nativeNodeDestinationGuard",
                       "nativeFileBoundLauncherImport","nodePasswordOverrideRejected","syntheticGpgRoundtrip",
                       "wrongGpgPassphraseRejected","readonlyRootObserved","noNewPrivilegesObserved",
                       "capabilitiesDroppedObserved","tmpfsNoSwapObserved","memorySwapDisabledObserved",
                       "nativeSemanticDependencyClosureLoaded"])
            and all(value.get(k) is False for k in ["actualTargetConnected","customerRowsUsed","restorePerformed"]),
            "native_client_smoke_unqualified")
    require(len(value.get("tools",[]))==9 and {r.get("name") for r in value.get("tools",[])}==
            {"python3","node","gpg","psql","pg_dump","pg_restore","timeout","bash","sha256sum"},
            "native_tool_inventory_incomplete")
    for row in value["tools"]:
        require(re.fullmatch(r"[a-f0-9]{64}",row.get("sha256","")) and row.get("path","").startswith("/")
                and isinstance(row.get("version"),str) and row["version"],"native_tool_inventory_unqualified")
        if row["name"] in {"psql","pg_dump","pg_restore"}:
            require(re.match(re.escape(row["name"])+r" \(PostgreSQL\) 17\.",row["version"]),"pg17_client_required")
    require(type(value.get("installedPackageCount")) is int and value["installedPackageCount"]>0
            and re.fullmatch(r"[a-f0-9]{64}",value.get("packageInventorySha256",""))
            and value.get("signedInReleaseFiles"),"native_package_inventory_unqualified")
    return value


def inspect_oci(archive):
    """Verify OCI layout and the complete manifest/config/layer digest chain."""
    with tarfile.open(archive,"r:") as package:
        members=package.getmembers();names=[item.name for item in members]
        require(len(members)<=4096 and len(names)==len(set(names))
                and all(item.isdir() or item.isfile() for item in members)
                and all(not name.startswith("/") and ".." not in Path(name).parts for name in names)
                and {"oci-layout","index.json"}<=set(names),"oci_archive_layout_unconfirmed")
        def small(name,limit):
            member=package.getmember(name)
            require(member.isfile() and 0<member.size<=limit,"oci_metadata_bound")
            return package.extractfile(member).read(limit+1)
        require(json.loads(small("oci-layout",4096)).get("imageLayoutVersion")=="1.0.0","oci_layout_version_unqualified")
        index=json.loads(small("index.json",1024**2))
        require(index.get("schemaVersion")==2 and len(index.get("manifests",[]))==1,"oci_archive_manifest_ambiguous")
        descriptor=index["manifests"][0];manifest_digest=descriptor.get("digest","")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}",manifest_digest),"oci_archive_manifest_digest_missing")
        raw=small("blobs/sha256/"+manifest_digest.split(":")[1],1024**2)
        require("sha256:"+sha(raw)==manifest_digest and len(raw)==descriptor.get("size"),"oci_archive_manifest_integrity_failed")
        manifest=json.loads(raw)
        require(manifest.get("schemaVersion")==2 and type(manifest.get("config")) is dict
                and re.fullmatch(r"sha256:[a-f0-9]{64}",manifest["config"].get("digest",""))
                and isinstance(manifest.get("layers"),list),"oci_archive_image_config_mismatch")
        for blob in [manifest["config"],*manifest["layers"]]:
            digest=blob.get("digest","")
            require(re.fullmatch(r"sha256:[a-f0-9]{64}",digest)
                    and type(blob.get("size")) is int and 0<blob["size"]<=MAX_ARCHIVE_BYTES,"oci_blob_descriptor_unqualified")
            member=package.getmember("blobs/sha256/"+digest.split(":")[1])
            require(member.isfile() and member.size==blob["size"],"oci_blob_size_mismatch")
            value=hashlib.sha256()
            with package.extractfile(member) as stream:
                while block:=stream.read(1024**2):value.update(block)
            require("sha256:"+value.hexdigest()==digest,"oci_blob_integrity_failed")
        config_digest=manifest["config"]["digest"]
        config_bytes=small("blobs/sha256/"+config_digest.split(":")[1],1024**2)
        return {"manifestDigest":manifest_digest,"configDigest":config_digest,"configBytes":config_bytes}


def oci_identity(archive,expected_image_id):
    value=inspect_oci(archive)
    require(value["configDigest"]==expected_image_id,"oci_archive_image_config_mismatch")
    return value["manifestDigest"]


def image_healthcheck_disabled(config):
    if type(config) is not dict:return False
    if "Healthcheck" not in config:return True
    value=config["Healthcheck"]
    return (type(value) is dict and value.get("Test")==["NONE"]
            and set(value)<={"Test","Interval","Timeout","StartPeriod","StartInterval","Retries"}
            and all(type(v) is int and v==0 for k,v in value.items() if k!="Test"))


class Builder:
    def __init__(self,env,output):
        self.stage="setup"
        self.source=context(env)
        self.env={k:v for k,v in env.items() if k in SAFE_HOST_ENV}
        self.temp=Path(env.get("RUNNER_TEMP","")).resolve()
        require(self.temp.is_dir() and self.temp!=Path("/"),"runner_temporary_directory_required")
        self.output=Path(output)
        require(self.output.is_absolute() and self.output.resolve().is_relative_to(self.temp)
                and self.output.name=="operator-client-image" and not self.output.exists()
                and not self.output.is_symlink(),"private_image_output_unqualified")
        self.owner=secrets.token_hex(12);self.tag="kova-recovery-operator:"+self.owner
        self.roundtrip_tag="localhost/kova-recovery-operator-oci:"+self.owner
        self.build_image_id=None
        self.image_id=None
        self.run_id=env.get("GITHUB_RUN_ID","");self.attempt=env.get("GITHUB_RUN_ATTEMPT","")
        require(re.fullmatch(r"[1-9][0-9]*",self.run_id) and re.fullmatch(r"[1-9][0-9]*",self.attempt),
                "generic_image_run_identity_required")
        self.ram_volumes=None;self.ram_index=0;self.last_ram_keys=[]

    def command(self,argv,*,timeout=120,data=None):
        try:
            with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
                result=subprocess.run(argv,input=data,stdout=out,stderr=err,env=self.env,timeout=timeout,check=False)
                bounded=out.tell()<=64*1024**2 and err.tell()<=64*1024**2
                if result.returncode!=0 or not bounded:
                    err.seek(0)
                    stderr=err.read(64*1024**2) if bounded and argv[:2]==["docker","build"] else b""
                    status="output-bound" if not bounded else ("signal" if result.returncode<0 else "exit")
                    raise native_failure(status,result.returncode,stderr)
                out.seek(0);return out.read()
        except subprocess.TimeoutExpired:raise native_failure("timeout") from None
        except (OSError,subprocess.SubprocessError):raise native_failure("os-error") from None

    def owned_ram(self):
        if self.ram_volumes is None:
            self.ram_volumes=ram.OwnedVolumes(self.source,self.owner,self.run_id,self.attempt,self.temp,self.command)
        return self.ram_volumes

    def run_args(self):
        key="builder"+str(self.ram_index)+"-tmp";self.ram_index+=1;self.last_ram_keys=[key]
        tmp=self.owned_ram().ensure(key,"/tmp",128,os.getuid(),os.getgid(),"1777")
        return ["docker","run","--rm","--name","kova-builder-smoke-"+self.owner,"--log-driver","none",
                "--label","kova.ram.owner="+self.owner,"--no-healthcheck","--network","none","--cap-drop","ALL",
                "--security-opt","no-new-privileges:true","--read-only","--user",str(os.getuid())+":"+str(os.getgid()),
                "--cgroupns","private",
                "--pids-limit","128","--memory","768m","--memory-swap","768m","--cpus","1",
                "--mount",tmp,self.image_id]

    def run_generic(self,args):
        specs=self.owned_ram().expected_mounts(self.last_ram_keys)
        self.owned_ram().record_activation(self.last_ram_keys)
        index=args.index(self.image_id);options=args[:index];command=args[index+1:]
        if "--entrypoint" in options:
            entry=options.index("--entrypoint");original=[options[entry+1]];del options[entry:entry+2]
        else:original=["python3","/opt/kova/scripts/release/recovery-operator-client-smoke.py"]
        wrapper="""proof=$1; count=$2; shift 2
paths=( "${@:1:count}" ); shift "$count"
printf '%s\n' KOVA_PRIVATE_RAM_PROOF_BEGIN
/bin/bash -ceu "$proof" kova-private-ram-check "${paths[@]}"
printf '%s\n' KOVA_PRIVATE_RAM_PROOF_END
exec "$@"
""".replace("\n+","\n")
        raw=self.command(options+["--entrypoint","/bin/bash",self.image_id,"-ceu",wrapper,"kova-builder-ram-proof",
            volume_proof.runtime_proof_script(),str(len(specs)),*[s["destination"] for s in specs],*original,*command],timeout=90)
        begin=b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n";end=b"KOVA_PRIVATE_RAM_PROOF_END\n"
        require(raw.startswith(begin) and raw.count(end)==1,"generic_ram_kernel_proof_unconfirmed")
        proof,stdout=raw[len(begin):].split(end,1)
        observed=volume_proof.validate_runtime_proof(proof,specs)
        self.owned_ram().record_runtime_proof(observed["records"])
        return stdout

    def cleanup_storage(self):
        if self.ram_volumes is None:return True
        return self.ram_volumes.cleanup()

    def cleanup_image(self):
        # Generic image only; never remove a foreign tag or invoke global prune.
        for tag in [self.tag,*([self.roundtrip_tag] if getattr(self,"roundtrip_tag",None) else [])]:
            raw=self.command(["docker","image","ls","--no-trunc","--filter","reference="+tag,"--format","{{json .}}"])
            rows=[json.loads(line) for line in raw.splitlines()]
            if not rows:continue
            require(len(rows)==1 and rows[0].get("Repository")+":"+rows[0].get("Tag")==tag,
                    "generic_image_cleanup_identity_unconfirmed")
            actual=json.loads(self.command(["docker","image","inspect",tag]))[0]
            require(actual.get("Config",{}).get("Labels",{}).get("org.kova.recovery.owner")==self.owner
                    and actual.get("Config",{}).get("Labels",{}).get("org.opencontainers.image.revision")==self.source,
                    "foreign_image_cleanup_forbidden")
            self.command(["docker","image","rm",tag])
            after=self.command(["docker","image","ls","--filter","reference="+tag,"--format","{{json .}}"])
            require(not after.strip(),"generic_image_cleanup_unconfirmed")
        return True

    def archive_roundtrip(self,built):
        self.build_image_id=self.image_id
        archive=self.output/"operator-client.oci.tar"
        self.stage="oci-export"
        self.command(["skopeo","copy","docker-daemon:"+self.tag,"oci-archive:"+str(archive)+":operator-client"],timeout=300)
        self.stage="oci-verification"
        require(archive.is_file() and 0<archive.stat().st_size<=MAX_ARCHIVE_BYTES,"generic_oci_archive_size_unqualified")
        measured=inspect_oci(archive)
        document=json.loads(measured["configBytes"])
        binding=verify_oci_runtime_binding(built,document,source_sha=self.source,owner=self.owner)
        # The destination image ID is measured from the actual OCI config bytes.
        # Native Skopeo/Docker must materialize it successfully before any smoke
        # or receipt; no config or layer is rewritten by this Python code.
        self.stage="oci-load"
        listed=self.command(["docker","image","ls","--filter","reference="+self.roundtrip_tag,"--format","{{json .}}"])
        require(not listed.strip(),"generic_roundtrip_tag_already_exists")
        self.command(["skopeo","copy","oci-archive:"+str(archive)+":operator-client",
                      "docker-daemon:"+self.roundtrip_tag],timeout=300)
        self.stage="loaded-client-identity"
        values=json.loads(self.command(["docker","image","inspect",self.roundtrip_tag]))
        require(type(values) is list and len(values)==1,"generic_loaded_image_identity_unqualified")
        loaded=values[0];config=loaded.get("Config",{})
        require(loaded.get("Id")==measured["configDigest"] and loaded.get("Os")=="linux"
                and loaded.get("Architecture")=="amd64" and image_healthcheck_disabled(config)
                and runtime_config_projection(config,oci=False)==runtime_config_projection(document["config"],oci=True)
                and loaded.get("RootFS")==built.get("RootFS"),"generic_loaded_image_identity_unqualified")
        self.image_id=loaded["Id"]
        return archive,measured,binding

    def execute(self):
        self.stage="source-check"
        require(os.getuid()!=0,"nonroot_host_runner_required")
        require(self.command(["git","rev-parse","HEAD"]).decode().strip()==self.source,"checked_out_source_mismatch")
        self.output.mkdir(mode=0o700,parents=True)
        success=False
        try:
            self.stage='base-pull'
            self.command(["docker","pull","--platform","linux/amd64",BASE_TAG],timeout=300)
            self.stage='base-inspect'
            base,base_id=measured_base(json.loads(self.command(["docker","image","inspect",BASE_TAG])))
            self.stage='build-context'
            with tempfile.TemporaryDirectory(prefix="generic-operator-context-",dir=self.temp) as folder:
                os.chmod(folder,0o700);hashes=source_context(folder)
                self.stage='docker-build'
                self.command(["docker","build","--progress=plain","--platform","linux/amd64","--no-cache","--pull=false",
                    "--build-arg","BASE_IMAGE="+base,"--build-arg","SOURCE_SHA="+self.source,
                    "--label","org.kova.recovery.owner="+self.owner,"--tag",self.tag,folder],timeout=900)
            self.stage='client-identity'
            actual=json.loads(self.command(["docker","image","inspect",self.tag]))[0]
            labels=actual.get("Config",{}).get("Labels",{})
            self.image_id=actual.get("Id","")
            require(re.fullmatch(r"sha256:[a-f0-9]{64}",self.image_id) and actual.get("Os")=="linux"
                    and actual.get("Architecture")=="amd64" and labels.get("org.kova.recovery.owner")==self.owner
                    and labels.get("org.opencontainers.image.revision")==self.source
                    and actual.get("Config",{}).get("User")=="65532:65532"
                    and actual.get("Config",{}).get("Healthcheck",{}).get("Test")==["NONE"],
                    "built_client_identity_unconfirmed")
            archive,oci,binding=self.archive_roundtrip(actual)
            self.stage='native-smoke'
            smoke=check_smoke(json.loads(self.run_generic(self.run_args())))
            self.stage='source-hashes'
            require(smoke.get("genericSourceSha256")=={name:hashes[name] for name in FILES},
                    "image_generic_source_changed")
            inventory={"sourceSha":self.source,"baseRepoDigest":base,"baseImageId":base_id,
                       "clientImageId":self.image_id,"pgdgPrimaryKeyFingerprint":KEY_FINGERPRINT,
                       "format":2,"buildClientImageId":self.build_image_id,"ociConfigDigest":oci["configDigest"],
                       "ociRuntimeBinding":binding,"nativeOciArchiveRoundtripSmokePassed":True,
                       "genericBuildImage":{key:actual[key] for key in ["Id","Os","Architecture","Config","RootFS"]},
                       "ubuntuAllowedSigningKeyFingerprint":UBUNTU_KEY_FINGERPRINT,
                       "genericSourceSha256":hashes,"nativeSmoke":smoke}
            # Extract the installed-version SBOM via a networkless native client;
            # it contains generic package names/versions, never source metadata.
            self.stage='package-inventory'
            packages=self.run_generic(self.run_args()[:-1]+["--entrypoint","/bin/cat",self.image_id,
                                  "/opt/kova-build/packages.tsv"])
            require(sha(packages)==smoke["packageInventorySha256"],"package_inventory_changed")
            inventory["installedPackagesTsv"]=packages.decode()
            manifest_digest=oci_identity(archive,self.image_id)
            self.stage='receipt'
            inventory_bytes=canonical(inventory)
            require(len(inventory_bytes)<=MAX_INVENTORY_BYTES,"generic_inventory_bound")
            (self.output/"client-image-inventory.json").write_bytes(inventory_bytes)
            receipt={"operation":"data-free-recovery-operator-image-preparation","sourceSha":self.source,
                "format":2,"buildClientImageId":self.build_image_id,"nativeOciArchiveRoundtripSmokePassed":True,
                "ociConfigDigest":oci["configDigest"],"ociRuntimeBindingSha256":sha(canonical(binding)),
                "baseRepoDigest":base,"clientImageId":self.image_id,"ociManifestDigest":manifest_digest,
                "ociArchiveSha256":file_sha(archive),"ociArchiveBytes":archive.stat().st_size,
                "inventorySha256":sha(inventory_bytes),"nativeToolSmokePassed":True,"syntheticGpgRoundtrip":True,
                "customerDataReceived":False,"sourceDatabaseConnected":False,"targetConnected":False,
                "restorePerformed":False,"clientNetworkIsolationQualified":False,"futureRestoreApproved":False,
                "retentionDays":7,"newCloudResourceCreated":False,
                "checkedAtUtc":datetime.now(timezone.utc).isoformat()}
            self.stage='ram-cleanup'
            require(self.cleanup_storage(),"generic_ram_volume_cleanup_unconfirmed")
            self.stage='image-cleanup'
            require(self.cleanup_image(),"generic_image_cleanup_unconfirmed")
            receipt["localTagRemoved"]=True
            (self.output/"image-preparation-receipt.json").write_bytes(canonical(receipt))
            for item in self.output.iterdir():os.chmod(item,0o600)
            success=True
            return receipt
        except Exception as error:
            error.public_stage=self.stage
            raise
        finally:
            if not success:
                try:self.cleanup_storage()
                except Exception:pass
                try:self.cleanup_image()
                except Exception:pass
                # Exact owned output only; no plaintext/payload is ever present.
                if self.output.is_dir() and not self.output.is_symlink():shutil.rmtree(self.output)


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true");parser.add_argument("--output",required=True)
    args=parser.parse_args();require(args.execute,"explicit_execution_required")
    receipt=Builder(os.environ,args.output).execute()
    print(json.dumps({"ok":True,"genericOciArchiveBytes":receipt["ociArchiveBytes"],
                      "nativeToolSmokePassed":True,"restorePerformed":False},separators=(",",":")))


if __name__=="__main__":
    try:main()
    except Exception as error:
        print(json.dumps(public_failure(error),sort_keys=True,separators=(",",":")))
        raise SystemExit(1)
