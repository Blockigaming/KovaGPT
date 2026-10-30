#!/usr/bin/env python3
"""Data-free native image/target probe; never restores a customer backup.

Run only on the explicitly selected GitHub-hosted Linux runner. Source metadata
is supplied through an owned private file by a separate read-only step. Neither
production connection strings nor provider credentials may enter this process
or any target/client environment. Raw subprocess output is never published.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import shlex
import socket
import stat
import subprocess
import tempfile
import time

BUILD = "17.6.1.155"
ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("kova_recovery", Path(__file__).with_name("managed-auth-recovery.py"))
recovery = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recovery)
_metadata_spec = importlib.util.spec_from_file_location("kova_empty_metadata", Path(__file__).with_name("collect-empty-recovery-metadata.py"))
metadata_source = importlib.util.module_from_spec(_metadata_spec)
_metadata_spec.loader.exec_module(metadata_source)
server_image=metadata_source.server_image
IMAGE=server_image.TRANSPORT_REF
IDENT = re.compile(r"[a-z_][a-z0-9_]*\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
OPERATOR = "kova_probe_operator"
HOST_KEYS = {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY",
             "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
             "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE"}
FORBIDDEN_ENV = {"KOVA_PRODUCTION_DATABASE_URL", "PGPASSWORD", "OPENAI_API_KEY", "ELEVENLABS_API_KEY",
                 "RESEND_API_KEY", "KOVA_AUTH_JWT_PRIVATE_KEY", "KOVA_AUTH_ENCRYPTION_KEY",
                 "KOVA_PRODUCTION_BACKUP_PASSPHRASE"}
SAFE_SETTINGS = metadata_source.SAFE_GUC_KEYS
NATIVE_WORKERS = {"client backend", "checkpointer", "background writer", "walwriter",
                  "autovacuum launcher", "logical replication launcher"}
NETNS_HELPER = """import os,subprocess,sys
pid=int(sys.argv[1]);expected=int(sys.argv[2]);tool=sys.argv[3]
assert pid>1 and tool in ('iptables','ip6tables','ip')
fd=os.open('/proc/'+str(pid)+'/ns/net',os.O_RDONLY)
try:
 assert os.fstat(fd).st_ino==expected
 assert expected!=os.stat('/proc/self/ns/net').st_ino
 command=['nsenter','--net=/proc/self/fd/'+str(fd),tool,*sys.argv[4:]]
 result=subprocess.run(command,pass_fds=(fd,),check=False)
 raise SystemExit(result.returncode)
