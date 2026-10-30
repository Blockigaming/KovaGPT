#!/usr/bin/env python3
"""Native operator-image client and private target guards, without authority.

The real constructor preserves the original protected-main source/context guard.
A separately guarded synthetic caller can initialize fixture-only state and use
these same runtime checks. Neither this module nor a successful probe grants
owner review, source compatibility, decryption or restore permission.
"""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import tempfile

HERE=Path(__file__).resolve().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value

base=module("operator_base_probe","probe-empty-recovery-target.py")
builder=module("operator_base_builder","prepare-recovery-operator-image.py")
ram=module("operator_owned_ram","owned-noswap-volumes.py")
volume_proof=module("operator_ram_proof","noswap-volume-proof.py")
Stopped=base.Stopped
require=base.require
encoded=base.encoded
digest=base.digest
IMAGE=base.IMAGE
BUILD=base.BUILD
SHA=base.SHA
OPERATOR=base.OPERATOR
FORBIDDEN_ENV=base.FORBIDDEN_ENV
ROOT=base.ROOT
recovery=base.recovery
ident=base.ident
CLEANUP_STORAGE_CODES=frozenset({"owned_volume_creation_outcome_unknown","owned_volume_activated_runtime_unconfirmed",
    "owned_volume_census_unqualified","owned_volume_configuration_changed","owned_volume_inspect_unqualified",
    "owned_volume_container_references_present","owned_volume_removal_unconfirmed",
    "owned_volume_command_unconfirmed","owned_volume_command_output_unqualified"})


def safe_storage_cleanup_code(error):
    if (type(error) is ram.Stopped and len(error.args)==1 and type(error.args[0]) is str
            and error.args[0] in CLEANUP_STORAGE_CODES):return error.args[0]
    return "owned_storage_cleanup_unconfirmed"


def environment(values):
    require(isinstance(values,list) and all(isinstance(x,str) and "=" in x for x in values),
            "operator_environment_shape_unqualified")
    out=dict(x.split("=",1) for x in values)
    require(len(out)==len(values) and not any(k in base.FORBIDDEN_ENV or k.startswith("KOVA_PRODUCTION_")
            or k.startswith("APPROVED_ISOLATED_") for k in out),"operator_environment_unqualified")
    return out


