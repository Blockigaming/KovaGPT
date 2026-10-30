#!/usr/bin/env python3
"""File-bound launcher for an already qualified isolated restore client.

This launcher does not qualify a target, create an attestation, select a network,
fetch a backup or approve a restore. It preserves the existing recovery engine's
original guards and loads the protected phrase only from an owned private file.
Run it inside the independently qualified operator image, never on its host.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat

ENGINE = Path(__file__).with_name("managed-auth-recovery.py")
LOADED_ENGINE = None
SHA = re.compile(r"[a-f0-9]{64}\Z")
BINDINGS = frozenset({
    "KOVA_AUTH_RECOVERY_CONFIRMATION", "KOVA_AUTH_RESTORE_BASELINE_MODE",
    "KOVA_AUTH_BACKUP_ENCRYPTED_SHA256", "KOVA_APPROVED_BACKUP_SOURCE_SHA",
    "APPROVED_ISOLATED_PG17_DATABASE_URL", "APPROVED_ISOLATED_HOST",
    "APPROVED_ISOLATED_DBNAME", "APPROVED_ISOLATED_PORT", "APPROVED_ISOLATED_SERVER_IP",
    "APPROVED_ISOLATED_SYSTEM_IDENTIFIER", "PGPASSFILE",
    "KOVA_AUTH_RESTORE_ATTESTATION", "KOVA_AUTH_RESTORE_ATTESTATION_SHA256",
})
LOCAL_RUNTIME = frozenset({"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"})


class Stopped(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stopped(code)


def load_engine(engine_sha256):
    global LOADED_ENGINE
    raw = ENGINE.read_bytes()
    require(SHA.fullmatch(engine_sha256) and hashlib.sha256(raw).hexdigest() == engine_sha256,
            "private_client_engine_pin")
    # Execute the exact bytes already hashed, not a later path read by a loader.
    spec = importlib.util.spec_from_file_location("kova_isolated_recovery_engine", ENGINE)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(ENGINE), "exec"), module.__dict__)
    LOADED_ENGINE = module
    return module


def public_failure(exc):
    if LOADED_ENGINE is not None and isinstance(exc, LOADED_ENGINE.Stopped):
        return LOADED_ENGINE.public_failure(exc)
    return {"ok":False,"error":"managed_auth_recovery_client_unqualified",
            "stage":"private-client-input","code":"client_input_or_runtime_unqualified"}


def private_bytes(path, limit):
    p = Path(path)
    info = p.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and not info.st_mode & 0o077 and info.st_size <= limit, "private_client_input_required")
    # The root filesystem/input mount must already be immutable by qualification.
    # Open NOFOLLOW and compare the descriptor to lstat to reject file swaps.
    descriptor = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        require((opened.st_dev, opened.st_ino, opened.st_mode, opened.st_size, opened.st_uid)
                == (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_uid),
                "private_client_input_changed")
        data = os.read(descriptor, limit+1)
        require(len(data) == info.st_size and len(data) <= limit, "private_client_input_changed")
        return data
    finally:
        os.close(descriptor)


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "private_client_duplicate_binding")
        result[key] = value
    return result


def read_bindings(path, runtime):
    value = json.loads(private_bytes(path, 64*1024), object_pairs_hook=no_duplicate_keys)
    require(isinstance(value, dict) and set(value) == BINDINGS
            and all(isinstance(v, str) and v and "\x00" not in v and "\n" not in v and "\r" not in v
                    for v in value.values()), "private_client_binding_shape")
    require(value["KOVA_AUTH_RECOVERY_CONFIRMATION"] == "RESTORE_EMPTY_ISOLATED"
            and value["KOVA_AUTH_RESTORE_BASELINE_MODE"] == "empty-database",
            "private_client_restore_mode")
    result = {k:v for k,v in runtime.items() if k in LOCAL_RUNTIME}
    result.update(value)
    return result


def launch(bindings, phrase_file, archive, output, engine_sha256, runtime):
    recovery = load_engine(engine_sha256)
    env = read_bindings(bindings, runtime)
    # An explicit independently reviewed, still-fresh bound attestation is needed
    # before this launcher even reads the protected phrase. The engine repeats
    # all identity/census/isolation checks before decrypt and at both DB writes.
    attestation = recovery.attest(env)
    recovery.restore_baseline_mode(env, attestation)
    phrase = private_bytes(phrase_file, 8192).decode("utf-8")
    require(len(phrase) >= 32 and "\n" not in phrase and "\r" not in phrase and "\x00" not in phrase,
            "backup_passphrase_missing")
    env["KOVA_PRODUCTION_BACKUP_PASSPHRASE"] = phrase
    recovery.mark_stage("restore")
    return recovery.restore(env, Path(archive), Path(output))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--bindings", required=True)
    parser.add_argument("--phrase-file", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--engine-sha256", required=True)
    args = parser.parse_args()
    require(args.execute, "explicit_execution_required")
    launch(args.bindings, args.phrase_file, args.archive, args.output, args.engine_sha256, os.environ)
    print('{"ok":true,"restoreReceiptWritten":true}')


if __name__ == "__main__":
    def interrupted(*_):
        raise Stopped("operator_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception as exc:
        print(json.dumps(public_failure(exc),sort_keys=True,separators=(",",":")))
        raise SystemExit(1)