finally:os.close(fd)
"""


class Stopped(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Stopped(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def private_file(path):
    p = Path(path)
    s = p.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and not s.st_mode & 0o077,
            "private_input_required")
    return p


def write_private(path, data):
    with Path(path).open("xb") as target:
        os.chmod(path, 0o600)
        target.write(data)


def clean_host_env(env):
    return {k:v for k,v in env.items() if k in HOST_KEYS}


def checked_context(env):
    require(env.get("KOVA_EMPTY_PROBE_CONFIRMATION") == "PROBE_EMPTY_ONLY", "probe_not_enabled")
    require(env.get("GITHUB_ACTIONS") == "true" and env.get("RUNNER_OS") == "Linux"
            and env.get("GITHUB_REPOSITORY") == "Blockigaming/KovaGPT"
            and env.get("GITHUB_REF") == "refs/heads/main", "github_linux_main_required")
    sha = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", sha) and env.get("KOVA_APPROVED_SOURCE_SHA") == sha,
            "source_pin_mismatch")
    require(not any(env.get(k) for k in FORBIDDEN_ENV), "production_credentials_in_probe_environment")
    return sha


def ident(value):
    require(isinstance(value, str) and IDENT.fullmatch(value), "metadata_identifier_unqualified")
    return '"' + value + '"'


def literal(value):
    require(isinstance(value, str) and "\x00" not in value and len(value) <= 8192,
            "metadata_literal_unqualified")
    return "'" + value.replace("'", "''") + "'"


def safe_setting(raw, *, role=None, database=None):
    require(isinstance(raw, str) and "=" in raw and len(raw) <= 2048, "source_setting_unqualified")
    key, value = raw.split("=", 1)
    require(metadata_source.retained_setting(raw,role=role,database=database),
            "source_setting_unqualified")
    return key, value


def validate_metadata(metadata, *, source_sha):
    require(isinstance(metadata, dict) and metadata.get("format") == 1
            and metadata.get("project") == recovery.PROJECT and metadata.get("postgresBuild") == BUILD,
            "source_metadata_unqualified")
    require(metadata.get("sourceCommit")==source_sha and metadata.get("metadataImageDigest")==IMAGE
            and metadata.get("sourceBuildOperatorPin")==BUILD and metadata.get("serverVersionNum")==170006
            and metadata.get("database")=="postgres" and metadata.get("sourceQueryReadOnly") is True
            and all(metadata.get(k) is False for k in ["customerRowsRead","passwordHashesRead","sourceUrlStored",
                                                      "sourcePackagingBuildObservedBySql"]),
            "source_metadata_provenance_unqualified")
    require(all(isinstance(metadata.get(k), list) for k in
                ["extensions", "schemas", "roles", "memberships", "roleSettings"]), "source_metadata_shape")
    role_names = set()
    for role in metadata["roles"]:
        name = role.get("name")
        ident(name)
        require(name != OPERATOR and name not in role_names, "source_role_conflict")
        role_names.add(name)
        require(all(type(role.get(k)) is bool for k in
                    ["super", "inherit", "createRole", "createDb", "login", "replication", "bypassRls"]),
                "source_role_attributes_unqualified")
        require(type(role.get("connectionLimit")) is int and -1 <= role["connectionLimit"] <= 1000000
                and (role.get("validUntil") is None or isinstance(role["validUntil"], str)),
                "source_role_attributes_unqualified")
    for row in metadata["memberships"]:
        require(all(row.get(k) in role_names for k in ["role", "member", "grantor"])
                and all(type(row.get(k)) is bool for k in ["admin", "inherit", "set"]),
                "source_membership_unqualified")
    schemas = {}
    for row in metadata["schemas"]:
        ident(row.get("name"));require(row.get("owner") in role_names, "source_schema_owner_unqualified")
        require(row["name"] not in schemas and (row.get("acl") is None or isinstance(row["acl"], list))
                and (row.get("comment") is None or isinstance(row["comment"], str)), "source_schema_unqualified")
        schemas[row["name"]] = row
    extensions = set()
    for row in metadata["extensions"]:
        name = row.get("name")
        require(isinstance(name, str) and re.fullmatch(r"[a-z_][a-z0-9_-]*", name)
                and name not in extensions and isinstance(row.get("version"), str)
                and re.fullmatch(r"[a-zA-Z0-9_.+-]+", row["version"]), "source_extension_unqualified")
        require(row.get("owner") in role_names and not row["owner"].startswith("pg_"),
                "source_extension_owner_unqualified")
        ident(row.get("schema"));extensions.add(name)
    require("plpgsql" in extensions, "source_plpgsql_missing")
    withheld=0
    for row in metadata["roleSettings"]:
        require(row.get("role") == "*" or row.get("role") in role_names, "source_setting_role_unqualified")
        require(row.get("database") in {"*", "postgres"} and isinstance(row.get("settings"), list),
                "source_setting_database_unqualified")
        for raw in row["settings"]:safe_setting(raw,role=row["role"],database=row["database"])
        fingerprints=row.get("settingFingerprints")
        require(isinstance(fingerprints,list),"source_setting_fingerprint_coverage_missing")
        retained=[]
        for entry in fingerprints:
            require(isinstance(entry,dict) and isinstance(entry.get("key"),str)
                    and SHA.fullmatch(entry.get("sha256", "")) and type(entry.get("retained")) is bool,
                    "source_setting_fingerprint_unqualified")
            if entry["retained"]:retained.append(entry)
            else:withheld+=1
        require(retained==[{"key":raw.split("=",1)[0],"sha256":digest(raw.encode()),"retained":True}
                           for raw in row["settings"]],"source_setting_fingerprint_mismatch")
    require(type(metadata.get("sourceSettingsComplete")) is bool
            and type(metadata.get("withheldSettingCount")) is int and metadata["withheldSettingCount"]==withheld
            and metadata["sourceSettingsComplete"]==(withheld==0),
            "source_setting_coverage_missing")
    if "extensionCoverage" in metadata:
        metadata_source.check_extension_coverage(metadata["extensionCoverage"])
        require(metadata.get("extensionCoverageQuerySha256")==digest(metadata_source.EXTENSION_COVERAGE.read_bytes()),
                "source_extension_coverage_query_unqualified")
    return metadata


def role_attributes_sql(row):
    flags = [("super", "SUPERUSER"), ("inherit", "INHERIT"), ("createRole", "CREATEROLE"),
             ("createDb", "CREATEDB"), ("login", "LOGIN"), ("replication", "REPLICATION"),
             ("bypassRls", "BYPASSRLS")]
    attributes = " ".join(token if row[key] else "NO"+token for key,token in flags)
    return "ALTER ROLE "+ident(row["name"])+" "+attributes+" CONNECTION LIMIT "+str(row["connectionLimit"]) \
        +(" VALID UNTIL "+literal(row["validUntil"]) if row.get("validUntil") is not None else "")+";"


def extension_owner_bootstrap_sql(metadata, *, restore=False):
    """Temporary data-free installation authority, always restored before proof.

    Source owner roles have no copied passwords or live sessions here. The
    isolation layers already deny network egress before this metadata-only
    bootstrap; final catalog/role comparison must prove the original flags.
    """
    owners={e["owner"] for e in metadata["extensions"]}
    rows={r["name"]:r for r in metadata["roles"]}
    return "\n".join(role_attributes_sql(rows[name]) if restore else
                     "ALTER ROLE "+ident(name)+" SUPERUSER;" for name in sorted(owners))+"\n"


def extension_create_sql(extension):
    return "SET ROLE "+ident(extension["owner"])+";\nCREATE EXTENSION "+'"'+extension["name"]+'"' \
        +" WITH SCHEMA "+ident(extension["schema"])+" VERSION "+literal(extension["version"])+";\nRESET ROLE;\n"


def role_setup_sql(metadata):
    """Only data-free catalog metadata; identifiers/literals never interpolated unchecked."""
    statements = ["SET statement_timeout='30s'; SET lock_timeout='5s';"]
    for row in sorted(metadata["roles"], key=lambda r:r["name"]):
        name = row["name"]
        if name.startswith("pg_"):
            continue  # PG17 built-ins must already match; never replace them.
        qname = ident(name)
        statements += ["DO $role$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname="+literal(name)+") THEN CREATE ROLE "+qname+"; END IF; END $role$;",
                       role_attributes_sql(row)]
    for row in metadata["memberships"]:
        grant = "GRANT "+ident(row["role"])+" TO "+ident(row["member"])
        for option in ["admin", "inherit", "set"]:
            statements.append(grant+" WITH "+option.upper()+" "+str(row[option]).upper()+" GRANTED BY "+ident(row["grantor"])+";")
    for row in metadata["roleSettings"]:
        for setting in row["settings"]:
            key,value=safe_setting(setting,role=row["role"],database=row["database"])
            if row["role"] == "*":
                require(row["database"] == "postgres", "global_database_setting_unqualified")
                prefix="ALTER DATABASE postgres"
            else:
                prefix="ALTER ROLE "+ident(row["role"])
                if row["database"] != "*":prefix+=" IN DATABASE "+ident(row["database"])
            statements.append(prefix+" SET "+'"'+key+'"'+" TO "+literal(value)+";")
    return "\n".join(statements)+"\n"


def schema_setup_sql(metadata):
    statements = []
    for row in sorted(metadata["schemas"], key=lambda r:r["name"]):
        name=ident(row["name"])
        statements += ["CREATE SCHEMA IF NOT EXISTS "+name+";",
                       "ALTER SCHEMA "+name+" OWNER TO "+ident(row["owner"])+";",
                       "COMMENT ON SCHEMA "+name+" IS "+("NULL" if row.get("comment") is None else literal(row["comment"]))+";"]
    return "\n".join(statements)+"\n"


def schema_acl_sql(metadata):
    """Rebuild exact schema grants, including grantor, from typed aclitem metadata."""
    statements=[]
    roles=["PUBLIC"]+[ident(r["name"]) for r in metadata["roles"]]+[ident(OPERATOR)]
    for row in metadata["schemas"]:
        schema=ident(row["name"])
        if row.get("acl") is None:
            # A freshly created namespace retains NULL. Turning it into an
            # explicit grant would change the catalog rather than preserve it.
            continue
        acl="ARRAY["+",".join(literal(x) for x in row["acl"])+"]::aclitem[]"
        statements.append("REVOKE ALL ON SCHEMA "+schema+" FROM "+", ".join(roles)+";")
        # SET ROLE is needed: PostgreSQL object GRANTED BY must be current_user.
        statements.append("DO $acl$ DECLARE a record; BEGIN FOR a IN SELECT * FROM aclexplode("+acl+") LOOP "
            "EXECUTE format('SET ROLE %I',pg_get_userbyid(a.grantor)); "
            "EXECUTE format('GRANT %s ON SCHEMA %I TO %s%s',a.privilege_type,"+literal(row["name"])+","
            "CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,"
            "CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END); "
            "RESET ROLE; END LOOP; END $acl$;")
    return "\n".join(statements)+"\n"


def denial_targets(metadata, resolver=socket.getaddrinfo):
    hosts=[("production-https", "kovagpt.com",443),
           ("production-database", "db."+recovery.PROJECT+".supabase.co",5432)]
    extra=metadata.get("databaseHost")
    if extra:
        require(isinstance(extra,str) and re.fullmatch(r"[a-zA-Z0-9.-]+",extra)
                and (extra.endswith(".pooler.supabase.com") or extra==hosts[1][1]), "database_denial_host_unqualified")
        hosts.append(("production-database",extra,5432))
    result=set()
    for kind,host,port in hosts:
        try:addresses=resolver(host,port,type=socket.SOCK_STREAM)
        except OSError:raise Stopped("production_denial_resolution_unconfirmed") from None
        for family,_,_,_,addr in addresses:
            if family in {socket.AF_INET,socket.AF_INET6}:
                ip=ipaddress.ip_address(addr[0])
                require(ip.is_global, "production_denial_address_not_global")
                result.add((kind,str(ip),port))
    require(any(ipaddress.ip_address(ip).version==4 for _,ip,_ in result)
            and any(ipaddress.ip_address(ip).version==6 for _,ip,_ in result)
            and any(kind=="production-database" for kind,_,_ in result)
            and any(kind=="production-https" for kind,_,_ in result), "dual_stack_production_denial_targets_missing")
    return sorted(result)


class Probe:
    def __init__(self, metadata, env, output):
        self.source=checked_context(env)
        self.metadata=validate_metadata(metadata,source_sha=self.source)
        self.env=clean_host_env(env)
        self.run_id=env.get("GITHUB_RUN_ID","");self.attempt=env.get("GITHUB_RUN_ATTEMPT","")
        require(re.fullmatch(r"[1-9][0-9]*",self.run_id) and re.fullmatch(r"[1-9][0-9]*",self.attempt),
                "github_run_identity_missing")
        self.runner_temp=Path(env.get("RUNNER_TEMP","")).resolve()
        require(self.runner_temp.is_dir() and self.runner_temp!=Path("/"),"runner_temporary_directory_required")
        self.state_path=self.runner_temp/("kova-empty-owned-"+self.run_id+"-"+self.attempt+".json")
        require(not self.state_path.exists(),"owned_probe_attempt_already_reserved")
        self.output=Path(output)
        require(not self.output.exists(), "receipt_already_exists")
        require(self.output.name=="receipt.json" and self.output.resolve().is_relative_to(self.runner_temp),
                "receipt_path_outside_runner_temporary_directory")
        self.token=secrets.token_hex(5)
        self.network="kova-empty-"+self.token
        self.bridge="kr"+self.token
        self.chain="KRP"+self.token.upper()
        self.names={"a":"kova-empty-a-"+self.token,"b":"kova-empty-b-"+self.token,
                    "client":"kova-empty-client-"+self.token}
        self.addresses={"a":("172.30.240.2","fd68:6b6f:7661:240::2"),
                        "b":("172.30.240.3","fd68:6b6f:7661:240::3"),
                        "client":("172.30.240.4","fd68:6b6f:7661:240::4")}
        self.hosts={key:"kova-empty-"+key+".internal" for key in ["a","b"]}
        self.owner_label="kova.empty-probe.owner="+self.token
        self.containers_reserved=[]
        self.network_reserved=False
        self.firewall_reserved=[]
        self.cleanup_confirmed=False
        self.stage="initial"
        self.command_count=0
        self.last_stderr=b""
        self.private_root=None
        self.uid=os.getuid()
        self.gid=os.getgid()
        self.pg_uid=None
        self.pg_gid=None
        self.image_env={}
        self.image_volumes=[]
        self.host_firewall_pins={}
        self.native_tools={}
        self.network_evidence=[]
        self.netns={}
        self.neighbors=[]

    def run(self, argv, *, data=None, timeout=90, allow_failure=False):
        self.command_count+=1
        try:
            with tempfile.TemporaryFile() as stdout,tempfile.TemporaryFile() as stderr:
                result=subprocess.run(argv,input=data,stdout=stdout,stderr=stderr,env=self.env,
                                      timeout=timeout,check=False)
                require(stdout.tell() <= 32*1024**2 and stderr.tell() <= 8*1024**2,"private_command_output_bound")
                stdout.seek(0);stderr.seek(0)
                raw,diagnostics=stdout.read(),stderr.read()
                self.last_stderr=diagnostics
        except (OSError,subprocess.SubprocessError):
            raise Stopped("native_command_unconfirmed") from None
        if result.returncode and not allow_failure:
            # Only fixed native classes leave the private process.
            code="native_command_failed"
            if b"must be loaded" in diagnostics or b"shared_preload_libraries" in diagnostics:
                code="native_extension_preload_unqualified"
            elif b"permission denied" in diagnostics:code="native_permission_unqualified"
            elif b"does not exist" in diagnostics or b"not available" in diagnostics:code="native_dependency_unqualified"
            raise Stopped(code)
        return result.returncode,raw

    def docker(self,args,**kwargs):
        return self.run(["docker",*args],**kwargs)

    def inspect(self,name):
        _,raw=self.docker(["inspect",name])
        values=json.loads(raw)
        require(isinstance(values,list) and len(values)==1,"docker_identity_unconfirmed")
        return values[0]

    def reserve_absent(self,name):
        require(self.resource_absent(name),"docker_name_not_absent")
        self.containers_reserved.append(name)

    def resource_absent(self, name, *, network=False):
        # Docker inspect exits 1 for both absent objects AND unavailable daemon.
        # Only a successful full daemon census can establish absence.
        args=["network","ls","--no-trunc"] if network else ["ps","--all","--no-trunc"]
        code,raw=self.docker(args+["--format","{{json .}}"])
        require(code==0,"docker_census_unconfirmed")
        names=[];ids=[]
        for line in raw.splitlines():
            row=json.loads(line)
            object_id=row.get("ID","");object_name=row.get("Name" if network else "Names","")
            require(re.fullmatch(r"[a-f0-9]{64}",object_id) and isinstance(object_name,str)
                    and object_name and all(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*",n)
                                            for n in object_name.split(",")),"docker_census_unqualified")
            ids.append(object_id);names.extend(object_name.split(","))
        return name not in names and name not in ids

    def initialize(self):
        self.stage="native_tools"
        require(os.getuid()!=0,"nonroot_runner_required")
        _,raw=self.run(["git","rev-parse","HEAD"])
        require(raw.decode().strip()==self.source,"checked_out_source_mismatch")
        self.docker(["info","--format","{{.OSType}}"])
        qualified=server_image.qualify(lambda args,**kwargs:self.run(args,**kwargs))
        self.server_image_qualification=qualified["receipt"]
        info=qualified["imageInfo"]
        require(info.get("Os")=="linux" and info.get("Architecture")=="amd64"
                and info.get("Id")==self.server_image_qualification["imageId"],"pinned_image_identity_mismatch")
        self.image_env=dict(x.split("=",1) for x in info.get("Config",{}).get("Env",[]) if "=" in x)
        self.image_volumes=sorted((info.get("Config",{}).get("Volumes") or {}).keys())
        require(all(p.startswith("/") and not any(s in p for s in ["..",",",":","/proc","/sys","docker.sock"])
                    for p in self.image_volumes),"pinned_image_volume_unqualified")
        require(not any(k in FORBIDDEN_ENV for k in self.image_env),"pinned_image_contains_unexpected_credentials")
        _,raw=self.docker(["run","--rm","--no-healthcheck","--network","none","--cap-drop","ALL",
            "--security-opt","no-new-privileges:true","--user",str(self.uid)+":"+str(self.gid),
            "--read-only","--entrypoint","/bin/bash",IMAGE,"-ceu",
            "id -u postgres; id -g postgres; command -v postgres; command -v pg_ctl; command -v initdb; "
            "command -v psql; command -v pg_dump; command -v timeout; command -v sha256sum; postgres --version"],timeout=30)
        lines=raw.decode().splitlines()
        require(len(lines)==10 and lines[0].isdigit() and lines[1].isdigit()
                and re.fullmatch(r"postgres \(PostgreSQL\) 17\.6(?:\D.*)?",lines[-1]),"native_pg17_tools_unqualified")
        self.pg_uid,self.pg_gid=int(lines[0]),int(lines[1])
        require(self.pg_uid!=0,"nonroot_postgres_user_required")
        self.native_tools=dict(zip(["postgres","pg_ctl","initdb","psql","pg_dump","timeout","sha256sum"],lines[2:9]))
        require(all(p.startswith("/") and "\n" not in p for p in self.native_tools.values()),"native_tool_paths_unqualified")
        for tool in ["sudo","nsenter","iptables","ip6tables","ip","openssl","node"]:
            require(shutil.which(tool) is not None,"host_probe_dependency_missing")
        self.run(["sudo","-n","true"])

    def make_private_files(self,work):
        self.private_root=Path(work)
        os.chmod(work,0o700)
        self.client_dir=Path(work)/"client";self.client_dir.mkdir(mode=0o700)
        self.tls_dir=Path(work)/"tls";self.tls_dir.mkdir(mode=0o700)
        self.password=secrets.token_urlsafe(36)
        write_private(self.client_dir/"pgpass",("*:5432:postgres:"+OPERATOR+":"+self.password+"\n").encode())
        ca=self.tls_dir/"ca.crt";key=self.tls_dir/"ca.key"
        self.run(["openssl","req","-x509","-newkey","rsa:3072","-nodes","-days","1",
                  "-keyout",str(key),"-out",str(ca),"-subj","/CN=Kova data-free recovery probe"])
        os.chmod(key,0o600);os.chmod(ca,0o644)
        shutil.copyfile(ca,self.client_dir/"ca.crt");os.chmod(self.client_dir/"ca.crt",0o644)
        self.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-days","1",
                  "-keyout",str(self.tls_dir/"wrong-ca.key"),"-out",str(self.client_dir/"wrong-ca.crt"),
                  "-subj","/CN=Untrusted synthetic negative control"])
        os.chmod(self.tls_dir/"wrong-ca.key",0o600);os.chmod(self.client_dir/"wrong-ca.crt",0o644)
        self.server_dirs={}
        for target in ["a","b"]:
            directory=Path(work)/target;directory.mkdir(mode=0o700)
            data=directory/"data";data.mkdir(mode=0o700)
            self.server_dirs[target]=directory
            write_private(directory/"password",(self.password+"\n").encode())
            serverkey=directory/"server.key";csr=directory/"server.csr";cert=directory/"server.crt"
            self.run(["openssl","req","-newkey","rsa:3072","-nodes","-keyout",str(serverkey),
                      "-out",str(csr),"-subj","/CN="+self.hosts[target]])
            ext=directory/"certificate.ext"
            write_private(ext,("subjectAltName=DNS:"+self.hosts[target]+"\nextendedKeyUsage=serverAuth\n").encode())
            self.run(["openssl","x509","-req","-in",str(csr),"-CA",str(ca),"-CAkey",str(key),
                      "-CAcreateserial","-out",str(cert),"-days","1","-extfile",str(ext)])
            shutil.copyfile(ca,directory/"ca.crt")
            for item in directory.iterdir():
                os.chmod(item,0o700 if item.is_dir() else 0o600)
                self.run(["sudo","-n","chown",str(self.pg_uid)+":"+str(self.pg_gid),str(item)])
            self.run(["sudo","-n","chown",str(self.pg_uid)+":"+str(self.pg_gid),str(directory)])

    def create_network(self):
        self.stage="network_create"
        require(self.resource_absent(self.network,network=True),"docker_network_name_not_absent")
        self.network_reserved=True
        self.save_state()
        self.docker(["network","create","--driver","bridge","--internal","--ipv6",
            "--subnet","172.30.240.0/24","--subnet","fd68:6b6f:7661:240::/64",
            "--opt","com.docker.network.bridge.name="+self.bridge,"--label",self.owner_label,
            "--label","kova.empty-probe.source="+self.source,"--label","kova.empty-probe.run="+self.run_id,
            "--label","kova.empty-probe.attempt="+self.attempt,self.network])
        _,raw=self.docker(["network","inspect",self.network]);info=json.loads(raw)[0]
        require(info.get("Internal") is True and info.get("EnableIPv6") is True
                and info.get("Labels",{}).get("kova.empty-probe.owner")==self.token,
                "internal_dual_stack_network_unconfirmed")
        self.host_firewall()

    def host_firewall(self):
        for family,tool in [(4,"iptables"),(6,"ip6tables")]:
            base=["sudo","-n",tool,"-w","5"]
            self.run(base+["-S","DOCKER-USER"])
            code,_=self.run(base+["-S",self.chain],allow_failure=True)
            require(code!=0,"probe_firewall_chain_exists")
            self.firewall_reserved.append(tool)
            self.save_state()
            self.run(base+["-N",self.chain])
            for target in ["a","b"]:
                client=self.addresses["client"][family==6];server=self.addresses[target][family==6]
                self.run(base+["-A",self.chain,"-s",client,"-d",server,"-p","tcp","--dport","5432",
                    "-m","conntrack","--ctstate","NEW,ESTABLISHED","-m","comment","--comment",self.token,"-j","ACCEPT"])
                self.run(base+["-A",self.chain,"-s",server,"-d",client,"-p","tcp","--sport","5432",
                    "-m","conntrack","--ctstate","ESTABLISHED","-m","comment","--comment",self.token,"-j","ACCEPT"])
            self.run(base+["-A",self.chain,"-m","comment","--comment",self.token,"-j","DROP"])
            self.run(base+["-I","DOCKER-USER","1","-i",self.bridge,"-m","comment","--comment",self.token,"-j",self.chain])
            _,raw=self.run(base+["-S",self.chain]);self.host_firewall_pins[tool]=digest(raw)

    def _container_args(self,key):
        args=["run","--detach","--no-healthcheck","--name",self.names[key],"--label",self.owner_label,
              "--label","kova.empty-probe.source="+self.source,"--label","kova.empty-probe.run="+self.run_id,
              "--label","kova.empty-probe.attempt="+self.attempt,
              "--network",self.network,"--ip",self.addresses[key][0],"--ip6",self.addresses[key][1],
              "--cap-drop","ALL","--security-opt","no-new-privileges:true","--read-only",
              "--pids-limit","128","--memory","768m","--cpus","1",
              "--tmpfs","/tmp:rw,nosuid,nodev,noexec,mode=1777","--env","HOME=/tmp","--env","TZ=UTC"]
        for volume in self.image_volumes:
            if volume!="/tmp":args += ["--tmpfs",volume+":rw,nosuid,nodev,noexec,mode=0700"]
        if key=="client":
            args += ["--user",str(self.uid)+":"+str(self.gid),"--mount",
                     "type=bind,src="+str(self.client_dir)+",dst=/run/client,readonly"]
        else:
            args += ["--network-alias",self.hosts[key],"--user",str(self.pg_uid)+":"+str(self.pg_gid),
                     "--mount","type=bind,src="+str(self.server_dirs[key])+",dst=/run/server",
                     "--env","PGDATA=/run/server/data"]
        return args

    def start_container(self,key):
        self.reserve_absent(self.names[key])
        self.save_state()
        if key=="client":
            script="trap 'exit 0' TERM INT; while :; do sleep 1; done"
        else:
            script="""while [ ! -f /run/server/network-ready ]; do sleep 1; done
