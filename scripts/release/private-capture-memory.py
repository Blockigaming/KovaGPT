#!/usr/bin/env python3
"""Run-owned, no-swap plaintext workspace; no database access or secret output."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


class Rejected(Exception):
    pass


def require(value, reason):
    if not value:
        raise Rejected(reason)


def target_for(env):
    require(env.get("GITHUB_ACTIONS") == "true"
            and env.get("GITHUB_REPOSITORY") == "Blockigaming/KovaGPT", "capture_memory_context")
    run, attempt = env.get("GITHUB_RUN_ID", ""), env.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[1-9][0-9]*", run) and re.fullmatch(r"[1-9][0-9]*", attempt),
            "capture_memory_identity")
    raw = env.get("RUNNER_TEMP", "")
    require(re.fullmatch(r"/[A-Za-z0-9_./-]+", raw), "capture_memory_root")
    root = Path(raw)
    require(root.resolve() == root and root.is_dir() and not root.is_symlink(), "capture_memory_root")
    info = root.stat()
    require(os.getuid() != 0 and info.st_uid == os.getuid()
            and not stat.S_IMODE(info.st_mode) & 0o022, "capture_memory_owner")
    return root / ("kova-capture-memory-" + run + "-" + attempt)


def mount_for(target, mountinfo=None):
    raw = Path("/proc/self/mountinfo").read_text() if mountinfo is None else mountinfo
    found = []
    for line in raw.splitlines():
        fields = line.split()
        if len(fields) > 6 and fields[4] == str(target):
            require(fields.count("-") == 1, "capture_memory_mount_proof")
            split = fields.index("-")
            require(split >= 6 and len(fields) == split + 4, "capture_memory_mount_proof")
            found.append(dict(fstype=fields[split + 1], source=fields[split + 2],
                              options=set(fields[5].split(",")) | set(fields[split + 3].split(","))))
    require(len(found) <= 1, "capture_memory_mount_ambiguous")
    return found[0] if found else None


def private_mount(target, observed=None):
    require(target.is_dir() and not target.is_symlink(), "capture_memory_path")
    info = target.stat()
    require(info.st_uid == os.getuid() and info.st_gid == os.getgid()
            and stat.S_IMODE(info.st_mode) == 0o700, "capture_memory_permissions")
    observed = mount_for(target) if observed is None else observed
    require(observed is not None and observed["fstype"] == "tmpfs" and observed["source"] == "tmpfs"
            and "ro" not in observed["options"]
            and {"rw", "nosuid", "nodev", "noexec", "noswap"} <= observed["options"],
            "capture_memory_not_private_noswap_tmpfs")


def command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    except (OSError, subprocess.SubprocessError):
        raise Rejected("capture_memory_command_failed") from None
    require(result.returncode == 0, "capture_memory_command_failed")


def prepare(env):
    target = target_for(env)
    require(not target.exists() and not target.is_symlink() and mount_for(target) is None,
            "capture_memory_path_exists")
    target.mkdir(mode=0o700)
    command(["sudo", "-n", "mount", "-t", "tmpfs", "-o",
             "rw,nosuid,nodev,noexec,noswap,size=4G,mode=0700,uid=" + str(os.getuid())
             + ",gid=" + str(os.getgid()), "tmpfs", str(target)])
    private_mount(target)
    environment = Path(env.get("GITHUB_ENV", ""))
    require(environment.is_file() and not environment.is_symlink()
            and environment.stat().st_uid == os.getuid(), "capture_memory_environment")
    with environment.open("a") as stream:
        stream.write("TMPDIR=" + str(target) + "\n")
    return dict(operation="capture-memory-prepare", privateNoswapTmpfsObserved=True,
                databaseConnected=False, plaintextCustomerDataUsed=False)


def verify(env):
    target = target_for(env)
    private_mount(target)
    require(env.get("TMPDIR") == str(target) and Path(tempfile.gettempdir()) == target,
            "capture_memory_tempfile_binding")
    # Exercise a real file in the selected kernel mount before any source credential is used.
    canary = target / "data-free-memory-roundtrip"
    descriptor = os.open(canary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(b"KOVA_DATA_FREE_MEMORY_PROBE\n")
        require(canary.read_bytes() == b"KOVA_DATA_FREE_MEMORY_PROBE\n", "capture_memory_roundtrip")
    finally:
        canary.unlink()
    return dict(operation="capture-memory-verify", privateNoswapTmpfsObserved=True,
                pythonTemporaryFilesBoundToMemory=True, dataFreeFileRoundtripVerified=True,
                databaseConnected=False, plaintextCustomerDataUsed=False)


def cleanup(env):
    target = target_for(env)
    require(not target.is_symlink(), "capture_memory_path")
    observed = mount_for(target)
    if observed is not None:
        # Never detach an unrelated filesystem or hide a live mount with lazy/forced unmount.
        require(observed["fstype"] == "tmpfs" and observed["source"] == "tmpfs",
                "capture_memory_cleanup_filesystem")
        require(target.stat().st_uid == os.getuid(), "capture_memory_cleanup_owner")
        command(["sudo", "-n", "umount", "--", str(target)])
    require(mount_for(target) is None, "capture_memory_cleanup_mount_remaining")
    if target.exists():
        target.rmdir()
    require(not target.exists(), "capture_memory_cleanup_path_remaining")
    return dict(operation="capture-memory-cleanup", memoryMountRemoved=True,
                ownedMountpointRemoved=True, plaintextMemoryCleanupConfirmed=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["prepare", "verify", "cleanup"])
    args = parser.parse_args()
    try:
        result = {"prepare": prepare, "verify": verify, "cleanup": cleanup}[args.operation](os.environ)
    except (Rejected, OSError, ValueError) as error:
        reason = str(error) if isinstance(error, Rejected) else "capture_memory_filesystem_failed"
        print(json.dumps(dict(operation="capture-memory", qualified=False, reason=reason)))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
