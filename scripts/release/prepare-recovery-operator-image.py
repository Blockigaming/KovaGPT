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


def oci_identity(archive, expected_image_id):
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
        require(manifest.get("schemaVersion")==2 and manifest.get("config",{}).get("digest")==expected_image_id
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
        return manifest_digest


class Builder:
    def __init__(self,env,output):
        self.source=context(env)
        self.env={k:v for k,v in env.items() if k in SAFE_HOST_ENV}
        self.temp=Path(env.get("RUNNER_TEMP","")).resolve()
        require(self.temp.is_dir() and self.temp!=Path("/"),"runner_temporary_directory_required")
        self.output=Path(output)
        require(self.output.is_absolute() and self.output.resolve().is_relative_to(self.temp)
                and self.output.name=="operator-client-image" and not self.output.exists()
                and not self.output.is_symlink(),"private_image_output_unqualified")
        self.owner=secrets.token_hex(12);self.tag="kova-recovery-operator:"+self.owner
        self.image_id=None
        self.run_id=env.get("GITHUB_RUN_ID","");self.attempt=env.get("GITHUB_RUN_ATTEMPT","")
        require(re.fullmatch(r"[1-9][0-9]*",self.run_id) and re.fullmatch(r"[1-9][0-9]*",self.attempt),
                "generic_image_run_identity_required")
        self.ram_volumes=None;self.ram_index=0;self.last_ram_keys=[]

    def command(self,argv,*,timeout=120,data=None):
        try:
            with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
                result=subprocess.run(argv,input=data,stdout=out,stderr=err,env=self.env,timeout=timeout,check=False)
                require(result.returncode==0,"data_free_image_native_command_unconfirmed")
                require(out.tell()<=64*1024**2 and err.tell()<=64*1024**2,"image_command_output_bound")
                out.seek(0);return out.read()
        except (OSError,subprocess.SubprocessError):raise Stopped("data_free_image_native_command_unconfirmed") from None

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
        raw=self.command(["docker","image","ls","--no-trunc","--filter","reference="+self.tag,"--format","{{json .}}"])
        rows=[json.loads(line) for line in raw.splitlines()]
        if not rows:return True
        require(len(rows)==1 and rows[0].get("Repository")+":"+rows[0].get("Tag")==self.tag,
                "generic_image_cleanup_identity_unconfirmed")
        actual=json.loads(self.command(["docker","image","inspect",self.tag]))[0]
        require(actual.get("Config",{}).get("Labels",{}).get("org.kova.recovery.owner")==self.owner,
                "foreign_image_cleanup_forbidden")
        self.command(["docker","image","rm",self.tag])
        after=self.command(["docker","image","ls","--filter","reference="+self.tag,"--format","{{json .}}"])
        require(not after.strip(),"generic_image_cleanup_unconfirmed")
        return True

    def execute(self):
        require(os.getuid()!=0,"nonroot_host_runner_required")
        require(self.command(["git","rev-parse","HEAD"]).decode().strip()==self.source,"checked_out_source_mismatch")
        self.output.mkdir(mode=0o700,parents=True)
        success=False
        try:
            self.command(["docker","pull","--platform","linux/amd64",BASE_TAG],timeout=300)
            base,base_id=measured_base(json.loads(self.command(["docker","image","inspect",BASE_TAG])))
            with tempfile.TemporaryDirectory(prefix="generic-operator-context-",dir=self.temp) as folder:
                os.chmod(folder,0o700);hashes=source_context(folder)
                self.command(["docker","build","--platform","linux/amd64","--no-cache","--pull=false",
                    "--build-arg","BASE_IMAGE="+base,"--build-arg","SOURCE_SHA="+self.source,
                    "--label","org.kova.recovery.owner="+self.owner,"--tag",self.tag,folder],timeout=900)
            actual=json.loads(self.command(["docker","image","inspect",self.tag]))[0]
            labels=actual.get("Config",{}).get("Labels",{})
            self.image_id=actual.get("Id","")
            require(re.fullmatch(r"sha256:[a-f0-9]{64}",self.image_id) and actual.get("Os")=="linux"
                    and actual.get("Architecture")=="amd64" and labels.get("org.kova.recovery.owner")==self.owner
                    and labels.get("org.opencontainers.image.revision")==self.source
                    and actual.get("Config",{}).get("User")=="65532:65532"
                    and actual.get("Config",{}).get("Healthcheck",{}).get("Test")==["NONE"],
                    "built_client_identity_unconfirmed")
            smoke=check_smoke(json.loads(self.run_generic(self.run_args())))
            require(smoke.get("genericSourceSha256")=={name:hashes[name] for name in FILES},
                    "image_generic_source_changed")
            inventory={"sourceSha":self.source,"baseRepoDigest":base,"baseImageId":base_id,
                       "clientImageId":self.image_id,"pgdgPrimaryKeyFingerprint":KEY_FINGERPRINT,
                       "ubuntuAllowedSigningKeyFingerprint":UBUNTU_KEY_FINGERPRINT,
                       "genericSourceSha256":hashes,"nativeSmoke":smoke}
            # Extract the installed-version SBOM via a networkless native client;
            # it contains generic package names/versions, never source metadata.
            packages=self.run_generic(self.run_args()[:-1]+["--entrypoint","/bin/cat",self.image_id,
                                  "/opt/kova-build/packages.tsv"])
            require(sha(packages)==smoke["packageInventorySha256"],"package_inventory_changed")
            inventory["installedPackagesTsv"]=packages.decode()
            archive=self.output/"operator-client.oci.tar"
            self.command(["skopeo","copy","docker-daemon:"+self.tag,"oci-archive:"+str(archive)+":operator-client"],timeout=300)
            require(archive.is_file() and 0<archive.stat().st_size<=MAX_ARCHIVE_BYTES,"generic_oci_archive_size_unqualified")
            manifest_digest=oci_identity(archive,self.image_id)
            inventory_bytes=canonical(inventory)
            require(len(inventory_bytes)<=MAX_INVENTORY_BYTES,"generic_inventory_bound")
            (self.output/"client-image-inventory.json").write_bytes(inventory_bytes)
            receipt={"operation":"data-free-recovery-operator-image-preparation","sourceSha":self.source,
                "baseRepoDigest":base,"clientImageId":self.image_id,"ociManifestDigest":manifest_digest,
                "ociArchiveSha256":file_sha(archive),"ociArchiveBytes":archive.stat().st_size,
                "inventorySha256":sha(inventory_bytes),"nativeToolSmokePassed":True,"syntheticGpgRoundtrip":True,
                "customerDataReceived":False,"sourceDatabaseConnected":False,"targetConnected":False,
                "restorePerformed":False,"clientNetworkIsolationQualified":False,"futureRestoreApproved":False,
                "retentionDays":7,"newCloudResourceCreated":False,
                "checkedAtUtc":datetime.now(timezone.utc).isoformat()}
            require(self.cleanup_storage(),"generic_ram_volume_cleanup_unconfirmed")
            require(self.cleanup_image(),"generic_image_cleanup_unconfirmed")
            receipt["localTagRemoved"]=True
            (self.output/"image-preparation-receipt.json").write_bytes(canonical(receipt))
            for item in self.output.iterdir():os.chmod(item,0o600)
            success=True
            return receipt
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
    except Exception:
        print('{"ok":false,"error":"data_free_operator_image_unqualified"}')
        raise SystemExit(1)
