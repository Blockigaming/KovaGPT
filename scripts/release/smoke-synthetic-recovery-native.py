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
import secrets
import shutil
import signal
import tempfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("synthetic_operator_probe",HERE/"operator-recovery-probe.py")
operator=importlib.util.module_from_spec(spec);spec.loader.exec_module(operator)
base=operator.base;builder=operator.builder
require=base.require;Stopped=base.Stopped
FIXTURE_OWNER="synthetic_extension_owner"
FIXTURE_EXTENSIONS=("pgcrypto","vector")
FORBIDDEN_PREFIXES=("KOVA_PRODUCTION_","APPROVED_ISOLATED_","KOVA_AUTH_RESTORE_","KOVA_AUTH_BACKUP_")


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
        self.state=root/("kova-synthetic-image-owned-"+run+"-"+attempt+".json")
        require(not self.state.exists(),"synthetic_image_attempt_already_reserved")
        self.write_state(run,attempt)

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
        require(self.command(["git","rev-parse","HEAD"]).decode().strip()==self.source,
                "synthetic_checkout_mismatch")
        self.command(["docker","pull","--platform","linux/amd64",builder.BASE_TAG],timeout=300)
        measured,_=builder.measured_base(json.loads(self.command(["docker","image","inspect",builder.BASE_TAG])))
        with tempfile.TemporaryDirectory(prefix="synthetic-operator-context-",dir=self.temp) as folder:
            os.chmod(folder,0o700);builder.source_context(folder)
            _,run,attempt,_=identities_from_builder(self)
            self.build_invoked=True;self.write_state(run,attempt)
            self.command(["docker","build","--platform","linux/amd64","--no-cache","--pull=false",
                "--build-arg","BASE_IMAGE="+measured,"--build-arg","SOURCE_SHA="+self.source,
                "--label","org.kova.recovery.owner="+self.owner,"--tag",self.tag,folder],timeout=900)
            self.build_returned=True;self.write_state(run,attempt)
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
        self.save_state()
        try:
            self.stage="synthetic_toolchain";self.initialize()
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
                networkEvidenceSha256=base.digest(base.encoded(self.network_evidence+self.neighbors)),
                syntheticBaselineFingerprints=snapshots[0]["fingerprints"])
            self.stage="synthetic_complete"
        except Exception as error:
            result["syntheticNativeProofComplete"]=False
            result["errorCode"]=str(error) if isinstance(error,Stopped) else "synthetic_native_unconfirmed"
            result["failedStage"]=self.stage
        finally:
            result["nativeResourcesCleanupConfirmed"]=self.cleanup()
            if not result["nativeResourcesCleanupConfirmed"]:
                result["syntheticNativeProofComplete"]=False;result["errorCode"]="synthetic_owned_cleanup_unconfirmed"
            result["nativeCommandCount"]=self.command_count
        return result


def identities_from_builder(value):
    state=json.loads(base.private_file(value.state).read_bytes())
    require(state.get("owner")==value.owner and state.get("source")==value.source,"synthetic_image_state_owner_changed")
    return value.source,state["run"],state["attempt"],value.temp


def cleanup_all(env):
    try:native=operator.cleanup_operator_state(env,context_validator=synthetic_context)
    except Exception:native=False
    try:image=cleanup_image_from_state(env) if native else False
    except Exception:image=False
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
    return b.cleanup_image()


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true");parser.add_argument("--cleanup-only",action="store_true")
    parser.add_argument("--output")
    args=parser.parse_args();require(args.execute != args.cleanup_only,"synthetic_operation_selection")
    source,run,attempt,root=identities(os.environ)
    if args.cleanup_only:
        native,image=cleanup_all(os.environ)
        require(native and image,"synthetic_cleanup_unconfirmed")
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
        result["syntheticNativeProofComplete"]=False
        result["errorCode"]=str(error) if isinstance(error,(Stopped,builder.Stopped)) else "synthetic_native_unconfirmed"
        result["failedStage"]="synthetic_build_or_setup"
    finally:
        native,image=cleanup_all(os.environ)
        result["cleanupConfirmed"]=bool(native and image)
        if not result["cleanupConfirmed"]:result["syntheticNativeProofComplete"]=False;result["errorCode"]="synthetic_cleanup_unconfirmed"
        result["checkedAtUtc"]=datetime.now(timezone.utc).isoformat()
        output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        base.write_private(output,base.encoded(result))
    require(result["syntheticNativeProofComplete"] and result["cleanupConfirmed"],"synthetic_native_smoke_failed")
    print('{"ok":true,"syntheticNativeProofWritten":true,"sourceProof":false,"restoreQualified":false}')


if __name__=="__main__":
    def interrupted(*_):raise Stopped("synthetic_native_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception:
        print('{"ok":false,"error":"synthetic_native_smoke_unqualified","sourceProof":false}')
        raise SystemExit(1)
