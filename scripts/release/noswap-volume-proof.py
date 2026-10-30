#!/usr/bin/env python3
"""Read-only runtime evidence for exact owned nonswappable tmpfs volumes.

Never mounts, unmounts, starts a process/container, reads customer file contents,
or grants recovery authority. Raw runtime metadata and device records stay private;
only fixed status/count/hash receipts may be uploaded by the caller. This does
not prove cleanup, universal host sanitization or physical memory erasure.
"""
import hashlib
import json
import os
import re

MAX_BYTES = 8 * 1024**2
PATH = re.compile(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\Z")
DEVICE = re.compile(r"[0-9]+:[0-9]+\Z")
NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\Z")


class Stopped(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stopped(code)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(value):
    return type(value) is str and PATH.fullmatch(value) and all(p not in {".", ".."} for p in value.split("/"))


def _unescape(value):
    require(not re.search(r"\\(?!040|011|012|134)", value), "volume_mountinfo_escape_unqualified")
    value = re.sub(r"\\(040|011|012|134)", lambda m: chr(int(m[1], 8)), value)
    require("\x00" not in value, "volume_mountinfo_escape_unqualified")
    return value


def parse_mountinfo(text):
    require(type(text) is str and len(text.encode()) <= MAX_BYTES, "volume_mountinfo_bound")
    result = []
    for line in text.splitlines():
        fields = line.split(" ")
        require(len(fields) >= 10 and fields.count("-") == 1 and all(fields), "volume_mountinfo_shape")
        split = fields.index("-")
        require(split >= 6 and len(fields) == split + 4
                and fields[0].isdigit() and fields[1].isdigit() and int(fields[0]) > 0
                and DEVICE.fullmatch(fields[2]), "volume_mountinfo_shape")
        result.append({"id":int(fields[0]), "parent":int(fields[1]), "device":fields[2],
                       "root":_unescape(fields[3]), "target":_unescape(fields[4]),
                       "options":fields[5].split(","), "optional":fields[6:split],
                       "type":fields[split+1], "source":_unescape(fields[split+2]),
                       "superOptions":fields[split+3].split(",")})
        require(len(result) <= 16384, "volume_mountinfo_bound")
    require(len({row["id"] for row in result}) == len(result), "volume_mountinfo_duplicate_id")
    return result


def runtime_proof_script():
    """Execute only with exact validated destination arguments in pinned images."""
    return r'''set -euo pipefail
[[ "$#" -gt 0 && "$#" -le 64 ]]
cap=missing; nnp=missing
while IFS=: read -r field value; do
 case "$field" in CapEff) cap=${value//[[:space:]]/};; NoNewPrivs) nnp=${value//[[:space:]]/};; esac
done < /proc/self/status
read -r swap < /sys/fs/cgroup/memory.swap.max
printf 'C\t%s\t%s\t%s\t%s\n' "$(id -u)" "$cap" "$nnp" "$swap"
while IFS= read -r line; do printf 'M\t%s\n' "$line"; done < /proc/self/mountinfo
for destination in "$@"; do
 [[ "$destination" == /* && -d "$destination" && ! -L "$destination" ]]
 printf 'S\t%s\t' "$destination"
 stat -c '%u %g %a %d %i' -- "$destination"
 printf 'F\t%s\t' "$destination"
 stat -f -c '%b %S %c' -- "$destination"
done
'''


def _specs(specs):
    values = list(specs.values()) if type(specs) is dict else specs
    require(type(values) is list and 0 < len(values) <= 64, "volume_runtime_specs_unqualified")
    for row in values:
        require(type(row) is dict and NAME.fullmatch(row.get("name", ""))
                and safe_path(row.get("destination")) and safe_path(row.get("mountpoint"))
                and row.get("driver") == "local" and row.get("device") == "tmpfs"
                and type(row.get("size_mib")) is int and 64 <= row["size_mib"] <= 32768
                and all(type(row.get(k)) is int and 0 <= row[k] < 2**32 for k in ["uid", "gid"])
                and row.get("mode") in {"0700", "1777"}
                and type(row.get("nr_inodes")) is int and 0 < row["nr_inodes"] <= 1048576,
                "volume_runtime_specs_unqualified")
    require(len({r["name"] for r in values}) == len(values)
            and len({r["destination"] for r in values}) == len(values), "volume_runtime_specs_duplicate")
    return sorted(values, key=lambda r:r["destination"])


def validate_runtime_proof(raw, specs):
    """Pure verifier. Returned records are PRIVATE state, not artifact output."""
    specs = _specs(specs)
    require(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES, "volume_runtime_output_bound")
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeError:
        raise Stopped("volume_runtime_output_unqualified") from None
    controls=[];mounts=[];stats={};filesystems={}
    for line in lines:
        fields=line.split("\t")
        require(len(fields)>=2, "volume_runtime_output_unqualified")
        if fields[0]=="C":
            controls.append(fields[1:])
        elif fields[0]=="M":
            require(len(fields)==2, "volume_runtime_output_unqualified");mounts.append(fields[1])
        elif fields[0] in {"S","F"}:
            require(len(fields)==3 and safe_path(fields[1]), "volume_runtime_output_unqualified")
            output=stats if fields[0]=="S" else filesystems
            require(fields[1] not in output, "volume_runtime_output_duplicate")
            output[fields[1]]=fields[2].split(" ")
        else:
            raise Stopped("volume_runtime_output_unqualified")
    require(len(controls)==1 and len(controls[0])==4 and controls[0][0].isdigit()
            and int(controls[0][0])>0 and controls[0][1]=="0000000000000000"
            and controls[0][2:]==["1","0"], "volume_runtime_capability_or_swap_unqualified")
    destinations={r["destination"] for r in specs}
    require(set(stats)==set(filesystems)==destinations, "volume_runtime_stat_coverage")
    mounts=parse_mountinfo("\n".join(mounts))
    root=[r for r in mounts if r["target"]=="/"]
    require(len(root)==1 and "ro" in root[0]["options"] and "rw" not in root[0]["options"],
            "volume_runtime_root_not_readonly")
    records=[];observations=[]
    for spec in specs:
        destination=spec["destination"]
        candidates=[r for r in mounts if r["target"]==destination]
        require(len(candidates)==1, "volume_runtime_mount_missing_or_shadowed")
        mount=candidates[0]
        require(mount["type"]==mount["source"]=="tmpfs" and mount["root"]=="/"
                and {"rw","nosuid","nodev","noexec"}<=set(mount["options"])
                and "ro" not in mount["options"] and "noswap" in mount["superOptions"]
                and not mount["optional"], "volume_runtime_mount_policy_unqualified")
        require(not any(r["target"].startswith(destination+"/") for r in mounts),
                "volume_runtime_descendant_mount")
        value=stats[destination];fs=filesystems[destination]
        require(len(value)==5 and all(v.isdigit() for v in value)
                and len(fs)==3 and all(v.isdigit() for v in fs), "volume_runtime_stat_unqualified")
        uid,gid,mode,device,inode=map(int,value)
        require(str(mode)==value[2] and re.fullmatch(r"[0-7]{3,4}",value[2])
                and uid==spec["uid"] and gid==spec["gid"] and int(value[2],8)==int(spec["mode"],8)
                and inode>0 and f"{os.major(device)}:{os.minor(device)}"==mount["device"],
                "volume_runtime_owner_mode_or_device_mismatch")
        blocks,blocksize,inodes=map(int,fs)
        require(blocks>0 and blocksize>0 and blocks*blocksize==spec["size_mib"]*1024**2
                and inodes==spec["nr_inodes"], "volume_runtime_capacity_mismatch")
        records.append({"name":spec["name"],"device":mount["device"],"root":"/",
                        "hostmountpoint":spec["mountpoint"],"destination":destination})
        observations.append({"name":spec["name"],"device":mount["device"],"uid":uid,"gid":gid,
                             "mode":spec["mode"],"bytes":blocks*blocksize,"inodes":inodes})
    require(len({r["device"] for r in records})==len(records), "volume_runtime_shared_superblock")
    return {"receipt":{"format":1,"operation":"owned-noswap-volume-runtime-proof",
                       "mountCount":len(records),"tmpfsNoSwapObserved":True,"rootReadOnlyObserved":True,
                       "capabilitiesDroppedObserved":True,"noNewPrivilegesObserved":True,
                       "memorySwapDisabledObserved":True,"privateMountPropagationObserved":True,
                       "observedMetadataSha256":digest(canonical(observations)),"customerFileContentsRead":False},
            "records":records}