class OperatorProbe(base.Probe):
    """Reuse with a reviewed exact OCI ID; source/restore gates remain external."""
    def __init__(self,metadata,env,output,*,operator_image_id,operator_source_sha=None,resources=None):
        super().__init__(metadata,env,output)
        self.configure_operator(operator_image_id,operator_source_sha or self.source,resources)

    def configure_operator(self,image_id,source_sha,resources=None):
        require(re.fullmatch(r"sha256:[a-f0-9]{64}",image_id or "")
                and re.fullmatch(r"[a-f0-9]{40}",source_sha or ""),"operator_image_pin_required")
        self.operator_image_id=image_id;self.operator_source_sha=source_sha
        self.client_tools={};self.operator_env={};self.bash_pins={};self.operator_smoke=None
        self.timeout_pins={}
        self.server_image_id=None
        self.ram_volumes=None;self.ram_keys={};self.short_ram_index=0
        self.names.update({key:"kova-empty-"+key+"-"+self.token for key in ["smoke","toolcheck"]})
        self.state_path=self.runner_temp/("kova-operator-owned-"+self.run_id+"-"+self.attempt+".json")
        require(not self.state_path.exists(),"operator_attempt_already_reserved")
        defaults={"clientMemoryMiB":768,"clientTmpfsMiB":128,
                  "serverMemoryMiB":{"a":768,"b":768},"serverTmpfsMiB":{"a":256,"b":256}}
        self.resources=resources or defaults
        require(set(self.resources)==set(defaults)
                and all(type(self.resources[k]) is int and 64<=self.resources[k]<=32768
                        for k in ["clientMemoryMiB","clientTmpfsMiB"])
                and all(type(self.resources[k]) is dict and set(self.resources[k])=={"a","b"}
                        and all(type(v) is int and 64<=v<=32768 for v in self.resources[k].values())
                        for k in ["serverMemoryMiB","serverTmpfsMiB"])
                and self.resources["clientTmpfsMiB"]+128<self.resources["clientMemoryMiB"]
                and all(self.resources["serverTmpfsMiB"][k]+128<self.resources["serverMemoryMiB"][k]
                        for k in ["a","b"]),"operator_memory_policy_unqualified")

    def owned_ram(self):
        if self.ram_volumes is None:
            self.ram_volumes=ram.OwnedVolumes(self.source,self.token,self.run_id,self.attempt,self.runner_temp,
                lambda args,**kwargs:self.run(args,**kwargs)[1])
        return self.ram_volumes

    def ram_mount(self,key,destination,size_mib,uid,gid,mode):
        value=self.owned_ram().ensure(key,destination,size_mib,uid,gid,mode)
        return value

    def cleanup_storage(self):
        # Constructor-free cleanup backstops attach only validated owned state.
        managers=([self.ram_volumes] if getattr(self,"ram_volumes",None) is not None else
            ram.restore_from_state({"GITHUB_SHA":self.source,"GITHUB_RUN_ID":self.run_id,
                "GITHUB_RUN_ATTEMPT":self.attempt,"RUNNER_TEMP":str(self.runner_temp)},
                context_validator=lambda _:self.source,command=lambda args,**kwargs:self.run(args,**kwargs)[1]))
        safe=True
        for manager in managers:
            if manager.owner==self.token:
                try:
                    safe=bool(manager.cleanup()) and safe
                except Exception as error:
                    safe=False
                    if not getattr(self,"storage_cleanup_code",None):
                        self.storage_cleanup_code=safe_storage_cleanup_code(error)
        return safe

    def docker(self,args,**kwargs):
        # Short data-free tools prove their mounted backing before executing,
        # then return the original stdout after the private proof is stripped.
        keys=None;image=None;default_entrypoint=None
        if args[:1]==["run"] and "--rm" in args and "--name" not in args:
            require(IMAGE in args and args[args.index("--network")+1]=="none",
                    "unowned_native_container_forbidden")
            name=self.names["toolcheck"]
            if name not in self.containers_reserved:self.reserve_absent(name)
            else:require(self.resource_absent(name),"toolcheck_name_not_absent")
            self.save_state()
            key="toolcheck"+str(self.short_ram_index)+"-tmp";self.short_ram_index+=1
            mount=self.ram_mount(key,"/tmp",128,self.uid,self.gid,"1777")
            keys=[key];image=IMAGE
            args=["run","--name",name,"--log-driver","none","--cgroupns","private",
                  "--memory","768m","--memory-swap","768m","--mount",mount,
                  *self.labels(),*args[1:]]
        elif args[:1]==["run"] and "--rm" in args and "--name" in args and args[args.index("--name")+1]==self.names["smoke"]:
            keys=["smoke-tmp"];image=self.operator_image_id
            default_entrypoint=["python3","/opt/kova/scripts/release/recovery-operator-client-smoke.py"]
        if keys is None:return super().docker(args,**kwargs)
        index=args.index(image);options=args[:index];command=args[index+1:]
        if "--entrypoint" in options:
            entry=options.index("--entrypoint");original=[options[entry+1]]
            del options[entry:entry+2]
        else:
            require(default_entrypoint is not None,"short_run_entrypoint_unqualified");original=default_entrypoint
        specs=self.owned_ram().expected_mounts(keys)
        self.owned_ram().record_activation(keys)
        wrapper="""proof=$1; count=$2; shift 2
paths=( "${@:1:count}" ); shift "$count"
printf '%s\n' KOVA_PRIVATE_RAM_PROOF_BEGIN
/bin/bash -ceu "$proof" kova-private-ram-check "${paths[@]}"
printf '%s\n' KOVA_PRIVATE_RAM_PROOF_END
exec "$@"
"""
        wrapped=options+["--entrypoint","/bin/bash",image,"-ceu",wrapper,"kova-framed-ram-proof",
            volume_proof.runtime_proof_script(),str(len(specs)),*[s["destination"] for s in specs],*original,*command]
        allow=kwargs.pop("allow_failure",False)
        code,raw=super().docker(wrapped,allow_failure=True,**kwargs)
        begin=b"KOVA_PRIVATE_RAM_PROOF_BEGIN\n";end=b"KOVA_PRIVATE_RAM_PROOF_END\n"
        require(raw.startswith(begin) and raw.count(end)==1,"short_run_kernel_proof_unconfirmed")
        proof,stdout=raw[len(begin):].split(end,1)
        observed=volume_proof.validate_runtime_proof(proof,specs)
        self.owned_ram().record_runtime_proof(observed["records"])
        require(code==0 or allow,"native_command_failed")
        return code,stdout

    def labels(self):
        out=[]
        for k,v in {"kova.empty-probe.owner":self.token,"kova.empty-probe.source":self.source,
                    "kova.empty-probe.run":self.run_id,"kova.empty-probe.attempt":self.attempt}.items():
            out += ["--label",k+"="+v]
        return out

    def initialize(self):
        super().initialize()
        _,raw=self.docker(["image","inspect",IMAGE])
        server=json.loads(raw)[0]
        self.server_image_id=server.get("Id")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}",self.server_image_id or "")
                and self.server_image_id==self.server_image_qualification["imageId"],"server_image_id_unqualified")
        self.image_env=environment(server.get("Config",{}).get("Env",[]))
        _,raw=self.docker(["run","--rm","--no-healthcheck","--network","none","--cap-drop","ALL",
            "--security-opt","no-new-privileges:true","--user",str(self.uid)+":"+str(self.gid),
            "--read-only","--entrypoint",self.native_tools["sha256sum"],IMAGE,"/bin/bash"])
        server_bash=raw.decode().split()[0]
        require(SHA.fullmatch(server_bash),"server_bash_identity_missing")
        self.bash_pins.update(a=server_bash,b=server_bash)
        _,raw=self.docker(["image","inspect",self.operator_image_id])
        values=json.loads(raw)
        require(len(values)==1,"operator_image_identity_unconfirmed")
        info=values[0];config=info.get("Config",{})
        require(info.get("Id")==self.operator_image_id and info.get("Architecture")=="amd64"
                and info.get("Os")=="linux" and not config.get("Volumes")
                and config.get("Healthcheck",{}).get("Test")==["NONE"]
                and config.get("Labels",{}).get("org.opencontainers.image.revision")==self.operator_source_sha,
                "operator_image_identity_unconfirmed")
        self.operator_env=environment(config.get("Env",[]))
        require(set(self.operator_env)<={"PATH","LANG","LC_ALL","TZ","PYTHONDONTWRITEBYTECODE"},
                "operator_image_environment_not_generic")
        smoke_name=self.names["smoke"];self.reserve_absent(smoke_name);self.save_state()
        _,raw=self.docker(["run","--rm","--name",smoke_name,*self.labels(),"--log-driver","none",
            "--no-healthcheck","--network","none","--cap-drop","ALL","--security-opt","no-new-privileges:true",
            "--read-only","--user",str(self.uid)+":"+str(self.gid),"--cgroupns","private",
            "--pids-limit","128","--memory","768m","--memory-swap","768m","--cpus","1",
            "--mount",self.ram_mount("smoke-tmp","/tmp",128,self.uid,self.gid,"1777"),self.operator_image_id],timeout=90)
        smoke=builder.check_smoke(json.loads(raw))
        expected={name:builder.file_sha(HERE/name) for name in builder.FILES}
        require(smoke.get("genericSourceSha256")==expected,"operator_source_files_mismatch")
        self.operator_smoke=smoke
        self.client_tools={r["name"]:r["path"] for r in smoke["tools"]}
        self.bash_pins["client"]=next(r["sha256"] for r in smoke["tools"] if r["name"]=="bash")
        available=int(os.sysconf("SC_PHYS_PAGES"))*int(os.sysconf("SC_PAGE_SIZE"))//1024**2
        committed=self.resources["clientMemoryMiB"]+sum(self.resources["serverMemoryMiB"].values())
        require(committed*5<=available*4,"operator_memory_exceeds_host_budget")

    def _container_args(self,key):
        args=super()._container_args(key)
        memory=self.resources["clientMemoryMiB"] if key=="client" else self.resources["serverMemoryMiB"][key]
        args[args.index("--memory")+1]=str(memory)+"m"
        args += ["--memory-swap",str(memory)+"m","--cgroupns","private","--log-driver","none"]
        out=[];i=0;keys=[];mask_index=0
        while i<len(args):
            if args[i]=="--tmpfs":
                destination=args[i+1].split(":",1)[0]
                if key=="client" and destination!="/tmp" or key!="client" and destination=="/run/server/data":i+=2;continue
                volume_key=key+"-tmp" if destination=="/tmp" else key+"-mask"+str(mask_index)
                mask_index+=1
                size=128 if destination=="/tmp" else 64
                uid,gid=(self.uid,self.gid) if key=="client" else (self.pg_uid,self.pg_gid)
                mode="1777" if destination=="/tmp" else "0700"
                out += ["--mount",self.ram_mount(volume_key,destination,size,uid,gid,mode)]
                keys.append(volume_key);i+=2;continue
            if args[i]=="--mount" and key!="client":
                out += ["--mount",args[i+1]+",readonly"];i+=2;continue
            out.append(args[i]);i+=1
        if key=="client":
            volume_key="client-work";keys.append(volume_key)
            out += ["--mount",self.ram_mount(volume_key,"/work",self.resources["clientTmpfsMiB"],self.uid,self.gid,"0700"),
                    "--env","TMPDIR=/work"]
        else:
            volume_key=key+"-data";keys.append(volume_key)
            out += ["--mount",self.ram_mount(volume_key,"/run/server/data",self.resources["serverTmpfsMiB"][key],self.pg_uid,self.pg_gid,"0700")]
        self.ram_keys[key]=keys
        return out

    def assert_runtime_policy(self,key):
        specs=[self.owned_ram().specs[k] for k in self.ram_keys[key]]
        _,raw=self.docker(["exec",self.names[key],"/bin/bash","-ceu",volume_proof.runtime_proof_script(),
                          "kova-private-ram-proof",*[s["destination"] for s in specs]])
        observed=volume_proof.validate_runtime_proof(raw,specs)
        self.owned_ram().record_runtime_proof(observed["records"])
        return observed["receipt"]

    def consumer_proof(self,target):
        proof=super().consumer_proof(target)
        _,raw=self.client_sql(target,"SELECT jsonb_build_object('collector',current_setting('logging_collector'),'destination',current_setting('log_destination'),'statement',current_setting('log_statement'))::text;\n")
        value=json.loads(raw)
        require(value=={"collector":"off","destination":"stderr","statement":"none"},"runtime_logging_policy_changed")
        self.assert_runtime_policy(target)
        self.inspect_and_recheck_runtime("client")
        return proof

    def inspect_and_recheck_runtime(self,key):
        self.verify_container(key,self.inspect(self.names[key]));self.assert_runtime_policy(key)


    def start_container(self,key):
        self.reserve_absent(self.names[key])
        self.save_state()
        if key=="client":
            script="trap 'exit 0' TERM INT; while :; do sleep 1; done"
        else:
            script="""while [ ! -f /run/server/network-ready ]; do sleep 1; done
initdb -D "$PGDATA" --username=kova_probe_operator --auth-local=trust --auth-host=scram-sha-256 --pwfile=/run/server/password >/tmp/init.log 2>&1
printf '%s\\n' 'logging_collector=off' \"log_destination='stderr'\" 'log_statement=none' >> \"$PGDATA/postgresql.conf\"
printf '%s\n' 'hostssl all all 172.30.240.4/32 scram-sha-256' 'hostssl all all fd68:6b6f:7661:240::4/128 scram-sha-256' 'host all all 0.0.0.0/0 reject' 'host all all ::/0 reject' >> "$PGDATA/pg_hba.conf"
pg_ctl -D "$PGDATA" -l /tmp/postgres.log -o "-c listen_addresses='*' -c ssl=on -c ssl_cert_file=/run/server/server.crt -c ssl_key_file=/run/server/server.key -c ssl_ca_file=/run/server/ca.crt -c unix_socket_directories=/tmp -c shared_preload_libraries='' -c cron.launch_active_jobs=off -c autovacuum=off -c log_statement=none" -w start >/tmp/pg-start.log 2>&1
trap 'pg_ctl -D "$PGDATA" -m fast -w stop >/tmp/stop.log 2>&1 || true; exit 0' TERM INT
while :; do sleep 1; done"""
        args=self._container_args(key)
        self.owned_ram().record_activation(self.ram_keys[key])
        self.docker(args+["--entrypoint","/bin/bash",(self.operator_image_id if key=="client" else IMAGE),"-ceu",script])
        info=self.inspect(self.names[key]);self.verify_container(key,info)
        self.namespace_firewall(key,info["State"]["Pid"])
        self.assert_runtime_policy(key)
        if key!="client":self.run(["sudo","-n","tee",str(self.server_dirs[key]/"network-ready")],data=b"ready\n")
        return info

    def verify_container(self,key,info):
        require(info.get("Config",{}).get("Labels",{}).get("kova.empty-probe.owner")==self.token
                and info.get("State",{}).get("Running") is True and type(info["State"].get("Pid")) is int
                and info["State"]["Pid"]>1,"owned_running_container_unconfirmed")
        require(info.get("Image")== (self.operator_image_id if key=="client" else self.server_image_id),"running_image_id_changed")
        host=info.get("HostConfig",{})
        memory=(self.resources["clientMemoryMiB"] if key=="client" else self.resources["serverMemoryMiB"][key])*1024**2
        require(host.get("LogConfig",{}).get("Type")=="none" and host.get("CgroupnsMode")=="private"
                and host.get("Memory")==host.get("MemorySwap")==memory,
                "runtime_log_swap_or_cgroup_policy_changed")
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
                and binds[0].get("Destination")==expected_destination and binds[0].get("RW") is False
                and all(m.get("Type") in {"bind","volume"} for m in info.get("Mounts",[])),
                "unexpected_container_mount")
        require(info["Config"].get("Healthcheck",{}).get("Test")==["NONE"],"image_healthcheck_not_disabled")
        expected_specs=[self.owned_ram().specs[k] for k in self.ram_keys[key]]
        actual_volumes=[m for m in info.get("Mounts",[]) if m.get("Type")=="volume"]
        require(len(actual_volumes)==len(expected_specs)
                and {m.get("Destination") for m in actual_volumes}=={s["destination"] for s in expected_specs},
                "private_tmpfs_data_plane_missing")
        for spec in expected_specs:
            actual=next(m for m in actual_volumes if m["Destination"]==spec["destination"])
            ram.verify_inspected_mount(spec,actual)
        environment=dict(x.split("=",1) for x in info["Config"].get("Env",[]) if "=" in x)
        allowed={**(self.operator_env if key=="client" else self.image_env),"HOME":"/tmp","TZ":"UTC"}
        if key=="client":allowed["TMPDIR"]="/work"
        if key!="client":allowed["PGDATA"]="/run/server/data"
        require(len(environment)==len(info["Config"].get("Env",[])),"duplicate_container_environment")
        require(environment==allowed and not any(k in FORBIDDEN_ENV for k in environment),"container_environment_unqualified")
        user=info["Config"].get("User","")
        require(user==str(self.uid)+":"+str(self.gid) if key=="client"
                else user==str(self.pg_uid)+":"+str(self.pg_gid),"container_nonroot_user_unconfirmed")
        net=info["NetworkSettings"]["Networks"].get(self.network,{})
        require(net.get("IPAddress")==self.addresses[key][0]
                and net.get("GlobalIPv6Address")==self.addresses[key][1],"container_ip_pin_mismatch")

    def client_sql(self,target,sql,*,family=4,host=None,ca="/run/client/ca.crt",allow_failure=False):
        ip=self.addresses[target][family==6]
        flags=["exec","-i","--user",str(self.uid)+":"+str(self.gid)]
        values={"PGHOST":host or self.hosts[target],"PGHOSTADDR":ip,"PGPORT":"5432","PGDATABASE":"postgres",
                "PGUSER":OPERATOR,"PGSSLMODE":"verify-full","PGSSLROOTCERT":ca,
                "PGPASSFILE":"/run/client/pgpass","PGCONNECT_TIMEOUT":"3",
                "PGOPTIONS":recovery.CANONICAL_PG+" -c default_transaction_read_only=on"}
        for key,value in values.items():flags += ["--env",key+"="+value]
        return self.docker(flags+[self.names["client"],self.client_tools["psql"],"-X","--no-password","--quiet",
            "--tuples-only","--no-align","--set","ON_ERROR_STOP=1","--set","VERBOSITY=sqlstate","--file","-"],
            data=sql.encode(),timeout=30,allow_failure=allow_failure)

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
            self.docker(["exec",self.names["client"],self.client_tools["timeout"],"3","/bin/bash","-ceu",
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
        _,schema=self.docker(args+[self.names["client"],self.client_tools["pg_dump"],"--no-password","--schema-only"],timeout=60)
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

    def timeout_control(self,key,tools):
        expired=super().timeout_control(key,tools)
        if key=="client":
            expected=next((row.get("sha256") for row in self.operator_smoke["tools"] if row.get("name")=="timeout"),None)
            require(self.timeout_pins[key]==expected,"timeout_control_identity_unconfirmed")
        return expired

    def denial_probes(self,targets):
        self.stage="actual_egress_denial"
        count=0
        extra=[("docker-dns","127.0.0.11",53),("docker-host-gateway","172.30.240.1",443),
               ("container-loopback","127.0.0.1",5432),("container-loopback","::1",5432)]
        for key in ["a","b","client"]:
            tools=self.client_tools if key=="client" else self.native_tools
            # /dev/tcp is the same pinned Bash that passed the actual dual-stack
            # TLS controls. Missing tools/unknown execution states never pass.
            self.docker(["exec",self.names[key],"/bin/bash","--version"])
            expired=self.timeout_control(key,tools)
            _,raw=self.docker(["exec",self.names[key],tools["sha256sum"],"/bin/bash"])
            value=raw.decode().split()[0];require(SHA.fullmatch(value) and value==self.bash_pins[key],"bash_control_identity_changed")
            for kind,ip,port in targets+extra:
                ipaddress.ip_address(ip);require(port in {53,443,5432},"denial_probe_port_unqualified")
                code=self.timed_denial_command(key,tools,"exec 3<>/dev/tcp/"+ip+"/"+str(port),expired)
                if code==1:
                    require(b"network is unreachable" in self.last_stderr.lower()
                            or b"no route to host" in self.last_stderr.lower(),"numeric_denial_cause_unconfirmed")
                self.network_evidence.append({"container":key,"kind":kind,"family":ipaddress.ip_address(ip).version,
                                              "port":port,"addressSha256":digest(ip.encode()),"connectDenied":True})
                count+=1
            # An actual UDP DNS query must receive no reply; TCP53 alone would
            # not test Docker's embedded UDP resolver escape path.
            self.docker(["exec",self.names[key],"/bin/bash","-ceu","command -v dd >/dev/null"])
            dns="exec 3<>/dev/udp/127.0.0.11/53; printf '\\x12\\x34\\x01\\x00\\x00\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x07example\\x03com\\x00\\x00\\x01\\x00\\x01' >&3; exec dd bs=1 count=1 <&3 >/dev/null 2>&1"
            code=self.timed_denial_command(key,tools,dns,expired)
            require(code==expired,"embedded_dns_udp_denial_unconfirmed")
            count+=1
        return count


def cleanup_operator_state(env, *, context_validator=base.checked_context,details=None):
    """Backstop for exact owned resources; no target starts or proof renewal."""
    source=context_validator(env)
    run_id,attempt=env.get("GITHUB_RUN_ID",""),env.get("GITHUB_RUN_ATTEMPT","")
    require(re.fullmatch(r"[1-9][0-9]*",run_id) and re.fullmatch(r"[1-9][0-9]*",attempt),"github_run_identity_missing")
    temp=Path(env.get("RUNNER_TEMP","")).resolve()
    state_path=temp/("kova-operator-owned-"+run_id+"-"+attempt+".json")
    if not state_path.exists():return True
    state=json.loads(base.private_file(state_path).read_bytes())
    require(state.get("format")==1 and state.get("source")==source and state.get("runId")==run_id
            and state.get("attempt")==attempt and state.get("uid")==os.getuid()
            and re.fullmatch(r"[a-f0-9]{10}",state.get("token","")),"owned_cleanup_state_unqualified")
    token=state["token"]
    names={k:"kova-empty-"+k+"-"+token for k in ["a","b","client","smoke","toolcheck"]}
    require(state.get("network")=="kova-empty-"+token and state.get("bridge")=="kr"+token
            and state.get("chain")=="KRP"+token.upper() and state.get("names")==names
            and set(state.get("containersReserved",[]))<=set(names.values())
            and set(state.get("firewallReserved",[]))<={"iptables","ip6tables"},"owned_cleanup_resource_mismatch")
    p=object.__new__(OperatorProbe)
    p.env=base.clean_host_env(env);p.source=source;p.run_id=run_id;p.attempt=attempt;p.runner_temp=temp
    p.state_path=state_path;p.token=token;p.network=state["network"];p.bridge=state["bridge"];p.chain=state["chain"];p.names=names
    p.containers_reserved=state["containersReserved"];p.firewall_reserved=state["firewallReserved"];p.network_reserved=state["networkReserved"]
    p.private_root=Path(state["privateRoot"]) if state.get("privateRoot") else None
    p.pg_uid=state.get("pgUid");p.pg_gid=state.get("pgGid");p.uid=state["uid"];p.gid=state["gid"]
    p.command_count=0;p.last_stderr=b"";p.cleanup_confirmed=False
    safe=p.cleanup()
    if not safe and details is not None:
        code=getattr(p,"storage_cleanup_code",None)
        if type(code) is str and (code in CLEANUP_STORAGE_CODES or code=="owned_storage_cleanup_unconfirmed"):
            details["storageCode"]=code
    return safe
