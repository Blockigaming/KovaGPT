#!/usr/bin/env python3
"""Read only metadata for a data-free isolated recovery rehearsal.

The protected production URL is scoped to this short-lived collector only.
Neither Auth rows, application rows, large-object bytes nor password hashes
are read. Private metadata is never an upload artifact. Suspicious/custom GUC
values are fingerprinted and withheld, making source compatibility incomplete.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import tempfile
import uuid
from urllib.parse import urlparse

_image_spec=importlib.util.spec_from_file_location("metadata_verified_server_image",Path(__file__).with_name("verified-server-image.py"))
server_image=importlib.util.module_from_spec(_image_spec);_image_spec.loader.exec_module(server_image)
IMAGE=server_image.TRANSPORT_REF
MAX_BYTES = 8*1024**2
EXTENSION_COVERAGE = Path(__file__).with_name("extension-member-semantics-preflight.sql")
SCRIPT = Path(__file__).with_name("managed-auth-recovery.py")
spec = importlib.util.spec_from_file_location("empty_recovery_metadata_source", SCRIPT)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
PROJECT, BUILD = recovery.PROJECT, recovery.BUILD
SAFE_GUC_KEYS = {
    "search_path", "statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout",
    "idle_session_timeout", "default_transaction_read_only", "pgrst.db_schemas",
    "pgrst.db_extra_search_path", "pgrst.db_pre_request", "pgrst.db_anon_role",
    "pgrst.db_max_rows", "pgrst.db_plan_enabled", "pgrst.db_channel", "pgrst.db_channel_enabled",
    "pgrst.db_prepared_statements", "pgrst.db_tx_end", "pgrst.db_root_spec",
    "pgrst.db_aggregates_enabled", "pgrst.db_hoisted_tx_settings",
}
SOURCE_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
 'format',1,'project','mfbycmbjygcfkrsuepxf','postgresBuild','17.6.1.155',
 'serverVersionNum',current_setting('server_version_num')::int,
 'database',current_database(),'readOnly',current_setting('transaction_read_only')='on',
 'bootstrapRole',(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=10),
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname),'[]') FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl,'comment',obj_description(n.oid,'pg_namespace')) ORDER BY n.nspname),'[]') FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'),
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil) ORDER BY rolname),'[]') FROM pg_catalog.pg_roles),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid,member),'[]') FROM pg_catalog.pg_auth_members),
 'roleSettings',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',CASE WHEN s.setrole=0 THEN '*' ELSE pg_get_userbyid(s.setrole) END,'database',coalesce(d.datname,'*'),'settings',s.setconfig) ORDER BY s.setrole,s.setdatabase),'[]') FROM pg_catalog.pg_db_role_setting s LEFT JOIN pg_catalog.pg_database d ON d.oid=s.setdatabase)
)::text;
COMMIT;
"""


class Stopped(Exception):
    pass


PUBLIC_FAILURE_CODES=frozenset({
    'extension_coverage_result_shape',
    'extension_coverage_result_unqualified',
    'metadata_command_unconfirmed',
    'metadata_ca_bundle_unqualified',
    'metadata_environment_shape_rejected',
    'metadata_execution_not_enabled',
    'metadata_image_pin_mismatch',
    'metadata_interrupted',
    'metadata_not_enabled',
    'metadata_output_bound',
    'metadata_output_exists',
    'metadata_private_output_required',
    'metadata_query_transaction_unqualified',
    'metadata_reader_cleanup_unconfirmed',
    'metadata_reader_ownership_mismatch',
    'metadata_result_count_unqualified',
    'metadata_source_pin_mismatch',
    'metadata_source_shape_rejected',
    'role_setting_shape_rejected',
    'source_url_in_metadata_rejected',
})
PUBLIC_STAGE="authorization"
PUBLIC_STAGES=frozenset({"authorization","source-config","server-image","private-source-environment",
    "source-query-and-cleanup","metadata-validation","private-output"})
SQLSTATES=frozenset({"42601","42703","42883","42704","42501","57014","08001","08006","XX000"})


def public_failure(error):
    code=str(error) if isinstance(error,(Stopped,recovery.Stopped,server_image.Stopped)) else ''
    allowed=PUBLIC_FAILURE_CODES|recovery.PUBLIC_FAILURE_CODES|server_image.PUBLIC_FAILURE_CODES
    result={'ok':False,'error':'empty_recovery_metadata_unqualified',
            'stage':PUBLIC_STAGE if PUBLIC_STAGE in PUBLIC_STAGES else 'authorization',
            'code':code if code in allowed else 'unclassified_private_failure'}
    status=getattr(error,'command_status',None)
    if type(status) is str and status in {'exit','signal','timeout','os-error'}:
        result['commandStatus']=status
        value=getattr(error,'exit_code',None)
        if type(value) is int and -255<=value<=255:result['exitCode']=value
    state=getattr(error,'sqlstate',None)
    if type(state) is str and state in SQLSTATES:result['sqlstate']=state
    return result


