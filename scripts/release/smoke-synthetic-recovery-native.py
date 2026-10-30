#!/usr/bin/env python3
"""Credential-free PR-native platform smoke; never a production recovery proof.

Only a pinned image's empty fixture is used. No source URL, ciphertext, protected
phrase, customer rows, generic OCI export or restore operation is accepted.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import secrets
import shutil
import signal
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("synthetic_operator_probe",HERE/"operator-recovery-probe.py")
operator=importlib.util.module_from_spec(spec);spec.loader.exec_module(operator)
base=operator.base;builder=operator.builder
require=base.require;Stopped=base.Stopped
FIXTURE_OWNER="synthetic_extension_owner"
FIXTURE_EXTENSIONS=("pgcrypto","vector")
FORBIDDEN_PREFIXES=("KOVA_PRODUCTION_","APPROVED_ISOLATED_","KOVA_AUTH_RESTORE_","KOVA_AUTH_BACKUP_")
BUILD_STAGES=frozenset({"setup","git","pull","inspect","context","build","final-inspect","cleanup"})
DOCKER_BUILD_STAGES=frozenset({
    "apt-cache-clean",
    "build-temporary-clean",
    "pg17-candidate-query",
    "pg17-client-install",
    "pg17-version-guard",
    "pgdg-index-refresh",
    "pgdg-key-count-guard",
    "pgdg-key-directory",
    "pgdg-key-download",
    "pgdg-key-fingerprint-guard",
    "pgdg-key-read",
    "pgdg-source-write",
    "sbom-directory",
    "sbom-package-query",
    "sbom-release-copy",
    "ubuntu-architecture-guard",
    "ubuntu-candidate-bash",
    "ubuntu-candidate-ca-certificates",
    "ubuntu-candidate-coreutils",
    "ubuntu-candidate-curl",
    "ubuntu-candidate-gnupg",
    "ubuntu-candidate-nodejs",
    "ubuntu-candidate-python3",
    "ubuntu-enable-https",
    "ubuntu-index-refresh",
    "ubuntu-insecure-source-guard",
    "ubuntu-legacy-sources-empty-guard",
    "ubuntu-official-uris-guard",
    "ubuntu-package-candidate-query",
    "ubuntu-package-list",
    "ubuntu-package-loop",
    "ubuntu-package-select",
    "ubuntu-package-version-guard",
    "ubuntu-packages-install",
    "ubuntu-release-guard",
    "ubuntu-release-read",
    "ubuntu-scope-signing-key",
    "ubuntu-signed-by-guard",
    "ubuntu-source-count-guard",
    "ubuntu-source-glob",
    "ubuntu-sources-present-guard",
})
MAX_COMMAND_OUTPUT_BYTES=8*1024**2
MAX_DIAGNOSTIC_BYTES=4096
SAFE_FAILURE_CODES=frozenset({
    "synthetic_native_unconfirmed","synthetic_native_smoke_failed","synthetic_native_interrupted",
    "synthetic_pr_context_required","synthetic_source_pin_required","sensitive_input_in_synthetic_smoke",
    "synthetic_run_identity_required","synthetic_runner_temp_required","synthetic_receipt_path_unqualified",
    "nonroot_host_runner_required","synthetic_checkout_mismatch","synthetic_image_attempt_already_reserved",
    "synthetic_image_state_owner_changed","synthetic_operator_image_unqualified",
    "synthetic_image_cleanup_state_unqualified","synthetic_build_completion_unknown",
    "synthetic_cleanup_unconfirmed","synthetic_owned_cleanup_unconfirmed",
    "generic_source_file_unqualified","generic_dockerfile_unqualified","base_image_identity_unconfirmed",
    "official_ubuntu_amd64_digest_unconfirmed","generic_image_cleanup_identity_unconfirmed",
    "foreign_image_cleanup_forbidden","generic_image_cleanup_unconfirmed",
    "synthetic_command_nonzero_exit","synthetic_command_timeout","synthetic_command_os_error",
    "synthetic_command_signaled","synthetic_command_output_bound",
    "native_command_failed","native_command_unconfirmed","native_extension_preload_unqualified",
    "native_permission_unqualified","native_dependency_unqualified","private_command_output_bound",
    "timeout_control_identity_unconfirmed","timeout_control_positive_unconfirmed",
    "timeout_control_expiry_unconfirmed","outbound_connection_not_denied",
})


RAM_FAILURE_CODES=frozenset({
    'generic_ram_kernel_proof_unconfirmed',
    'generic_ram_volume_cleanup_unconfirmed',
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
    'short_run_kernel_proof_unconfirmed',
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
SAFE_FAILURE_CODES=SAFE_FAILURE_CODES|RAM_FAILURE_CODES
SAFE_FAILURE_CODES=SAFE_FAILURE_CODES|base.server_image.PUBLIC_FAILURE_CODES
RAM_STOPPED_TYPES=(operator.ram.Stopped,builder.ram.Stopped,operator.volume_proof.Stopped,builder.volume_proof.Stopped,base.server_image.Stopped)


NATIVE_COMMAND_STAGES=frozenset({"not-attempted","git-head","docker-info","pinned-server-pull","server-buildx-version","server-raw-manifest","server-semantic-config","server-loaded-image","native-other"})
NATIVE_PROBE_STAGES=frozenset({"synthetic_initial","synthetic_toolchain","synthetic_fixture_from_image",
    "synthetic_complete","initial","native_tools","network_create","native_metadata_prepare",
    "native_tls_controls","native_catalog_proof","native_extension_coverage","original_destination_guard",
    "actual_egress_denial","native_proof_complete"})


def native_command_stage(argv):
    if argv==["git","rev-parse","HEAD"]:return "git-head"
    if argv==["docker","info","--format","{{.OSType}}"]:return "docker-info"
    if argv==["docker","pull","--platform","linux/amd64",base.IMAGE]:return "pinned-server-pull"
    if argv==["docker","buildx","version"]:return "server-buildx-version"
    if argv==["docker","buildx","imagetools","inspect","--raw",base.IMAGE]:return "server-raw-manifest"
    if argv==["docker","buildx","imagetools","inspect","--format","{{json .Image}}",base.IMAGE]:return "server-semantic-config"
    if argv==["docker","image","inspect",base.IMAGE]:return "server-loaded-image"
    return "native-other"


def safe_exception_type(error):
    # Never emit an arbitrary class name, exception argument or representation.
    allowed={Stopped:"Stopped",builder.Stopped:"Stopped",OSError:"OSError",
             PermissionError:"PermissionError",FileNotFoundError:"FileNotFoundError",
             subprocess.TimeoutExpired:"TimeoutExpired",ValueError:"ValueError",
             json.JSONDecodeError:"JSONDecodeError",RuntimeError:"RuntimeError",AssertionError:"AssertionError"}
    if type(error) in RAM_STOPPED_TYPES:return "Stopped"
    return allowed.get(type(error),"UnknownException")


def diagnostic_secrets(env):
    # Values are retained only in this private process for redaction. They are
    # never included in a subprocess environment, receipt or exception string.
    names=re.compile(r"TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|API_KEY|PRIVATE_KEY|ACCESS_KEY|PROXY",re.I)
    return tuple(sorted({value for key,value in env.items() if names.search(key)
                         and isinstance(value,str) and value},key=len,reverse=True))


def safe_diagnostic(raw,secrets_to_hide=(),limit=MAX_DIAGNOSTIC_BYTES):
    text=raw.decode("utf-8",errors="replace")
    for secret in secrets_to_hide:text=text.replace(secret,"[redacted]")
    # Do this before truncation so a secret spanning the tail boundary cannot
    # have its suffix exposed. Strip terminal controls rather than executing them.
    text=re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)","",text)
    text=re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]","",text)
    for secret in secrets_to_hide:text=text.replace(secret,"[redacted]")
    text=re.sub(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@]+(?::[^\s/@]*)?@",r"\1[redacted]@",text)
    text=re.sub(r"(?im)(\b(?:proxy-)?authorization\b(?:\\?[\"'])?[ \t]*[:=][ \t]*)[^\r\n]*(?:\r?\n(?:#[0-9]+[ \t]+[0-9]+(?:\.[0-9]+)?[ \t])?[ \t]+[^\r\n]*)*",r"\1[redacted]",text)
    text=re.sub(r"(?i)\bbearer[ \t]+[\"']?[^\s\"'<>]+","Bearer [redacted]",text)
    text=re.sub(r"(?i)([?&#](?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|token|secret|password|key|credential|signature|authorization|auth|x-amz-(?:credential|signature|security-token))=)[^&\s\"']+",r"\1[redacted]",text)
    text=re.sub(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b","[redacted]",text)
    text=text.replace("\r","\n")
    text="".join(c if c=="\n" or 32<=ord(c)<=126 else "?" for c in text)
    return text if limit is None else text.encode("ascii")[-limit:].decode("ascii") if limit else ""


def executed_buildkit_diagnostic(stderr,secrets_to_hide=(),limit=MAX_DIAGNOSTIC_BYTES):
    # Sanitize the entire bounded in-memory capture BEFORE selecting progress
    # output. Dockerfile frames and echoed RUN recipes have no numeric time.
    clean=safe_diagnostic(stderr,secrets_to_hide,limit=None)
    lines=[line for line in clean.splitlines()
           if re.fullmatch(r"#[0-9]+[ \t]+[0-9]+(?:\.[0-9]+)?[ \t]+.+",line)]
    if not lines:return None
    return "\n".join(lines).encode("ascii")[-limit:].decode("ascii") if limit else ""


def observed_docker_build_stages(stderr):
    # Only BuildKit's actual plain progress output is evidence. Dockerfile
    # frames, RUN command echoes, xtrace and unknown strings are not markers.
    observed=[]
    for line in stderr.splitlines():
        match=re.fullmatch(rb"#[0-9]+[ \t]+[0-9]+(?:\.[0-9]+)?[ \t]+KOVA_OPERATOR_STAGE=([a-z0-9-]+)",line)
        if match:
            stage=match[1].decode("ascii")
            if stage in DOCKER_BUILD_STAGES:observed.append(stage)
    last=observed[-1] if observed else None
    return {"observedStage":last,"lastStage":last,"observedStages":observed[-64:],
            "observedStageCount":len(observed)}


def bounded_diagnostic_child():
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_COMMAND_OUTPUT_BYTES,MAX_COMMAND_OUTPUT_BYTES))


class SyntheticCommandFailure(Stopped):
    def __init__(self,code,details,*,completed):
        super().__init__(code);self.details=details;self.completed=completed


def failure_details(error,stage="setup"):
    code=str(error) if isinstance(error,(Stopped,builder.Stopped,*RAM_STOPPED_TYPES)) else "synthetic_native_unconfirmed"
    code=code if code in SAFE_FAILURE_CODES else "synthetic_native_unconfirmed"
    value={"code":code,"stage":stage if stage in BUILD_STAGES else "setup"}
    if isinstance(error,SyntheticCommandFailure):value["command"]=error.details
    for proof_module in [operator.volume_proof,builder.volume_proof]:
        observed=proof_module.safe_mount_policy_observations(error)
        if observed is not None:value["mountPolicy"]=observed
    return value


def preserve_primary_failure(result,error,stage="setup"):
    primary=failure_details(error,stage)
    result["syntheticNativeProofComplete"]=False
    result.setdefault("primaryFailure",primary)
    result.setdefault("errorCode",result["primaryFailure"]["code"])
    result.setdefault("failedStage",result["primaryFailure"]["stage"])


def preserve_cleanup_failure(result,details):
    result["syntheticNativeProofComplete"]=False
    result["cleanupFailure"]={"code":"synthetic_cleanup_unconfirmed",**details}
    # Cleanup must never erase the actual earlier failing operation.
    result.setdefault("errorCode","synthetic_cleanup_unconfirmed")


def synthetic_context(env):
    require(env.get("KOVA_SYNTHETIC_NATIVE_CONFIRMATION")=="SYNTHETIC_ONLY"
            and env.get("GITHUB_ACTIONS")=="true" and env.get("RUNNER_OS")=="Linux"
            and env.get("GITHUB_EVENT_NAME")=="pull_request"
            and env.get("GITHUB_REPOSITORY")=="Blockigaming/KovaGPT"
            and re.fullmatch(r"refs/pull/[1-9][0-9]*/merge",env.get("GITHUB_REF","")),
            "synthetic_pr_context_required")
    source=env.get("GITHUB_SHA","")
    require(re.fullmatch(r"[a-f0-9]{40}",source) and env.get("KOVA_SYNTHETIC_SOURCE_SHA")==source,
            "synthetic_source_pin_required")
    require(not any(env.get(k) for k in env if k in base.FORBIDDEN_ENV or k in builder.SENSITIVE_KEYS
                    or k.startswith(FORBIDDEN_PREFIXES)),"sensitive_input_in_synthetic_smoke")
    return source


def identities(env):
    source=synthetic_context(env)
    run,attempt=env.get("GITHUB_RUN_ID",""),env.get("GITHUB_RUN_ATTEMPT","")
    require(re.fullmatch(r"[1-9][0-9]*",run) and re.fullmatch(r"[1-9][0-9]*",attempt),"synthetic_run_identity_required")
    location=env.get("RUNNER_TEMP","")
    require(bool(location) and Path(location).is_absolute(),"synthetic_runner_temp_required")
    root=Path(location).resolve()
    require(root.is_dir() and root!=Path("/"),"synthetic_runner_temp_required")
    return source,run,attempt,root


class SyntheticBuilder(builder.Builder):
    """Reuse the exact final recipe, without an archive/export or main bypass."""
    def __init__(self,env):
        source,run,attempt,root=identities(env)
        self.source=source;self.env={k:v for k,v in env.items() if k in builder.SAFE_HOST_ENV}
        self.temp=root;self.owner=secrets.token_hex(12);self.tag="kova-recovery-operator:"+self.owner
        self.image_id=None;self.output=None;self.build_invoked=False;self.build_returned=False
        self.build_stage="setup";self._diagnostic_secrets=diagnostic_secrets(env)
        self.state=root/("kova-synthetic-image-owned-"+run+"-"+attempt+".json")
        require(not self.state.exists(),"synthetic_image_attempt_already_reserved")
        self.write_state(run,attempt)

    def set_build_stage(self,stage):
        require(stage in BUILD_STAGES,"synthetic_native_unconfirmed")
        self.build_stage=stage

    def command(self,argv,*,timeout=120):
        """Bounded diagnostic override for this credential-free subclass only."""
        stage=getattr(self,"build_stage","cleanup")
        stage=stage if stage in BUILD_STAGES else "setup"
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            status="exit";exit_code=None;os_error=None
            try:
                result=subprocess.run(argv,stdout=out,stderr=err,env=self.env,timeout=timeout,
                                      check=False,preexec_fn=bounded_diagnostic_child)
                exit_code=result.returncode
                if exit_code<0:status="signal"
            except subprocess.TimeoutExpired:status="timeout"
            except OSError as error:status="os-error";os_error=error.errno
            out_size,err_size=out.tell(),err.tell()
            out.seek(0);err.seek(0)
            stdout=out.read(MAX_COMMAND_OUTPUT_BYTES+1);stderr=err.read(MAX_COMMAND_OUTPUT_BYTES+1)
            bounded=out_size<=MAX_COMMAND_OUTPUT_BYTES and err_size<=MAX_COMMAND_OUTPUT_BYTES
            completed=status=="exit"
            if completed and exit_code==0 and bounded:return stdout
            code={"exit":"synthetic_command_nonzero_exit","signal":"synthetic_command_signaled",
                  "timeout":"synthetic_command_timeout","os-error":"synthetic_command_os_error"}[status]
            if not bounded:code="synthetic_command_output_bound"
            hidden=getattr(self,"_diagnostic_secrets",diagnostic_secrets(self.env))
            executed_tail=executed_buildkit_diagnostic(stderr,hidden) if stage=="build" and argv[:2]==["docker","build"] else None
            stderr_tail=executed_tail if executed_tail is not None else safe_diagnostic(stderr,hidden)
            stdout_tail=safe_diagnostic(stdout,hidden,MAX_DIAGNOSTIC_BYTES-len(stderr_tail.encode("ascii")))
            details={"stage":stage,"status":status,"completed":completed,"exitCode":exit_code,
                     "outputWithinBound":bounded,"stderrTail":stderr_tail,"stdoutTail":stdout_tail}
            if stage=="build" and argv[:2]==["docker","build"]:
                details["stderrTailKind"]="buildkit-executed" if executed_tail is not None else "sanitized-raw"
            if status=="os-error":details["osErrorNumber"]=os_error
            if stage=="build" and argv[:2]==["docker","build"]:
                # Parse the complete bounded capture, before the 4KiB tail can
                # hide early executed guards behind a large Dockerfile frame.
                details.update(observed_docker_build_stages(stderr))
            raise SyntheticCommandFailure(code,details,completed=completed)

    def write_state(self,run,attempt):
        value={"format":1,"source":self.source,"run":run,"attempt":attempt,"uid":os.getuid(),
               "owner":self.owner,"tag":self.tag,"buildInvoked":self.build_invoked,"buildReturned":self.build_returned}
        if self.state.exists():
            old=json.loads(base.private_file(self.state).read_bytes())
            require(all(old.get(k)==value[k] for k in ["source","run","attempt","uid","owner","tag"]),
                    "synthetic_image_state_owner_changed")
            temporary=self.state.with_suffix(".new")
            base.write_private(temporary,base.encoded(value));os.replace(temporary,self.state)
        else:base.write_private(self.state,base.encoded(value))

    def build(self):
        require(os.getuid()!=0,"nonroot_host_runner_required")
        self.set_build_stage("git")
        require(self.command(["git","rev-parse","HEAD"]).decode().strip()==self.source,
                "synthetic_checkout_mismatch")
        self.set_build_stage("pull")
        self.command(["docker","pull","--platform","linux/amd64",builder.BASE_TAG],timeout=300)
        self.set_build_stage("inspect")
        measured,_=builder.measured_base(json.loads(self.command(["docker","image","inspect",builder.BASE_TAG])))
        self.set_build_stage("context")
        with tempfile.TemporaryDirectory(prefix="synthetic-operator-context-",dir=self.temp) as folder:
            os.chmod(folder,0o700);builder.source_context(folder)
            _,run,attempt,_=identities_from_builder(self)
            self.set_build_stage("build")
            self.build_invoked=True;self.write_state(run,attempt)
            try:
                self.command(["docker","build","--progress=plain","--platform","linux/amd64","--no-cache","--pull=false",
                "--build-arg","BASE_IMAGE="+measured,"--build-arg","SOURCE_SHA="+self.source,
                    "--label","org.kova.recovery.owner="+self.owner,"--tag",self.tag,folder],timeout=900)
            except SyntheticCommandFailure as error:
                if error.completed:self.build_returned=True;self.write_state(run,attempt)
                raise
            self.build_returned=True;self.write_state(run,attempt)
        self.set_build_stage("final-inspect")
        info=json.loads(self.command(["docker","image","inspect",self.tag]))[0]
        self.image_id=info.get("Id")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}",self.image_id or "")
                and info.get("Os")=="linux" and info.get("Architecture")=="amd64"
                and info.get("Config",{}).get("Labels",{}).get("org.kova.recovery.owner")==self.owner
                and info.get("Config",{}).get("Labels",{}).get("org.opencontainers.image.revision")==self.source,
                "synthetic_operator_image_unqualified")
        return self.image_id


class SyntheticProbe(operator.OperatorProbe):
    def __init__(self,env,output,*,operator_image_id):
        self.source,self.run_id,self.attempt,self.runner_temp=identities(env)
        self.metadata={};self.env=base.clean_host_env(env)
        self._diagnostic_secrets=diagnostic_secrets(env)
        self.native_attempted_stage="not-attempted";self.native_failure=None
        self.output=Path(output)
        require(self.output.is_absolute() and self.output.name=="receipt.json"
                and self.output.resolve().is_relative_to(self.runner_temp)
                and not self.output.exists() and not self.output.is_symlink(),"synthetic_receipt_path_unqualified")
        self.token=secrets.token_hex(5);self.network="kova-empty-"+self.token
        self.bridge="kr"+self.token;self.chain="KRP"+self.token.upper()
        self.names={k:"kova-empty-"+k+"-"+self.token for k in ["a","b","client"]}
        self.addresses={"a":("172.30.240.2","fd68:6b6f:7661:240::2"),
            "b":("172.30.240.3","fd68:6b6f:7661:240::3"),"client":("172.30.240.4","fd68:6b6f:7661:240::4")}
        self.hosts={k:"kova-empty-"+k+".internal" for k in ["a","b"]}
        self.owner_label="kova.empty-probe.owner="+self.token
        self.containers_reserved=[];self.network_reserved=False;self.firewall_reserved=[]
        self.cleanup_confirmed=False;self.stage="synthetic_initial";self.command_count=0;self.last_stderr=b""
        self.private_root=None;self.uid=os.getuid();self.gid=os.getgid();self.pg_uid=None;self.pg_gid=None
        self.image_env={};self.image_volumes=[];self.host_firewall_pins={};self.native_tools={}
        self.network_evidence=[];self.netns={};self.neighbors=[]
        self.configure_operator(operator_image_id,self.source)

    def run(self,argv,**kwargs):
        self.native_attempted_stage=native_command_stage(argv)
        self.last_stderr=b""  # An uncertain attempt must not reuse older stderr.
        try:return super().run(argv,**kwargs)
        except Exception as error:
            if self.native_failure is None:
                self.native_failure={"commandStage":self.native_attempted_stage,
                    "exceptionType":safe_exception_type(error),"commandCount":self.command_count,
                    "stderrTail":safe_diagnostic(self.last_stderr,self._diagnostic_secrets)}
            raise

    def derive_image_fixture(self):
        # Read only this already isolated, freshly initialized trusted image.
        self.wait_native("a")
        sql="""SELECT jsonb_build_object(
'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,
 'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,
 'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil) ORDER BY rolname),'[]')
 FROM pg_roles WHERE rolname<>current_user),
