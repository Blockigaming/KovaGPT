#!/usr/bin/env python3
"""Native generic-tool smoke; no production metadata, target or customer input."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent
TOOLS=["python3","node","gpg","psql","pg_dump","pg_restore","timeout","bash","sha256sum"]
SOURCE_NAMES=["managed-auth-recovery.py","managed-auth-recovery-target.mjs","verify-isolated-restore-target.mjs",
              "empty-restore-target-catalog.sql","recovery-operator-client-smoke.py","run-isolated-recovery-client.py",
       "extension-semantic-capture.py","extension-routine-type-payloads.py",
       "extension-routine-type-hash-query.py","extension-relation-payloads.py",
       "extension-relation-query-hooks.py","pg17-extension-relation-manifest.json",
       "canonicalize-pg17-extension-nodes.py","pg17-extension-node-schema.json",
       "extension-regclass-datum-byteorder-audit.sql"]


def require(value):
    if not value:raise RuntimeError("generic_client_native_smoke_unqualified")


def call(argv, *, data=None, env=None, valid=True):
    result=subprocess.run(argv,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                          env=env,check=False,timeout=20)
    require(len(result.stdout)<=16*1024**2 and len(result.stderr)<=1024**2)
    if valid:require(result.returncode==0)
    return result


def smoke():
    require(os.getuid()!=0)
    status=dict(line.split(":",1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    require(status.get("NoNewPrivs","").strip()=="1" and all(int(status.get(key,"f").strip(),16)==0
            for key in ["CapInh","CapPrm","CapEff","CapBnd","CapAmb"]))
    mounts=[line.split() for line in Path("/proc/mounts").read_text().splitlines()]
    root=next(row for row in mounts if row[1]=="/")
    temporary=next(row for row in mounts if row[1]=="/tmp")
    require("ro" in root[3].split(",") and temporary[2]=="tmpfs"
            and {"nosuid","nodev","noexec","noswap"}<=set(temporary[3].split(",")))
    swap=Path("/sys/fs/cgroup/memory.swap.max")
    require(swap.is_file() and swap.read_text().strip()=="0")
    inventory=[]
    for name in TOOLS:
        path=Path(shutil.which(name) or "missing").resolve();require(path.is_file())
        version=call([str(path),"--version"]).stdout.decode().splitlines()[0]
        require(version and len(version)<=512)
        if name in {"psql","pg_dump","pg_restore"}:
            require(re.match(re.escape(name)+r" \(PostgreSQL\) 17\.",version))
        inventory.append({"name":name,"path":str(path),"version":version,
                          "sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    # Exercise the exact existing Python engine's stdlib imports and module.
    spec=importlib.util.spec_from_file_location("kova_recovery",ROOT/"managed-auth-recovery.py")
    engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
    require(engine.BUILD=="17.6.1.155" and engine.GUARD.is_file() and engine.EMPTY_CENSUS.is_file())
    launcher_spec=importlib.util.spec_from_file_location("kova_file_client",ROOT/"run-isolated-recovery-client.py")
    launcher=importlib.util.module_from_spec(launcher_spec);launcher_spec.loader.exec_module(launcher)
    loaded=launcher.load_engine(hashlib.sha256((ROOT/"managed-auth-recovery.py").read_bytes()).hexdigest())
    require(loaded.BUILD==engine.BUILD)
    # Load every final format-3 helper/schema/query hook without database input.
    semantic=engine.semantic_module()
    semantic_sources=semantic.source_files()
    require(set(semantic_sources)==set(semantic.HELPERS)
            and all(re.fullmatch(r"[a-f0-9]{64}",v) for v in semantic_sources.values()))
    semantic.audit_body()
    adapter=semantic.relations.adapter_options(semantic.core)
    require("pg_extension" in adapter["manifests"])
    private_query=semantic.generator.build_capture_all_private_wire_query(
        **semantic.relations.capture_query_options(semantic.core,semantic.generator))
    require(type(private_query) is str and "PRIVATE_GHA_CAPTURE_ONLY" in private_query)
    with tempfile.TemporaryDirectory(prefix="generic-client-") as directory:
        work=Path(directory);os.chmod(work,0o700)
        phrase=secrets.token_urlsafe(48).encode()
        plain=work/"synthetic";cipher=work/"synthetic.gpg";restored=work/"synthetic.restored"
        plain.write_bytes(b"Kova generic client smoke\n"+secrets.token_bytes(128));plain.chmod(0o600)
        # Use the actual engine's GPG invocation and its private GNUPGHOME.
        engine.crypt(dict(os.environ),phrase,plain,cipher)
        engine.crypt(dict(os.environ),phrase,cipher,restored,decrypt=True)
        require(plain.read_bytes()==restored.read_bytes())
        (work/"wrong-home").mkdir(mode=0o700)
        wrong=call(["gpg","--no-options","--batch","--no-symkey-cache","--pinentry-mode","loopback",
                    "--passphrase-fd","0","--output",str(work/"wrong"),"--decrypt",str(cipher)],
                   data=b"wrong synthetic phrase",env={**os.environ,"GNUPGHOME":str(work/"wrong-home")},valid=False)
        require(wrong.returncode!=0 and b"bad session key" in wrong.stderr.lower())
        passfile=work/"pgpass";passfile.write_text("*:5432:postgres:synthetic:synthetic\n");passfile.chmod(0o600)
        ca=work/"synthetic-ca.crt";ca.write_text("synthetic config-only certificate path\n")
        target={"APPROVED_ISOLATED_PG17_DATABASE_URL":"postgresql://synthetic@client-smoke.internal:5432/postgres?sslmode=verify-full&sslrootcert="+str(ca),
                "APPROVED_ISOLATED_HOST":"client-smoke.internal","APPROVED_ISOLATED_DBNAME":"postgres",
                "APPROVED_ISOLATED_PORT":"5432","APPROVED_ISOLATED_SERVER_IP":"172.30.240.2",
                "APPROVED_ISOLATED_SYSTEM_IDENTIFIER":"123456789","PGPASSFILE":str(passfile)}
        node_env={**os.environ,**target}
        result=call(["node",str(engine.GUARD),"--configuration"],env=node_env)
        require(json.loads(result.stdout)["expectedSystemId"]=="123456789")
        rejected=call(["node",str(engine.GUARD),"--configuration"],env={**node_env,"PGPASSWORD":"synthetic"},valid=False)
        require(rejected.returncode!=0)
    packages=(Path("/opt/kova-build")/"packages.tsv").read_bytes()
    signatures=sorted((Path("/opt/kova-build")/"apt-inrelease").glob("*_InRelease"))
    require(packages and signatures)
    return {"operation":"generic-recovery-client-native-smoke","nonroot":True,"tools":inventory,
            "genericSourceSha256":{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in SOURCE_NAMES},
            "packageInventorySha256":hashlib.sha256(packages).hexdigest(),
            "installedPackageCount":len(packages.splitlines()),
            "signedInReleaseFiles":[{"name":p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in signatures],
            "nativePythonEngineImport":True,"nativeNodeDestinationGuard":True,"nodePasswordOverrideRejected":True,
            "nativeFileBoundLauncherImport":True,"nativeSemanticDependencyClosureLoaded":True,"readonlyRootObserved":True,"noNewPrivilegesObserved":True,
            "capabilitiesDroppedObserved":True,"tmpfsNoSwapObserved":True,"memorySwapDisabledObserved":True,
            "syntheticGpgRoundtrip":True,"wrongGpgPassphraseRejected":True,
            "actualTargetConnected":False,"customerRowsUsed":False,"restorePerformed":False}


if __name__=="__main__":
    try:print(json.dumps(smoke(),sort_keys=True,separators=(",",":")))
    except Exception:
        print('{"ok":false,"error":"generic_client_native_smoke_unqualified"}')
        raise SystemExit(1)