def command_failure(status,exit_code=None,stderr=b''):
    error=Stopped('metadata_command_unconfirmed')
    error.command_status=status;error.exit_code=exit_code
    # psql is asked for SQLSTATE-only errors; never emit its raw stderr.
    for match in re.finditer(rb'(?:ERROR|FATAL):[ \t]+([A-Z0-9]{5})(?:[\r\n]|$)',stderr):
        state=match[1].decode('ascii')
        if state in SQLSTATES:error.sqlstate=state
    return error


def require(ok, code):
    if not ok:
        raise Stopped(code)


def canonical(value):
    return (json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def host_env():
    return {k:v for k,v in os.environ.items() if k in {"PATH","HOME","LANG","LC_ALL","TZ","TMPDIR"}}


def bounded_child():
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_BYTES,MAX_BYTES))


def command(args, *, data=None, timeout=120):
    try:
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            result=subprocess.run(args,input=data,stdout=out,stderr=err,
                                  env=host_env(),timeout=timeout,check=False,preexec_fn=bounded_child)
            if result.returncode!=0:
                err.seek(0)
                raise command_failure("signal" if result.returncode<0 else "exit",result.returncode,err.read(65536))
            require(out.tell()<=MAX_BYTES,"metadata_output_bound")
            out.seek(0)
            return out.read(MAX_BYTES+1)
    except subprocess.TimeoutExpired:raise command_failure("timeout") from None
    except (OSError,subprocess.SubprocessError):raise command_failure("os-error") from None


def source_pin(env):
    require(env.get("KOVA_EMPTY_PROBE_CONFIRMATION")=="PROBE_EMPTY_ONLY"
            and env.get("GITHUB_EVENT_NAME")=="workflow_dispatch"
            and env.get("GITHUB_REPOSITORY")=="Blockigaming/KovaGPT"
            and env.get("GITHUB_REF")=="refs/heads/main"
            and env.get("KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION")==BUILD, "metadata_not_enabled")
    commit=command(["git","rev-parse","HEAD"],timeout=5).decode().strip()
    require(re.fullmatch(r"[a-f0-9]{40}",commit)
            and env.get("GITHUB_SHA")==commit and env.get("KOVA_APPROVED_SOURCE_SHA")==commit,
            "metadata_source_pin_mismatch")
    return commit


def retained_setting(item, *, role=None, database=None):
    require(isinstance(item,str) and "=" in item and "\x00" not in item,"role_setting_shape_rejected")
    key,value=item.split("=",1)
    lower=key.lower()
    if key=="app.settings.jwt_exp":
        return re.fullmatch(r"[0-9]{1,8}",value) is not None and 1<=int(value)<=31536000
    if key=="log_statement":
        return value in {"none","ddl","mod","all"}
    if key=="session_preload_libraries":
        # Preserve only the known inert *configuration* of an inactive PostgREST
        # role. No source library is loaded in the distinct restore operator.
        # Active/session/local/shared preload and worker checks remain empty.
        if role!="authenticator" or database not in {"*","postgres"} or len(value)>2048:return False
        names=[]
        for part in value.split(","):
            token=part.strip()
            if token.startswith('"') and token.endswith('"'):token=token[1:-1]
            if token not in {"safeupdate","supautils"}:return False
            names.append(token)
        return bool(names) and len(names)==len(set(names))
    # Some managed roles store an escaped $user token in search_path. Check
    # that one supported escape without changing the retained setting bytes.
    # Other backslashes and executable/configuration keys stay rejected.
    checked_value=value.replace(r"\$user","$user") if key=="search_path" else value
    return (key in SAFE_GUC_KEYS and len(value)<=2048
            and not any(part in lower for part in ["password","secret","token","credential","jwt","preload"])
            and not any(part in value.lower() for part in ["://","sk-","-----begin "])
            and re.fullmatch(r'[a-zA-Z0-9_.,* $"\-]*',checked_value) is not None)


def remove_metadata_reader(owner, name):
    """Reconcile an uncertain docker run by an exact private ownership label."""
    def names():
        return command(["docker","ps","--all","--filter","label=org.kova.metadata-owner="+owner,
                        "--format","{{.Names}}"],timeout=15).decode().splitlines()
    present=names()
    require(set(present)<={name},"metadata_reader_ownership_mismatch")
    if present:
        command(["docker","rm","--force",name],timeout=15)
    require(names()==[],"metadata_reader_cleanup_unconfirmed")