'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),
 'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,
 'inherit',inherit_option,'set',set_option) ORDER BY roleid,member),'[]') FROM pg_auth_members),
'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),
 'acl',nspacl,'comment',obj_description(oid,'pg_namespace')) ORDER BY nspname),'[]') FROM pg_namespace
 WHERE nspname !~ '^pg_' AND nspname<>'information_schema'),
'available',(SELECT jsonb_agg(jsonb_build_object('name',a.name,'version',a.default_version,'schema',v.schema)
 ORDER BY a.name) FROM pg_available_extensions a JOIN pg_available_extension_versions v
 ON v.name=a.name AND v.version=a.default_version WHERE a.name IN ('plpgsql','pgcrypto','vector'))
)::text;\n"""
        _,raw=self.bootstrap_sql("a",sql)
        value=json.loads(raw)
        require(all(isinstance(value.get(k),list) for k in ["roles","memberships","schemas","available"])
                and {r["name"] for r in value["available"]}=={"plpgsql",*FIXTURE_EXTENSIONS},
                "synthetic_image_fixture_unavailable")
        fixture_role={"name":FIXTURE_OWNER,"super":False,"inherit":True,"createRole":False,"createDb":False,
                      "login":False,"replication":False,"bypassRls":False,"connectionLimit":-1,"validUntil":None}
        require(not any(r["name"]==FIXTURE_OWNER for r in value["roles"]),"synthetic_fixture_role_collision")
        extensions=[]
        for row in value["available"]:
            require(re.fullmatch(r"[a-zA-Z0-9_.+-]+",row["version"]),"synthetic_fixture_extension_version")
            extensions.append({"name":row["name"],"version":row["version"],
                               "schema":row["schema"] or "public","owner":FIXTURE_OWNER})
        self.metadata={"roles":[*value["roles"],fixture_role],"memberships":value["memberships"],
                       "schemas":value["schemas"],"extensions":extensions,"roleSettings":[],
                       "fixtureSettingsComplete":True,"syntheticFixtureDerivedOnlyFromPinnedImage":True}

    def execute(self):
        # Seal the inherited generic method so fixture DTOs can never emit a
        # production-source-looking success receipt through another entry point.
        return self.execute_synthetic()

    def execute_synthetic(self):
        result={"operation":"credential-free-synthetic-native-recovery-smoke","sourceSha":self.source,
          "postgresBuild":base.BUILD,"serverImageRepoDigest":base.IMAGE,"operatorImageId":self.operator_image_id,
          "syntheticNativeProofComplete":False,"nativeResourcesCleanupConfirmed":False,
          "customerRowsUsed":False,"productionMutated":False,"sourceConnected":False,"sourceProof":False,
          "sourceMetadataCompatible":False,"independentlyReviewed":False,"restoreQualified":False,
          "futureTargetApproved":False,"customerBackupDecryptionPerformed":False,"protectedPhraseUsed":False,"restorePerformed":False,
          "ociArchiveExported":False,"ociArchiveUploaded":False,"targetsRetained":False}
        kernel=os.uname().release
        if re.fullmatch(r"[0-9][A-Za-z0-9_.+-]{0,127}",kernel):result["nativeKernelRelease"]=kernel
        self.save_state()
        try:
            self.stage="synthetic_toolchain";self.initialize()
            result["serverImageTransport"]=self.server_image_qualification
            self.private_root=Path(tempfile.mkdtemp(prefix="kova-empty-"+self.run_id+"-"+self.attempt+"-",dir=self.runner_temp))
            os.chmod(self.private_root,0o700)
            base.write_private(self.private_root/"ownership.json",base.encoded({"token":self.token,"source":self.source,
                               "runId":self.run_id,"attempt":self.attempt}))
            self.save_state();self.make_private_files(self.private_root);self.create_network()
            self.start_container("client")
            first=self.start_container("a");self.static_ipv6_neighbors("a")
            self.stage="synthetic_fixture_from_image";self.derive_image_fixture()
            ids=[];systems=[];snapshots=[]
            for target in ["a","b"]:
                info=first if target=="a" else self.start_container(target)
                if target=="b":self.static_ipv6_neighbors(target)
                ids.append(info["Id"]);self.prepare_native(target)
                system=self.tls_controls(target);systems.append(system)
                self.original_destination_guard(target,system);self.consumer_proof(target)
                snapshots.append(self.native_snapshot(target))
            require(len(set(ids))==len(set(systems))==2,"synthetic_native_instances_not_distinct")
            require(snapshots[0]["fingerprints"]==snapshots[1]["fingerprints"],"synthetic_image_baselines_differ")
            require(all(s[k] for s in snapshots for k in ["roleMatch","namespaceMatch","extensionMatch"]),
                    "synthetic_fixture_metadata_differs")
            self.verify_effective_firewalls()
            # Literal external routes only: no source endpoint/credential is used.
            targets=[("synthetic-internet","1.1.1.1",443),("synthetic-internet","2606:4700:4700::1111",443),
                     ("synthetic-database-denial","8.8.8.8",5432),("synthetic-database-denial","2001:4860:4860::8888",5432)]
            attempts=self.denial_probes(targets);self.verify_effective_firewalls()
            for target,before in zip(["a","b"],snapshots):
                self.consumer_proof(target)
                require(self.native_snapshot(target)["fingerprints"]==before["fingerprints"],"synthetic_target_changed")
            self.inspect_and_recheck_runtime("client")
            result.update(syntheticNativeProofComplete=True,fixtureDerivedOnlyFromPinnedImage=True,
                nativeToolSmokePassed=True,nativeToolSmokeSha256=base.digest(base.encoded(self.operator_smoke)),
                nativeServerVersionNum=170006,independentFreshTemplate0Count=2,distinctClusterCount=2,
                privateTlsIpv4PositiveCount=2,privateTlsIpv6PositiveCount=2,wrongHostnameRejectedCount=2,
                wrongCaRejectedCount=2,numericDeniedConnectProbeCount=attempts,ordinaryTargetRows=0,
                activePreloadLibraryCount=0,consumerWorkerCount=0,hostPublishedPortCount=0,socketMountCount=0,
                privateTmpfsNoswapObserved=True,containerSwapDisabledObserved=True,dockerLoggingDisabledObserved=True,
                dataBacking="owned-local-tmpfs-volumes",noDiskDataBackingObserved=True,
                ownedTmpfsVolumeCount=len(self.owned_ram().specs),
                runtimeMountProofSha256=base.digest(base.encoded(self.owned_ram().runtime_records)),
                networkEvidenceSha256=base.digest(base.encoded(self.network_evidence+self.neighbors)),
                syntheticBaselineFingerprints=snapshots[0]["fingerprints"])
            self.stage="synthetic_complete"
        except Exception as error:
            preserve_primary_failure(result,error)
            result["failedStage"]=self.stage if self.stage in NATIVE_PROBE_STAGES else "native-stage-unconfirmed"
            # Copy the sanitized primary command evidence BEFORE cleanup can
            # change last_stderr or attempt another native command.
            result["nativeFailure"]=dict(self.native_failure) if self.native_failure is not None else {
                "commandStage":self.native_attempted_stage if self.native_attempted_stage in NATIVE_COMMAND_STAGES else "native-other",
                "exceptionType":safe_exception_type(error),
                "commandCount":self.command_count,"stderrTail":safe_diagnostic(self.last_stderr,self._diagnostic_secrets)}
        finally:
            qualified=getattr(self,"server_image_qualification",None)
            if type(qualified) is dict:result.setdefault("serverImageTransport",qualified)
            cleanup_details={"native":{"code":"synthetic_owned_cleanup_unconfirmed"}}
            try:result["nativeResourcesCleanupConfirmed"]=self.cleanup()
            except Exception as error:
                result["nativeResourcesCleanupConfirmed"]=False
                cleanup_details["native"]["exceptionType"]=safe_exception_type(error)
            if not result["nativeResourcesCleanupConfirmed"]:
                code=getattr(self,"storage_cleanup_code",None)
                if type(code) is str and (code in operator.CLEANUP_STORAGE_CODES or code=="owned_storage_cleanup_unconfirmed"):
                    cleanup_details["native"]["storageCode"]=code
                preserve_cleanup_failure(result,cleanup_details)
            result["nativeCommandCount"]=self.command_count
        return result


def identities_from_builder(value):
    state=json.loads(base.private_file(value.state).read_bytes())
    require(state.get("owner")==value.owner and state.get("source")==value.source,"synthetic_image_state_owner_changed")
    return value.source,state["run"],state["attempt"],value.temp


def cleanup_all(env,*,details=None):
    failures=details if details is not None else {}
    try:
        detail={"code":"synthetic_owned_cleanup_unconfirmed","stage":"cleanup"}
        native=operator.cleanup_operator_state(env,context_validator=synthetic_context,details=detail)
        if not native:failures["native"]=detail
    except Exception as error:native=False;failures["native"]=failure_details(error,"cleanup")
    try:
        image=cleanup_image_from_state(env) if native else False
        if native and not image:failures["image"]={"code":"synthetic_cleanup_unconfirmed","stage":"cleanup"}
    except Exception as error:image=False;failures["image"]=failure_details(error,"cleanup")
    return bool(native),bool(image)


def cleanup_image_from_state(env):
    source,run,attempt,root=identities(env)
    path=root/("kova-synthetic-image-owned-"+run+"-"+attempt+".json")
    if not path.exists():return True
    state=json.loads(base.private_file(path).read_bytes())
    require(state.get("format")==1 and state.get("source")==source and state.get("run")==run
            and state.get("attempt")==attempt and state.get("uid")==os.getuid()
            and re.fullmatch(r"[a-f0-9]{24}",state.get("owner",""))
            and state.get("tag")=="kova-recovery-operator:"+state["owner"],"synthetic_image_cleanup_state_unqualified")
    require(type(state.get("buildInvoked")) is bool and type(state.get("buildReturned")) is bool
            and (not state["buildInvoked"] or state["buildReturned"]),"synthetic_build_completion_unknown")
    b=object.__new__(SyntheticBuilder);b.owner=state["owner"];b.tag=state["tag"];b.image_id=None
    b.env={k:v for k,v in env.items() if k in builder.SAFE_HOST_ENV}
    b.build_stage="cleanup";b._diagnostic_secrets=diagnostic_secrets(env)
    return b.cleanup_image()


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true");parser.add_argument("--cleanup-only",action="store_true")
    parser.add_argument("--output")
    args=parser.parse_args();require(args.execute != args.cleanup_only,"synthetic_operation_selection")
    source,run,attempt,root=identities(os.environ)
    if args.cleanup_only:
        details={};native,image=cleanup_all(os.environ,details=details)
        if not (native and image):
            print(json.dumps({"ok":False,"error":"synthetic_cleanup_unconfirmed","cleanupFailure":details,"sourceProof":False},separators=(",",":")))
            raise SystemExit(1)
        print('{"ok":true,"syntheticOwnedCleanupConfirmed":true}');return
    output=Path(args.output or "")
    require(output.is_absolute() and output.name=="receipt.json" and output.resolve().is_relative_to(root)
            and not output.exists() and not output.is_symlink(),"synthetic_receipt_path_unqualified")
    result={"operation":"credential-free-synthetic-native-recovery-smoke","sourceSha":source,
            "syntheticNativeProofComplete":False,"sourceProof":False,"sourceMetadataCompatible":False,
            "independentlyReviewed":False,"restoreQualified":False,"customerRowsUsed":False,
            "sourceConnected":False,"productionMutated":False,"ociArchiveExported":False,"ociArchiveUploaded":False}
    build=None;p=None
    try:
        build=SyntheticBuilder(os.environ);image_id=build.build()
        p=SyntheticProbe(os.environ,output,operator_image_id=image_id);result=p.execute_synthetic()
    except Exception as error:
        preserve_primary_failure(result,error,getattr(build,"build_stage","setup"))
    finally:
        details={};native,image=cleanup_all(os.environ,details=details)
        result["cleanupConfirmed"]=bool(native and image)
        if not result["cleanupConfirmed"]:preserve_cleanup_failure(result,details)
        result["checkedAtUtc"]=datetime.now(timezone.utc).isoformat()
        output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        base.write_private(output,base.encoded(result))
    if not (result["syntheticNativeProofComplete"] and result["cleanupConfirmed"]):
        print(json.dumps({k:result[k] for k in ["errorCode","primaryFailure","cleanupFailure","sourceProof"] if k in result},separators=(",",":")))
        raise SystemExit(1)
    print('{"ok":true,"syntheticNativeProofWritten":true,"sourceProof":false,"restoreQualified":false}')


if __name__=="__main__":
    def interrupted(*_):raise Stopped("synthetic_native_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception as error:
        print(json.dumps({"ok":False,"error":"synthetic_native_smoke_unqualified","primaryFailure":failure_details(error),"sourceProof":False},separators=(",",":")))
        raise SystemExit(1)