initdb -D "$PGDATA" --username=kova_probe_operator --auth-local=trust --auth-host=scram-sha-256 --pwfile=/run/server/password >/tmp/init.log 2>&1
printf '%s\n' 'hostssl all all 172.30.240.4/32 scram-sha-256' 'hostssl all all fd68:6b6f:7661:240::4/128 scram-sha-256' 'host all all 0.0.0.0/0 reject' 'host all all ::/0 reject' >> "$PGDATA/pg_hba.conf"
pg_ctl -D "$PGDATA" -l /tmp/postgres.log -o "-c listen_addresses='*' -c ssl=on -c ssl_cert_file=/run/server/server.crt -c ssl_key_file=/run/server/server.key -c ssl_ca_file=/run/server/ca.crt -c unix_socket_directories=/tmp -c shared_preload_libraries='' -c cron.launch_active_jobs=off -c autovacuum=off -c log_statement=none" -w start >/tmp/pg-start.log 2>&1
trap 'pg_ctl -D "$PGDATA" -m fast -w stop >/tmp/stop.log 2>&1 || true; exit 0' TERM INT
while :; do sleep 1; done"""
        self.docker(self._container_args(key)+["--entrypoint","/bin/bash",IMAGE,"-ceu",script])
        info=self.inspect(self.names[key]);self.verify_container(key,info)
        self.namespace_firewall(key,info["State"]["Pid"])
        if key!="client":self.run(["sudo","-n","tee",str(self.server_dirs[key]/"network-ready")],data=b"ready\n")
        return info

    def verify_container(self,key,info):
        require(info.get("Config",{}).get("Labels",{}).get("kova.empty-probe.owner")==self.token
                and info.get("State",{}).get("Running") is True and type(info["State"].get("Pid")) is int
                and info["State"]["Pid"]>1,"owned_running_container_unconfirmed")
        host=info.get("HostConfig",{})
        require(host.get("Privileged") is False and host.get("ReadonlyRootfs") is True
                and "ALL" in host.get("CapDrop",[]) and not host.get("CapAdd")
                and host.get("NetworkMode")==self.network and not host.get("PortBindings")
                and not host.get("PidMode") and not host.get("IpcMode")=="host",
                "container_isolation_unconfirmed")
        require(not info.get("NetworkSettings",{}).get("Ports")
                or all(value is None for value in info["NetworkSettings"]["Ports"].values()),"host_ports_forbidden")
        expected=self._container_args(key)
        require(not any(x in expected for x in ["--privileged","--network=host"]),"unsafe_container_arguments")
        require(all(not any(bad in m.get("Source","") or bad in m.get("Destination","")
                            for bad in ["docker.sock","containerd.sock","/var/run/docker","/proc/","/sys/"])
                    for m in info.get("Mounts",[])),"socket_or_host_system_mount_forbidden")
        binds=[m for m in info.get("Mounts",[]) if m.get("Type")=="bind"]
        expected_source=str(self.client_dir if key=="client" else self.server_dirs[key])
        expected_destination="/run/client" if key=="client" else "/run/server"
        require(len(binds)==1 and binds[0].get("Source")==expected_source
                and binds[0].get("Destination")==expected_destination and binds[0].get("RW")== (key!="client")
                and all(m.get("Type") in {"bind","tmpfs"} for m in info.get("Mounts",[])),
                "unexpected_container_mount")
        require(info["Config"].get("Healthcheck",{}).get("Test")==["NONE"],"image_healthcheck_not_disabled")
        environment=dict(x.split("=",1) for x in info["Config"].get("Env",[]) if "=" in x)
        allowed={**self.image_env,"HOME":"/tmp","TZ":"UTC"}
        if key!="client":allowed["PGDATA"]="/run/server/data"
        require(environment==allowed and not any(k in FORBIDDEN_ENV for k in environment),"container_environment_unqualified")
        user=info["Config"].get("User","")
        require(user==str(self.uid)+":"+str(self.gid) if key=="client"
                else user==str(self.pg_uid)+":"+str(self.pg_gid),"container_nonroot_user_unconfirmed")
        net=info["NetworkSettings"]["Networks"].get(self.network,{})
        require(net.get("IPAddress")==self.addresses[key][0]
                and net.get("GlobalIPv6Address")==self.addresses[key][1],"container_ip_pin_mismatch")

    def namespace_firewall(self,key,pid):
        # Host binaries enter only this verified network namespace. No NET_ADMIN
        # capability or daemon socket is granted to any container process.
        _,raw=self.run(["sudo","-n","stat","-Lc","%i","/proc/"+str(pid)+"/ns/net"])
        inode=int(raw.strip())
        require(inode!=os.stat("/proc/self/ns/net").st_ino,"host_network_namespace_forbidden")
        again=self.inspect(self.names[key]);self.verify_container(key,again)
        require(again["State"]["Pid"]==pid,"container_process_changed")
        self.netns[key]=(pid,inode)
        for family,tool in [(4,"iptables"),(6,"ip6tables")]:
            base=["sudo","-n","python3","-c",NETNS_HELPER,str(pid),str(inode),tool,"-w","5"]
            for chain in ["INPUT","OUTPUT","FORWARD"]:
                self.run(base+["-P",chain,"DROP"])
                # A fresh private namespace has no application filter rules.
                self.run(base+["-F",chain])
            index=family==6
            if key=="client":pairs=[(self.addresses["client"][index],self.addresses[t][index],True) for t in ["a","b"]]
            else:pairs=[(self.addresses[key][index],self.addresses["client"][index],False)]
            for own,peer,client in pairs:
                for chain in ["OUTPUT","INPUT"]:
                    outgoing=chain=="OUTPUT"
                    src,dst=(own,peer) if outgoing else (peer,own)
                    request=client==outgoing
                    args=["-A",chain,"-s",src,"-d",dst,"-p","tcp",
                          "--dport" if request else "--sport","5432","-m","conntrack","--ctstate",
                          "NEW,ESTABLISHED" if request else "ESTABLISHED","-j","ACCEPT"]
                    self.run(base+args)
            # Explicit drops make readback and packet-counter evidence possible.
            for chain in ["INPUT","OUTPUT","FORWARD"]:self.run(base+["-A",chain,"-j","DROP"])
            _,raw=self.run(base+["-S"])
            require(all(("-P "+chain+" DROP").encode() in raw for chain in ["INPUT","OUTPUT","FORWARD"])
                    and b"127.0.0.11" not in raw and b"--dport 53" not in raw,
                    "network_namespace_default_deny_unconfirmed")
            self.network_evidence.append({"container":key,"family":family,"rulesSha256":digest(raw)})

    def save_state(self):
        state={"format":1,"source":self.source,"runId":self.run_id,"attempt":self.attempt,
               "token":self.token,"network":self.network,"bridge":self.bridge,"chain":self.chain,
               "names":self.names,"containersReserved":self.containers_reserved,
               "networkReserved":self.network_reserved,"firewallReserved":self.firewall_reserved,
               "privateRoot":str(self.private_root) if self.private_root else None,
               "pgUid":self.pg_uid,"pgGid":self.pg_gid,"uid":self.uid,"gid":self.gid,
               "cleanupConfirmed":self.cleanup_confirmed}
        if self.state_path.exists():
            old=json.loads(private_file(self.state_path).read_bytes())
            require(all(old.get(k)==state[k] for k in ["token","source","runId","attempt"]),"owned_state_conflict")
            tmp=self.state_path.with_name(self.state_path.name+".new")
            write_private(tmp,encoded(state));os.replace(tmp,self.state_path)
        else:write_private(self.state_path,encoded(state))

    def client_sql(self,target,sql,*,family=4,host=None,ca="/run/client/ca.crt",allow_failure=False):
        ip=self.addresses[target][family==6]
        flags=["exec","-i","--user",str(self.uid)+":"+str(self.gid)]
        values={"PGHOST":host or self.hosts[target],"PGHOSTADDR":ip,"PGPORT":"5432","PGDATABASE":"postgres",
                "PGUSER":OPERATOR,"PGSSLMODE":"verify-full","PGSSLROOTCERT":ca,
                "PGPASSFILE":"/run/client/pgpass","PGCONNECT_TIMEOUT":"3",
                "PGOPTIONS":"-c TimeZone=UTC -c DateStyle=ISO,YMD -c bytea_output=hex -c extra_float_digits=3 -c default_transaction_read_only=on"}
        for key,value in values.items():flags += ["--env",key+"="+value]
        return self.docker(flags+[self.names["client"],self.native_tools["psql"],"-X","--no-password","--quiet",
            "--tuples-only","--no-align","--set","ON_ERROR_STOP=1","--set","VERBOSITY=sqlstate","--file","-"],
            data=sql.encode(),timeout=30,allow_failure=allow_failure)

    def bootstrap_sql(self,target,sql,*,database="postgres"):
        require(database in {"postgres","template1"},"bootstrap_database_unqualified")
        return self.docker(["exec","-i","--user",str(self.pg_uid)+":"+str(self.pg_gid),self.names[target],
            self.native_tools["psql"],"-X","--no-password","--host","/tmp","--username",OPERATOR,
            "--dbname",database,"--quiet","--tuples-only","--no-align",
            "--set","ON_ERROR_STOP=1","--set","VERBOSITY=sqlstate","--file","-"],
            data=("SET default_transaction_read_only=off;\n"+sql).encode(),timeout=90)

    def static_ipv6_neighbors(self,target):
        """Permanent peer entries avoid opening NDP or DNS in locked netns."""
        for own,peer in [("client",target),(target,"client")]:
            own_info=self.inspect(self.names[own]);self.verify_container(own,own_info)
            peer_info=self.inspect(self.names[peer]);self.verify_container(peer,peer_info)
            mac=peer_info["NetworkSettings"]["Networks"][self.network].get("MacAddress","")
            require(re.fullmatch(r"[0-9a-f]{2}(?::[0-9a-f]{2}){5}",mac)
                    and int(mac[:2],16)&1==0,"private_peer_mac_unconfirmed")
            pid,inode=self.netns[own]
            require(own_info["State"]["Pid"]==pid,"container_process_changed")
            ip=self.addresses[peer][1]
            base=["sudo","-n","python3","-c",NETNS_HELPER,str(pid),str(inode),"ip"]
            self.run(base+["-6","neigh","replace",ip,"lladdr",mac,"nud","permanent","dev","eth0"])
            _,raw=self.run(base+["-6","neigh","show",ip,"dev","eth0"])
            require(mac.encode() in raw and b"PERMANENT" in raw,"permanent_private_ipv6_peer_unconfirmed")
            self.neighbors.append({"container":own,"peerSha256":digest(ip.encode()),"macSha256":digest(mac.encode())})

    def wait_native(self,target):
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            code,_=self.docker(["exec",self.names[target],self.native_tools["psql"],"-X","--no-password",
                "--host","/tmp","--username",OPERATOR,"--dbname","postgres","--tuples-only","--no-align",
                "--command","SELECT 1;"],timeout=5,allow_failure=True)
            if code==0:return
            time.sleep(0.2)
        raise Stopped("native_postgres_start_unconfirmed")

    def prepare_native(self,target):
        self.stage="native_metadata_prepare"
        self.wait_native(target)
        # initdb's default postgres database is a template1 clone. Recreate it
        # explicitly from template0 before any metadata or application objects.
        self.bootstrap_sql(target,"DROP DATABASE postgres;\nCREATE DATABASE postgres TEMPLATE template0 OWNER "+ident(OPERATOR)+";\n",database="template1")
        self.bootstrap_sql(target,role_setup_sql(self.metadata)+schema_setup_sql(self.metadata))
        bootstrap_preload=sorted(e["name"] for e in self.metadata["extensions"]
                                 if e["name"] in {"pg_cron","pg_net","pg_stat_statements","pgaudit","timescaledb"})
        if bootstrap_preload:
            # Known libraries from the pinned image may be required to CREATE
            # their extension. There are no customer rows/queued requests, cron
            # is off and every server netns already denies network egress. This
            # does not copy source preload settings. Final restart unloads all.
            self.docker(["exec","--user",str(self.pg_uid)+":"+str(self.pg_gid),self.names[target],
                self.native_tools["pg_ctl"],"-D","/run/server/data","-l","/tmp/bootstrap-preload.log",
                "-o","-c listen_addresses='*' -c ssl=on -c ssl_cert_file=/run/server/server.crt -c ssl_key_file=/run/server/server.key -c ssl_ca_file=/run/server/ca.crt -c unix_socket_directories=/tmp -c shared_preload_libraries='"+",".join(bootstrap_preload)+"' -c cron.launch_active_jobs=off -c autovacuum=off -c log_statement=none",
                "-w","restart"],timeout=60)
        # Dependency order comes from the pinned image's actual extension control
        # catalog. Unknown requirements/versions fail rather than install latest.
        _,raw=self.bootstrap_sql(target,"SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'version',version,'requires',requires)),'[]')::text FROM pg_available_extension_versions;\n")
        available=json.loads(raw)
        # Recreate the fresh template0 plpgsql as its observed source owner;
        # PostgreSQL has no ALTER EXTENSION OWNER operation. No user objects
        # exist and no source/customer DDL or rows are restored in this probe.
        plpgsql=next(e for e in self.metadata["extensions"] if e["name"]=="plpgsql")
        self.bootstrap_sql(target,extension_owner_bootstrap_sql(self.metadata)+"DROP EXTENSION plpgsql;\n"
                           +extension_create_sql(plpgsql))
        pending={e["name"]:e for e in self.metadata["extensions"] if e["name"]!="plpgsql"}
        installed={"plpgsql"}
        while pending:
            ready=[]
            for name,e in pending.items():
                candidates=[v for v in available if v["name"]==name and v["version"]==e["version"]]
                require(len(candidates)==1,"pinned_extension_version_unavailable")
                if set(candidates[0].get("requires") or []) <= installed:ready.append(name)
            require(ready,"extension_dependency_graph_unqualified")
            for name in sorted(ready):
                e=pending[name]
                # No CASCADE and no unreviewed/preloaded consumer library.
                self.bootstrap_sql(target,extension_create_sql(e))
                installed.add(name);del pending[name]
        self.bootstrap_sql(target,extension_owner_bootstrap_sql(self.metadata,restore=True))
        self.bootstrap_sql(target,schema_acl_sql(self.metadata))
        # Bootstrap local sockets stay inside the server and disappear before
        # qualification. No host/client socket is mounted or permitted.
        self.docker(["exec","--user",str(self.pg_uid)+":"+str(self.pg_gid),self.names[target],
            self.native_tools["pg_ctl"],"-D","/run/server/data","-l","/tmp/final-postgres.log",
            "-o","-c listen_addresses='*' -c ssl=on -c ssl_cert_file=/run/server/server.crt -c ssl_key_file=/run/server/server.key -c ssl_ca_file=/run/server/ca.crt -c unix_socket_directories='' -c shared_preload_libraries='' -c cron.launch_active_jobs=off -c autovacuum=off -c log_statement=none",
            "-w","restart"],timeout=60)

    def tls_controls(self,target):
        self.stage="native_tls_controls"
        identity="SELECT jsonb_build_object('address',inet_server_addr()::text,'version',current_setting('server_version_num')::integer,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text;\n"
        values=[]
        for family in [4,6]:
            _,raw=self.client_sql(target,identity,family=family)
            value=json.loads(raw)
            require(value.get("version")==170006 and value.get("tls") is True
                    and ipaddress.ip_address(value["address"])==ipaddress.ip_address(self.addresses[target][family==6])
                    and re.fullmatch(r"[0-9]+",value.get("systemIdentifier","")),"native_dual_stack_tls_unconfirmed")
            values.append(value)
            self.docker(["exec",self.names["client"],self.native_tools["timeout"],"3","/bin/bash","-ceu",
                "exec 3<>/dev/tcp/"+self.addresses[target][family==6]+"/5432"],timeout=5)
        require(values[0]["systemIdentifier"]==values[1]["systemIdentifier"],"target_cluster_changed")
        bad_host,_=self.client_sql(target,"SELECT 1;\n",host="wrong-host.invalid",allow_failure=True)
        host_error=self.last_stderr
        require(bad_host!=0 and b"does not match" in host_error,"wrong_hostname_rejection_unconfirmed")
        bad_ca,_=self.client_sql(target,"SELECT 1;\n",ca="/run/client/wrong-ca.crt",allow_failure=True)
        ca_error=self.last_stderr
        require(bad_ca!=0 and b"certificate" in ca_error.lower() and b"verify" in ca_error.lower(),
                "wrong_ca_rejection_unconfirmed")
        self.client_sql(target,"SELECT 1;\n")
        return values[0]["systemIdentifier"]

    def consumer_proof(self,target):
        _,raw=self.client_sql(target,"SELECT jsonb_build_object('preload',current_setting('shared_preload_libraries'),'sessionPreload',current_setting('session_preload_libraries'),'localPreload',current_setting('local_preload_libraries'),'cron',coalesce(current_setting('cron.launch_active_jobs',true),'off'),'sockets',current_setting('unix_socket_directories'),'otherClients',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND (pid<>pg_backend_pid() OR usename<>current_user OR datname<>current_database())),'workers',(SELECT coalesce(jsonb_agg(DISTINCT backend_type),'[]') FROM pg_stat_activity))::text;\n")
        value=json.loads(raw)
        require(value.get("preload")=="" and value.get("cron")=="off" and value.get("sockets")==""
                and value.get("sessionPreload")=="" and value.get("localPreload")=="" and value.get("otherClients")==0
                and isinstance(value.get("workers"),list) and set(value["workers"])<=NATIVE_WORKERS,
                "consumers_or_local_socket_not_stopped")
        return {"preloadLibraries":0,"cronLaunchActiveJobs":False,"unexpectedWorkers":0,"unixSockets":0}

    def native_snapshot(self,target):
        self.stage="native_catalog_proof"
        _,raw=self.client_sql(target,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"+recovery.CATALOG_SQL+"\nCOMMIT;\n")
        catalog=json.loads(raw)
        _,raw=self.client_sql(target,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"+recovery.EMPTY_CENSUS.read_text()+"\nCOMMIT;\n")
        census=json.loads(raw)
        require(census.get("serverVersionNum")==170006 and census.get("counts",{}).get("unownedNamespaceObjects")==0
                and not catalog.get("largeObjects"),"native_blank_census_unqualified")
        recovery.identifiers(catalog)
        rows=[]
        catalog_tables={(r["schema"],r["name"]):r for r in catalog["tables"]}
        census_tables={(r["schema"],r["name"]):r for r in census["tables"]}
        require(set(catalog_tables)==set(census_tables),"native_table_census_coverage_missing")
        for key,table in sorted(census_tables.items()):
            require(table["kind"] in {"r","p","m"},"native_target_table_kind_unqualified")
            observed=catalog_tables[key]
            if table["kind"]=="m" and observed.get("populated") is not True:continue
            _,raw=self.client_sql(target,"SELECT count(*)::bigint FROM "+ident(table["schema"])+"."+ident(table["name"])+";\n")
            require(raw.strip()==b"0","native_target_contains_seed_data")
            if table["kind"] in {"r","m"}:
                rows.append({"schema":table["schema"],"name":table["name"],"rows":0,"sha256":digest(b"")})
        # pg_dump runs as the same nonroot target-only client, under verified TLS.
        args=["exec","--user",str(self.uid)+":"+str(self.gid)]
        for k,v in {"PGHOST":self.hosts[target],"PGHOSTADDR":self.addresses[target][0],"PGPORT":"5432",
                    "PGUSER":OPERATOR,"PGDATABASE":"postgres","PGSSLMODE":"verify-full",
                    "PGSSLROOTCERT":"/run/client/ca.crt","PGPASSFILE":"/run/client/pgpass","PGCONNECT_TIMEOUT":"3",
                    "PGOPTIONS":recovery.CANONICAL_PG+" -c default_transaction_read_only=on"}.items():
            args += ["--env",k+"="+v]
        _,schema=self.docker(args+[self.names["client"],self.native_tools["pg_dump"],"--no-password","--schema-only"],timeout=60)
        expected={"roles":self.metadata["roles"],"memberships":self.metadata["memberships"],
                  "roleSettings":[{k:r[k] for k in ["role","database","settings"]} for r in self.metadata["roleSettings"]]}
        role_match=True
        try:recovery.role_compatibility(expected,catalog,[OPERATOR])
        except recovery.Stopped:role_match=False
        source_ns={s["name"]:s for s in self.metadata["schemas"]}
        ns_match=source_ns=={s["name"]:s for s in catalog["schemas"]}
        _,raw=self.client_sql(target,"SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname),'[]')::text FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;\n")
        owned_extensions=json.loads(raw)
        extension_match=encoded(owned_extensions)==encoded(self.metadata["extensions"]) \
            and encoded(catalog["extensions"])==encoded(self.metadata["extensions"])
        return {"fingerprints":{"emptyBaselineCensusSha256":digest(encoded(census)),
                 "emptyBaselineCatalogSha256":digest(encoded(catalog)),"emptyBaselineRowsSha256":digest(encoded(rows)),
                 "emptyBaselineSchemaSha256":recovery.schema_hash(schema)},
                "roleMatch":role_match,"namespaceMatch":ns_match,"extensionMatch":extension_match,
                "tableCount":len(rows),"namespaceObjectCount":len(census["namespaceObjects"]),
                "globalObjectCount":len(census["globalObjects"])}

    def extension_coverage(self,target):
        if "extensionCoverage" not in self.metadata:return None
        self.stage="native_extension_coverage"
        sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog;\n" \
            +metadata_source.EXTENSION_COVERAGE.read_text()+"\nCOMMIT;\n"
        _,raw=self.client_sql(target,sql)
        return metadata_source.check_extension_coverage(json.loads(raw))

    def original_destination_guard(self,target,system_id):
        self.stage="original_destination_guard"
        uri="postgresql://"+OPERATOR+"@"+self.hosts[target]+":5432/postgres?sslmode=verify-full&sslrootcert="+str(self.client_dir/"ca.crt")
        values={"APPROVED_ISOLATED_PG17_DATABASE_URL":uri,"APPROVED_ISOLATED_HOST":self.hosts[target],
                "APPROVED_ISOLATED_DBNAME":"postgres","APPROVED_ISOLATED_PORT":"5432",
                "APPROVED_ISOLATED_SERVER_IP":self.addresses[target][0],
                "APPROVED_ISOLATED_SYSTEM_IDENTIFIER":system_id,"PGPASSFILE":str(self.client_dir/"pgpass")}
        # Do not add the source environment or arbitrary inherited PG overrides.
        previous=self.env
        try:
            self.env={**self.env,**values}
            _,raw=self.run(["node",str(recovery.GUARD),"--configuration"],timeout=10)
        finally:self.env=previous
        approved=json.loads(raw)
        require(approved.get("expectedIp")==self.addresses[target][0]
                and approved.get("expectedSystemId")==system_id and approved.get("host")==self.hosts[target],
                "original_destination_guard_unconfirmed")

    def verify_effective_firewalls(self):
        for key in ["a","b","client"]:
            info=self.inspect(self.names[key]);self.verify_container(key,info)
            pid,inode=self.netns[key]
            require(info["State"]["Pid"]==pid,"container_process_changed")
            for tool in ["iptables","ip6tables"]:
                _,raw=self.run(["sudo","-n","python3","-c",NETNS_HELPER,str(pid),str(inode),tool,"-w","5","-S"])
                require(all(("-P "+c+" DROP").encode() in raw for c in ["INPUT","OUTPUT","FORWARD"]),"namespace_policy_changed")
                expected=[r for r in self.network_evidence if r.get("container")==key
                          and "rulesSha256" in r and r.get("family")== (6 if tool=="ip6tables" else 4)]
                require(len(expected)==1 and digest(raw)==expected[0]["rulesSha256"],"namespace_rules_changed")
        for tool in ["iptables","ip6tables"]:
            base=["sudo","-n",tool,"-w","5"]
            self.run(base+["-C","DOCKER-USER","-i",self.bridge,"-m","comment","--comment",self.token,"-j",self.chain])
            _,raw=self.run(base+["-S",self.chain])
            require(("-A "+self.chain+" -m comment --comment "+self.token+" -j DROP").encode() in raw,
                    "host_firewall_default_deny_changed")
            require(digest(raw)==self.host_firewall_pins[tool],"host_firewall_rules_changed")
            self.network_evidence.append({"hostFamily":6 if tool=="ip6tables" else 4,"rulesSha256":digest(raw)})

    def denial_probes(self,targets):
        self.stage="actual_egress_denial"
        count=0
        extra=[("docker-dns","127.0.0.11",53),("docker-host-gateway","172.30.240.1",443),
               ("container-loopback","127.0.0.1",5432),("container-loopback","::1",5432)]
        bash_hashes=[]
        for key in ["a","b","client"]:
            # /dev/tcp is the same pinned Bash that passed the actual dual-stack
            # TLS controls. Missing tools/unknown execution states never pass.
            self.docker(["exec",self.names[key],"/bin/bash","--version"])
            self.docker(["exec",self.names[key],self.native_tools["timeout"],"--version"])
            _,raw=self.docker(["exec",self.names[key],self.native_tools["sha256sum"],"/bin/bash"])
            value=raw.decode().split()[0];require(SHA.fullmatch(value),"bash_control_identity_missing");bash_hashes.append(value)
            for kind,ip,port in targets+extra:
                ipaddress.ip_address(ip);require(port in {53,443,5432},"denial_probe_port_unqualified")
                code,_=self.docker(["exec",self.names[key],self.native_tools["timeout"],"3","/bin/bash","-ceu",
                    "exec 3<>/dev/tcp/"+ip+"/"+str(port)],timeout=5,allow_failure=True)
                require(code in {1,124},"outbound_connection_not_denied")
                if code==1:
                    require(b"network is unreachable" in self.last_stderr.lower()
                            or b"no route to host" in self.last_stderr.lower(),"numeric_denial_cause_unconfirmed")
                self.network_evidence.append({"container":key,"kind":kind,"family":ipaddress.ip_address(ip).version,
                                              "port":port,"addressSha256":digest(ip.encode()),"connectDenied":True})
                count+=1
            # An actual UDP DNS query must receive no reply; TCP53 alone would
            # not test Docker's embedded UDP resolver escape path.
            self.docker(["exec",self.names[key],"/bin/bash","-ceu","command -v dd >/dev/null"])
            dns="exec 3<>/dev/udp/127.0.0.11/53; printf '\\x12\\x34\\x01\\x00\\x00\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x07example\\x03com\\x00\\x00\\x01\\x00\\x01' >&3; dd bs=1 count=1 <&3 >/dev/null 2>&1"
            code,_=self.docker(["exec",self.names[key],self.native_tools["timeout"],"3","/bin/bash","-ceu",dns],
                              timeout=5,allow_failure=True)
            require(code==124,"embedded_dns_udp_denial_unconfirmed")
            count+=1
        require(len(set(bash_hashes))==1,"server_client_bash_binary_mismatch")
        return count

    def owned_labels(self,labels):
        return all(labels.get(k)==v for k,v in {
            "kova.empty-probe.owner":self.token,"kova.empty-probe.source":self.source,
            "kova.empty-probe.run":self.run_id,"kova.empty-probe.attempt":self.attempt}.items())

    def cleanup(self):
        """Reconcile only resources reserved by this exact run/attempt/owner."""
        safe=True
        containers_gone=True
        for name in reversed(self.containers_reserved):
            try:
                if self.resource_absent(name):continue
                _,raw=self.docker(["inspect",name])
                info=json.loads(raw)[0]
                require(self.owned_labels(info.get("Config",{}).get("Labels",{})),"foreign_container_cleanup_forbidden")
                self.docker(["rm","--force","--volumes",info["Id"]],timeout=30)
                require(self.resource_absent(info["Id"]) and self.resource_absent(name),"owned_container_removal_unconfirmed")
            except Exception:safe=False;containers_gone=False
        network_gone=not self.network_reserved
        if self.network_reserved:
            try:
                if not self.resource_absent(self.network,network=True):
                    _,raw=self.docker(["network","inspect",self.network])
                    info=json.loads(raw)[0]
                    require(self.owned_labels(info.get("Labels",{})) and not info.get("Containers"),
                            "foreign_or_active_network_cleanup_forbidden")
                    self.docker(["network","rm",info["Id"]],timeout=30)
                    require(self.resource_absent(info["Id"],network=True)
                            and self.resource_absent(self.network,network=True),"owned_network_removal_unconfirmed")
                network_gone=True
            except Exception:safe=False;network_gone=False
        storage_gone=True
        if containers_gone and network_gone and callable(getattr(self,"cleanup_storage",None)):
            try:storage_gone=bool(self.cleanup_storage())
            except Exception:storage_gone=False
            if not storage_gone:safe=False
        # Keep both firewall layers and private backing files if a live target
        # or an uncertain daemon operation cannot yet be reconciled.
        for tool in reversed(self.firewall_reserved) if containers_gone and network_gone and storage_gone else []:
            base=["sudo","-n",tool,"-w","5"]
            try:
                jump=["DOCKER-USER","-i",self.bridge,"-m","comment","--comment",self.token,"-j",self.chain]
                # A successful full filter-table read distinguishes absence
                # from iptables permission/kernel errors (both can exit 1).
                _,raw=self.run(base+["-S"])
                table=[shlex.split(line) for line in raw.decode().splitlines()]
                if ["-A",*jump] in table:self.run(base+["-D",*jump])
                owned=[tokens for tokens in table if len(tokens)>=2 and tokens[1]==self.chain]
                if not owned:continue
                rules=[]
                for tokens in owned:
                    if tokens==["-N",self.chain]:continue
                    require(tokens[:2]==["-A",self.chain] and "--comment" in tokens
                            and tokens[tokens.index("--comment")+1]==self.token
                            and tokens[-2:][0]=="-j" and tokens[-1] in {"ACCEPT","DROP"},
                            "foreign_firewall_rule_cleanup_forbidden")
                    rules.append(tokens)
                # No global flush: delete only the exact inspected owner-tagged
                # rules and then remove this now-empty random chain.
                for tokens in rules:self.run(base+["-D",*tokens[1:]])
                self.run(base+["-X",self.chain])
                _,raw=self.run(base+["-S"])
                after=[shlex.split(line) for line in raw.decode().splitlines()]
                require(not any(len(tokens)>=2 and tokens[1]==self.chain for tokens in after)
                        and ["-A",*jump] not in after,"owned_firewall_chain_removal_unconfirmed")
            except Exception:safe=False
        if self.private_root and containers_gone and network_gone and storage_gone:
            try:
                root=Path(self.private_root)
                if root.exists():
                    info=root.lstat()
                    require(stat.S_ISDIR(info.st_mode) and not root.is_symlink() and info.st_uid==self.uid
                            and root.parent.resolve()==self.runner_temp
                            and root.name.startswith("kova-empty-"+self.run_id+"-"+self.attempt+"-"),
                            "private_cleanup_path_unqualified")
                    marker=json.loads(private_file(root/"ownership.json").read_bytes())
                    require(marker=={"token":self.token,"source":self.source,"runId":self.run_id,"attempt":self.attempt},
                            "private_cleanup_owner_mismatch")
                    self.run(["sudo","-n","chown","--recursive","--no-dereference",str(self.uid)+":"+str(self.gid),str(root)])
                    shutil.rmtree(root)
                    require(not root.exists(),"private_cleanup_unconfirmed")
            except Exception:safe=False
        self.cleanup_confirmed=safe
        try:self.save_state()
        except Exception:safe=False;self.cleanup_confirmed=False
        return safe

    def execute(self):
        result={"operation":"data-free-native-empty-target-probe","sourceSha":self.source,"postgresBuild":BUILD,
                "imageRepoDigest":IMAGE,"customerRowsUsed":False,"customerRestorePerformed":False,
                "productionMutated":False,"independentlyReviewed":False,"baselineReady":False,
                "futureTargetApproved":False,"targetsRetained":False,"sourceMetadataCompatible":False,
                "extensionMemberSourceSemanticsCompared":False,
                "dataFreeSafetyProofComplete":False,"cleanupConfirmed":False}
        self.save_state()
        try:
            self.initialize()
            result["serverImageTransport"]=self.server_image_qualification
            targets=denial_targets(self.metadata)
            self.private_root=Path(tempfile.mkdtemp(prefix="kova-empty-"+self.run_id+"-"+self.attempt+"-",dir=self.runner_temp))
            os.chmod(self.private_root,0o700)
            write_private(self.private_root/"ownership.json",encoded({"token":self.token,"source":self.source,
                          "runId":self.run_id,"attempt":self.attempt}))
            self.save_state()
            self.make_private_files(self.private_root)
            self.create_network()
            self.start_container("client")
            ids=[];systems=[];snapshots=[];mounts=[];extension_coverages=[]
            for target in ["a","b"]:
                info=self.start_container(target)
                ids.append(info["Id"])
                mounts.append(str(self.server_dirs[target]/"data"))
                self.static_ipv6_neighbors(target)
                self.prepare_native(target)
                system_id=self.tls_controls(target);systems.append(system_id)
                self.original_destination_guard(target,system_id)
                self.consumer_proof(target)
                snapshots.append(self.native_snapshot(target))
                extension_coverages.append(self.extension_coverage(target))
            require(len(set(ids))==len(set(systems))==len(set(mounts))==2,"independent_native_targets_not_distinct")
            require(snapshots[0]["fingerprints"]==snapshots[1]["fingerprints"],"independent_image_baselines_differ")
            self.verify_effective_firewalls()
            attempts=self.denial_probes(targets)
            self.verify_effective_firewalls()
            for target,snapshot in zip(["a","b"],snapshots):
                self.consumer_proof(target)
                again=self.native_snapshot(target)
                require(again["fingerprints"]==snapshot["fingerprints"],"native_target_changed_during_probe")
            compatible=self.metadata["sourceSettingsComplete"] and self.metadata["withheldSettingCount"]==0 \
                and all(s[k] for s in snapshots for k in ["roleMatch","namespaceMatch","extensionMatch"])
            result.update(sourceMetadataCompatible=bool(compatible),dataFreeSafetyProofComplete=True,
                nativeServerVersionNum=170006,nativeClientUnprivilegedOsUser=True,privateTlsIpv4PositiveCount=2,
                privateTlsIpv6PositiveCount=2,wrongHostnameRejectedCount=2,wrongCaRejectedCount=2,
                independentlyInitializedTargetCount=2,distinctClusterCount=2,distinctDataDirectoryCount=2,
                nativeDestinationGuardPassCount=2,ordinaryTargetRowCount=0,consumerWorkerCount=0,
                sharedPreloadLibraryCount=0,sessionPreloadLibraryCount=0,localPreloadLibraryCount=0,
                cronLaunchActiveJobs=False,hostPublishedPortCount=0,daemonSocketMountCount=0,
                numericDeniedConnectProbeCount=attempts,permanentPrivateIpv6PeerCount=len(self.neighbors),
                networkEvidenceSha256=digest(encoded(self.network_evidence+self.neighbors)),
                sourceMetadataSha256=digest(encoded(self.metadata)),withheldSettingCount=self.metadata["withheldSettingCount"],
                observedBaselineFingerprints=snapshots[0]["fingerprints"],
                nativeNamespaceObjectCount=snapshots[0]["namespaceObjectCount"],
                nativeGlobalObjectCount=snapshots[0]["globalObjectCount"],nativeTargetTableCount=snapshots[0]["tableCount"])
            if extension_coverages[0] is not None:
                require(encoded(extension_coverages[0])==encoded(extension_coverages[1]),
                        "independent_extension_coverage_differ")
                source_coverage=self.metadata["extensionCoverage"]
                result["extensionCoverage"]={
                    "querySha256":self.metadata["extensionCoverageQuerySha256"],
                    "sourceCoverageSha256":digest(encoded(source_coverage)),
                    "imageCoverage":extension_coverages[0],
                    "sourceImageInventoryEqual":all(source_coverage[k]==extension_coverages[0][k]
                        for k in ["memberInventorySha256","dependencyInventorySha256"]),
                    "semanticEqualityProven":False,"qualificationReady":False}
            self.stage="native_proof_complete"
        except Exception as error:
            # A late postcondition failure must revoke every earlier success flag.
            result["dataFreeSafetyProofComplete"]=False
            result["sourceMetadataCompatible"]=False
            code=str(error) if isinstance(error,(Stopped,server_image.Stopped)) else ""
            result["errorCode"]=(code if isinstance(error,Stopped)
                or isinstance(error,server_image.Stopped) and code in server_image.PUBLIC_FAILURE_CODES
                else "data_free_native_probe_unconfirmed")
            result["failedStage"]=self.stage
        finally:
            qualified=getattr(self,"server_image_qualification",None)
            if type(qualified) is dict:result.setdefault("serverImageTransport",qualified)
            result["cleanupConfirmed"]=self.cleanup()
            if not result["cleanupConfirmed"]:result["errorCode"]="owned_cleanup_unconfirmed"
            result["checkedAtUtc"]=datetime.now(timezone.utc).isoformat()
            result["nativeCommandCount"]=self.command_count
            self.output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            write_private(self.output,encoded(result))
        return result


def cleanup_from_state(env):
    """Always-step backstop; never starts a target or repeats qualification."""
    source=checked_context(env)
    run_id,attempt=env.get("GITHUB_RUN_ID",""),env.get("GITHUB_RUN_ATTEMPT","")
    require(re.fullmatch(r"[1-9][0-9]*",run_id) and re.fullmatch(r"[1-9][0-9]*",attempt),"github_run_identity_missing")
    temp=Path(env.get("RUNNER_TEMP","")).resolve()
    state_path=temp/("kova-empty-owned-"+run_id+"-"+attempt+".json")
    if not state_path.exists():return True
    state=json.loads(private_file(state_path).read_bytes())
    require(state.get("format")==1 and state.get("source")==source and state.get("runId")==run_id
            and state.get("attempt")==attempt and state.get("uid")==os.getuid()
            and re.fullmatch(r"[a-f0-9]{10}",state.get("token","")),"owned_cleanup_state_unqualified")
    token=state["token"]
    expected_names={k:"kova-empty-"+k+"-"+token for k in ["a","b","client"]}
    require(state.get("network")=="kova-empty-"+token and state.get("bridge")=="kr"+token
            and state.get("chain")=="KRP"+token.upper() and state.get("names")==expected_names
            and set(state.get("containersReserved",[])) <= set(expected_names.values())
            and set(state.get("firewallReserved",[])) <= {"iptables","ip6tables"},"owned_cleanup_resource_mismatch")
    probe=object.__new__(Probe)
    probe.env=clean_host_env(env);probe.source=source;probe.run_id=run_id;probe.attempt=attempt
    probe.runner_temp=temp;probe.state_path=state_path;probe.token=token
    probe.network=state["network"];probe.bridge=state["bridge"];probe.chain=state["chain"];probe.names=expected_names
    probe.containers_reserved=state["containersReserved"];probe.firewall_reserved=state["firewallReserved"]
    probe.network_reserved=state["networkReserved"];probe.private_root=Path(state["privateRoot"]) if state.get("privateRoot") else None
    probe.pg_uid=state.get("pgUid");probe.pg_gid=state.get("pgGid");probe.uid=state["uid"];probe.gid=state["gid"]
    probe.command_count=0;probe.last_stderr=b"";probe.cleanup_confirmed=False
    return probe.cleanup()


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true")
    parser.add_argument("--cleanup-only",action="store_true")
    parser.add_argument("--metadata-file")
    parser.add_argument("--output")
    args=parser.parse_args()
    require(args.execute != args.cleanup_only,"select_exactly_one_probe_operation")
    if args.cleanup_only:
        require(cleanup_from_state(os.environ),"owned_cleanup_unconfirmed")
        print('{"ok":true,"ownedCleanupConfirmed":true}')
        return
    require(args.metadata_file and args.output,"probe_paths_missing")
    metadata=json.loads(private_file(args.metadata_file).read_bytes())
    result=Probe(metadata,os.environ,args.output).execute()
    require(result["dataFreeSafetyProofComplete"] and result["sourceMetadataCompatible"]
            and result["cleanupConfirmed"],"data_free_native_probe_unqualified")
    print('{"ok":true,"dataFreeProofWritten":true,"independentlyReviewed":false,"targetsRetained":false}')


if __name__=="__main__":
    def interrupted(*_):raise Stopped("data_free_probe_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception:
        print('{"ok":false,"error":"data_free_native_probe_unqualified"}')
        raise SystemExit(1)