def sanitize_settings(raw):
    require(raw.get("format")==1 and raw.get("project")==PROJECT and raw.get("postgresBuild")==BUILD
            and raw.get("serverVersionNum")==170006 and raw.get("database")=="postgres"
            and raw.get("readOnly") is True,"metadata_source_shape_rejected")
    require(all(isinstance(raw.get(k),list) for k in ["extensions","schemas","roles","memberships","roleSettings"]),
            "metadata_source_shape_rejected")
    require(isinstance(raw.get("bootstrapRole"),str) and recovery.IDENT.fullmatch(raw["bootstrapRole"])
            and not raw["bootstrapRole"].startswith("pg_"),"metadata_source_shape_rejected")
    out={k:raw[k] for k in ["format","project","postgresBuild","serverVersionNum","database","bootstrapRole","extensions","schemas","roles","memberships"]}
    settings=[];withheld=0
    for row in raw["roleSettings"]:
        require(isinstance(row,dict) and isinstance(row.get("role"),str) and isinstance(row.get("database"),str)
                and isinstance(row.get("settings"),list),"role_setting_shape_rejected")
        fingerprints=[];retained=[]
        for item in row["settings"]:
            keep=retained_setting(item,role=row["role"],database=row["database"])
            fingerprints.append({"key":item.split("=",1)[0],"sha256":sha(item.encode()),"retained":keep})
            if keep:retained.append(item)
            else:withheld+=1
        settings.append({"role":row["role"],"database":row["database"],"settings":retained,
                         "settingFingerprints":fingerprints})
    out.update(roleSettings=settings,sourceSettingsComplete=withheld==0,withheldSettingCount=withheld,
               sourceQueryReadOnly=True,customerRowsRead=False,passwordHashesRead=False,sourceUrlStored=False)
    return out


def source_query(extension_coverage):
    if not extension_coverage:return SOURCE_SQL
    # Two fixed metadata SELECTs share one read-only snapshot; no row export.
    require(SOURCE_SQL.rstrip().endswith("COMMIT;"),"metadata_query_transaction_unqualified")
    body=SOURCE_SQL.rstrip()[:-len("COMMIT;")]
    body=body.replace("READ ONLY;", "READ ONLY;\nSET LOCAL search_path=pg_catalog;",1)
    return body+EXTENSION_COVERAGE.read_text()+"\nCOMMIT;\n"


def check_extension_coverage(proof):
    require(isinstance(proof,dict) and proof.get("format")==1
        and proof.get("operation")=="extension-member-semantics-coverage-preflight"
        and proof.get("serverVersionNum")==170006
        and all(proof.get(k) is False for k in ["qualified","qualificationReady","semanticEqualityProven",
           "catalogPayloadAdaptersImplemented","deparsedDdlTreatedAsExact","customerRowsRead",
           "rawMetadataReturned","productionMutated"]),"extension_coverage_result_unqualified")
    require(all(re.fullmatch(r"[a-f0-9]{64}",proof.get(k,"")) for k in
            ["memberInventorySha256","dependencyInventorySha256"])
        and isinstance(proof.get("counts"),dict)
        and all(type(n) is int and n>=0 for n in proof["counts"].values()),
        "extension_coverage_result_shape")
    return proof


def parse_source_output(raw, extension_coverage):
    lines=[line for line in raw.splitlines() if line.strip()]
    require(len(lines)==(2 if extension_coverage else 1),"metadata_result_count_unqualified")
    value=sanitize_settings(json.loads(lines[0]))
    if extension_coverage:
        proof=json.loads(lines[1])
        check_extension_coverage(proof)
        value["extensionCoverage"]=proof
        value["extensionCoverageQuerySha256"]=sha(EXTENSION_COVERAGE.read_bytes())
    return value


