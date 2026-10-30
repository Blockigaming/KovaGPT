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

IMAGE = "public.ecr.aws/supabase/postgres@sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
MAX_BYTES = 8*1024**2
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
        with tempfile.TemporaryFile() as out:
            result=subprocess.run(args,input=data,stdout=out,stderr=subprocess.DEVNULL,
                                  env=host_env(),timeout=timeout,check=False,preexec_fn=bounded_child)
            require(result.returncode==0,"metadata_command_unconfirmed")
            require(out.tell()<=MAX_BYTES,"metadata_output_bound")
            out.seek(0)
            return out.read(MAX_BYTES+1)
    except (OSError,subprocess.SubprocessError):
        raise Stopped("metadata_command_unconfirmed") from None


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


def retained_setting(item):
    require(isinstance(item,str) and "=" in item and "\x00" not in item,"role_setting_shape_rejected")
    key,value=item.split("=",1)
    lower=key.lower()
    return (key in SAFE_GUC_KEYS and len(value)<=2048
            and not any(part in lower for part in ["password","secret","token","credential","jwt","preload"])
            and not any(part in value.lower() for part in ["://","sk-","-----begin "])
            and re.fullmatch(r'[a-zA-Z0-9_.,* $"\-]*',value) is not None)


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
    out={k:raw[k] for k in ["format","project","postgresBuild","serverVersionNum","database","extensions","schemas","roles","memberships"]}
    settings=[];withheld=0
    for row in raw["roleSettings"]:
        require(isinstance(row,dict) and isinstance(row.get("role"),str) and isinstance(row.get("database"),str)
                and isinstance(row.get("settings"),list),"role_setting_shape_rejected")
        fingerprints=[];retained=[]
        for item in row["settings"]:
            keep=retained_setting(item)
            fingerprints.append({"key":item.split("=",1)[0],"sha256":sha(item.encode()),"retained":keep})
            if keep:retained.append(item)
            else:withheld+=1
        settings.append({"role":row["role"],"database":row["database"],"settings":retained,
                         "settingFingerprints":fingerprints})
    out.update(roleSettings=settings,sourceSettingsComplete=withheld==0,withheldSettingCount=withheld,
               sourceQueryReadOnly=True,customerRowsRead=False,passwordHashesRead=False,sourceUrlStored=False)
    return out


def collect(env, output):
    commit=source_pin(env)
    require(not output.exists() and not output.is_symlink(),"metadata_output_exists")
    root=Path(env.get("RUNNER_TEMP","")).resolve()
    require(root.is_dir() and output.is_absolute() and output.parent.resolve().is_relative_to(root)
            and not output.parent.exists(),"metadata_private_output_required")
    source=recovery.source_environment(env)
    command(["docker","pull","--platform","linux/amd64",IMAGE],timeout=300)
    image=json.loads(command(["docker","image","inspect",IMAGE]))
    require(len(image)==1 and image[0].get("Architecture")=="amd64" and image[0].get("Os")=="linux"
            and IMAGE in image[0].get("RepoDigests",[]),"metadata_image_pin_mismatch")
    output.parent.mkdir(mode=0o700)
    success=False
    try:
        with tempfile.TemporaryDirectory(prefix="kova-metadata-secret-",dir=root) as temporary:
            private=Path(temporary);private.chmod(0o700)
            values={k:v for k,v in source.items() if k.startswith("PG")}
            require(all(isinstance(v,str) and "\n" not in v and "\r" not in v and "\x00" not in v
                        for v in values.values()),"metadata_environment_shape_rejected")
            file=private/"source-pg-env"
            with file.open("x") as f:
                file.chmod(0o600)
                for key,value in values.items():f.write(key+"="+value+"\n")
            owner=uuid.uuid4().hex;name="kova-meta-"+owner[:16]
            try:
                raw=command(["docker","run","--rm","--name",name,"--label","org.kova.metadata-owner="+owner,
                             "--platform","linux/amd64","--user",f"{os.getuid()}:{os.getgid()}",
                             "--read-only","--no-healthcheck","--cap-drop","ALL","--security-opt","no-new-privileges:true",
                             "--network","bridge","--env-file",str(file),"--entrypoint","psql",IMAGE,
                             "-X","--no-password","--quiet","--tuples-only","--no-align","--set","ON_ERROR_STOP=1","--file","-"],
                            data=SOURCE_SQL.encode(),timeout=150)
            finally:
                remove_metadata_reader(owner,name)
            value=sanitize_settings(json.loads(raw))
            value.update(databaseHost=urlparse(env["KOVA_PRODUCTION_DATABASE_URL"]).hostname,
                         sourceCommit=commit,metadataImageDigest=IMAGE,sourceBuildOperatorPin=BUILD,
                         sourcePackagingBuildObservedBySql=False)
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
    args=parser.parse_args()
    require(args.execute,"metadata_execution_not_enabled")
    receipt=collect(os.environ,Path(args.output))
    print(json.dumps(receipt,sort_keys=True,separators=(",",":")))


if __name__=="__main__":
    def interrupted(*_):raise Stopped("metadata_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception:
        print('{"ok":false,"error":"empty_recovery_metadata_unqualified"}')
        raise SystemExit(1)