def collect(env, output, *, extension_coverage=False):
    global PUBLIC_STAGE
    PUBLIC_STAGE="authorization"
    commit=source_pin(env)
    require(not output.exists() and not output.is_symlink(),"metadata_output_exists")
    root=Path(env.get("RUNNER_TEMP","")).resolve()
    require(root.is_dir() and output.is_absolute() and output.parent.resolve().is_relative_to(root)
            and not output.parent.exists(),"metadata_private_output_required")
    PUBLIC_STAGE='source-config'
    source=recovery.source_environment(env)
    PUBLIC_STAGE='server-image'
    qualified=server_image.qualify(command)
    require(qualified["imageInfo"].get("Architecture")=="amd64" and qualified["imageInfo"].get("Os")=="linux",
            "metadata_image_pin_mismatch")
    output.parent.mkdir(mode=0o700)
    success=False
    try:
        with tempfile.TemporaryDirectory(prefix="kova-metadata-secret-",dir=root) as temporary:
            private=Path(temporary);private.chmod(0o700)
            PUBLIC_STAGE='private-source-environment'
            values={k:v for k,v in source.items() if k.startswith("PG")}
            # The libpq host CA path is outside the container. Copy only the
            # selected public trust roots into this run's private directory,
            # and expose that single file read-only at a fixed container path.
            ca=Path(values.get("PGSSLROOTCERT",""))
            require(ca.is_file() and not ca.is_symlink() and 0<ca.stat().st_size<=1024**2,
                    "metadata_ca_bundle_unqualified")
            mounted_ca=private/"source-ca.crt"
            require(not any(c in str(mounted_ca) for c in ",\r\n\x00"),"metadata_ca_bundle_unqualified")
            with mounted_ca.open("xb") as stream:
                stream.write(ca.read_bytes())
            mounted_ca.chmod(0o444)
            values["PGSSLROOTCERT"]="/run/kova-source-ca.crt"
            require(all(isinstance(v,str) and "\n" not in v and "\r" not in v and "\x00" not in v
                        for v in values.values()),"metadata_environment_shape_rejected")
            file=private/"source-pg-env"
            with file.open("x") as f:
                file.chmod(0o600)
                for key,value in values.items():f.write(key+"="+value+"\n")
            PUBLIC_STAGE='source-query-and-cleanup'
            owner=uuid.uuid4().hex;name="kova-meta-"+owner[:16]
            try:
                raw=command(["docker","run","--interactive","--rm","--name",name,"--label","org.kova.metadata-owner="+owner,
                             "--platform","linux/amd64","--user",f"{os.getuid()}:{os.getgid()}",
                             "--read-only","--no-healthcheck","--cap-drop","ALL","--security-opt","no-new-privileges:true",
                             "--network","bridge","--env-file",str(file),
                             "--mount","type=bind,source="+str(mounted_ca)+",target=/run/kova-source-ca.crt,readonly",
                             "--entrypoint","psql",IMAGE,
                             "-X","--no-password","--quiet","--tuples-only","--no-align","--set","ON_ERROR_STOP=1","--set","VERBOSITY=sqlstate","--file","-"],
                            data=source_query(extension_coverage).encode(),timeout=150)
            finally:
                remove_metadata_reader(owner,name)
            PUBLIC_STAGE='metadata-validation'
            value=parse_source_output(raw,extension_coverage)
            value.update(databaseHost=urlparse(env["KOVA_PRODUCTION_DATABASE_URL"]).hostname,
                         sourceCommit=commit,metadataImageDigest=IMAGE,sourceBuildOperatorPin=BUILD,
                         metadataActualRepoDigest=qualified["receipt"]["actualRepoDigest"],
                         metadataImageQualification=qualified["receipt"],
                         sourcePackagingBuildObservedBySql=False)
            PUBLIC_STAGE='private-output'
            data=canonical(value)
            require(env["KOVA_PRODUCTION_DATABASE_URL"].encode() not in data,"source_url_in_metadata_rejected")
            with output.open("xb") as f:
                output.chmod(0o600);f.write(data)
        success=True
        return {"operation":"empty-recovery-metadata-only","sourceCommit":commit,"metadataSha256":sha(data),
                "sourceRoleCount":len(value["roles"]),"sourceExtensionCount":len(value["extensions"]),
                "withheldSettingCount":value["withheldSettingCount"],"customerRowsRead":False,
                "passwordHashesRead":False,"rawMetadataUploaded":False,"productionMutated":False}
    finally:
        if not success:
            if output.is_file():output.unlink()
            if output.parent.exists():output.parent.rmdir()


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true")
    parser.add_argument("--output",required=True)
    parser.add_argument("--extension-coverage",action="store_true")
    args=parser.parse_args()
    require(args.execute,"metadata_execution_not_enabled")
    receipt=collect(os.environ,Path(args.output),extension_coverage=args.extension_coverage)
    print(json.dumps(receipt,sort_keys=True,separators=(",",":")))


if __name__=="__main__":
    def interrupted(*_):raise Stopped("metadata_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception as error:
        print(json.dumps(public_failure(error),sort_keys=True,separators=(",",":")))
        raise SystemExit(1)
