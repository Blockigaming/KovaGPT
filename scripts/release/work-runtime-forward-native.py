#!/usr/bin/env python3
"""Credential-free native Work replay in a new, pinned, nonroot loopback PG17 cluster.

Never accepts a database URL, existing cluster, source credentials, customer rows
or ambient PG variables. Each invocation owns its new cluster and synthetic DB.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess

EXPECTED = {'supabase/migrations/20261030163511_kova_work_runtime_forward.sql': '50935857c4564c7b695df43cb3ed8c68fcebc560bc0dcb40177486002dc4b5fa', 'scripts/release/work-runtime-forward-guards.mjs': 'a845dae5bfe0d725a6b3ac5ec16be7c2aecba54fa98260af6fc02bc107dec8cf', 'tests/fixtures/work-runtime-prerequisite-catalog-20261030.json': '13b8daf520686eccaa909a818ae9c3483b84d0edbc7afeae9e16703858dfe23a', 'tests/fixtures/work-runtime-forward-native-smoke-20261030.sql': '694d9c9fb7201ea7f29b7391f62e27eecd2929dad5a05e31ef97004909c10c3a'}
SQL = "tests/fixtures/work-runtime-forward-native-smoke-20261030.sql"
MIGRATION = "supabase/migrations/20261030163511_kova_work_runtime_forward.sql"
MARKERS = (
    "WORK_FORWARD_NATIVE_PREFLIGHT_PASS",
    "WORK_FORWARD_NATIVE_ABSENT_BASELINE_INSTALL_PASS",
    "WORK_FORWARD_NATIVE_OWNED_REVOCATION_PASS",
)


def validate_sources(repository):
    if not EXPECTED or SQL not in EXPECTED or MIGRATION not in EXPECTED:
        raise RuntimeError("work_native_source_pins_missing")
    for name, expected in EXPECTED.items():
        path = repository / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("work_native_source_shape_changed")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError("work_native_source_hash_changed")
    smoke = (repository / SQL).read_text()
    migration = (repository / MIGRATION).read_text()
    if smoke.count(migration) != 1 or any(smoke.count(marker) != 1 for marker in MARKERS):
        raise RuntimeError("work_native_exact_payload_or_markers_changed")
    return smoke


def clean_cluster(root, data, binaries, environment, created):
    if not created:
        return not root.exists()
    if root.parent != Path("/tmp") or not re.fullmatch(r"kova-work-native-pg17-[a-f0-9]{24}", root.name):
        return False
    try:
        (root / "pwfile").unlink(missing_ok=True)
        if (data / "PG_VERSION").exists():
            status = subprocess.run([str(binaries / "pg_ctl"), "-D", str(data), "status"], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            if status.returncode == 0:
                stopped = subprocess.run([str(binaries / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "-t", "10", "stop"], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
                if stopped.returncode != 0:
                    return False
            elif status.returncode != 3:
                return False
        shutil.rmtree(root)
        return not root.exists()
    except (OSError, subprocess.SubprocessError):
        return False


def require_identity(value, data, system_id):
    expected = {"address": "127.0.0.1", "database": "postgres", "user": "postgres", "dataDirectory": str(data), "systemIdentifier": system_id}
    if any(value.get(key) != item for key, item in expected.items()):
        raise RuntimeError("work_native_independent_identity_mismatch")
    if not 170000 <= int(value.get("serverVersion", 0)) < 180000:
        raise RuntimeError("work_native_server_not_pg17")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--pg17-bin", required=True, type=Path)
    parser.add_argument("--evidence-directory", required=True, type=Path)
    options = parser.parse_args()
    if os.geteuid() == 0:
        raise SystemExit("REFUSED: actual nonroot OS account required")
    repository = options.repository.resolve(strict=True)
    binaries = options.pg17_bin.resolve(strict=True)
    smoke = validate_sources(repository)
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "LC_ALL", "LD_LIBRARY_PATH") if key in os.environ}
    environment.update({"PATH": str(binaries) + os.pathsep + environment.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C", "LANG": "C"})
    versions = {}
    for executable in ("psql", "postgres", "initdb", "pg_ctl", "pg_controldata"):
        version = subprocess.check_output([str(binaries / executable), "--version"], env=environment, text=True, timeout=5)
        if not re.search(r"\b17\.\d+\b", version):
            raise RuntimeError("work_native_tool_not_pg17")
        versions[executable] = version.strip()
    evidence = options.evidence_directory.resolve()
    evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
    root = Path("/tmp/kova-work-native-pg17-" + secrets.token_hex(12))
    data = root / "data"
    password = secrets.token_hex(24)
    password_file = root / "pwfile"
    created = False
    receipt = {"operation": "synthetic-work-forward-native-pg17", "checkedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True, timeout=5).strip(), "sourceHashes": EXPECTED, "nativeVersions": versions, "nativeQualified": False, "productionConnected": False, "customerRowsUsed": False}
    signal.signal(signal.SIGTERM, lambda signum, frame: (_ for _ in ()).throw(KeyboardInterrupt("work_native_cancelled")))
    try:
        root.mkdir(mode=0o700)
        created = True
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        password_file.write_text(password + "\n")
        password_file.chmod(0o600)
        subprocess.run([str(binaries / "initdb"), "-D", str(data), "-U", "postgres", "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile=" + str(password_file), "--no-instructions", "--locale=C", "--encoding=UTF8"], env=environment, check=True, stdout=subprocess.DEVNULL, timeout=30)
        password_file.unlink()
        with (data / "postgresql.conf").open("a") as settings:
            settings.write("\nlisten_addresses='127.0.0.1'\nport=" + str(port) + "\nunix_socket_directories='" + str(root) + "'\n")
        control = subprocess.check_output([str(binaries / "pg_controldata"), str(data)], env=environment, text=True, timeout=5)
        match = re.search(r"^Database system identifier:\s+(\d{10,24})$", control, re.MULTILINE)
        if not match:
            raise RuntimeError("work_native_on_disk_identity_absent")
        system_id = match.group(1)
        receipt["systemIdentifier"] = system_id
        subprocess.run([str(binaries / "pg_ctl"), "-D", str(data), "-l", str(root / "server.log"), "-w", "-t", "20", "start"], env=environment, check=True, stdout=subprocess.DEVNULL, timeout=25)
        connection = {**environment, "PGHOST": "127.0.0.1", "PGPORT": str(port), "PGDATABASE": "postgres", "PGUSER": "postgres", "PGPASSWORD": password, "PGCONNECT_TIMEOUT": "5"}
        cli = [str(binaries / "psql"), "-X", "--no-password", "--set=ON_ERROR_STOP=1"]
        identity_query = "select json_build_object('address',host(inet_server_addr()),'database',current_database(),'user',current_user,'dataDirectory',current_setting('data_directory'),'systemIdentifier',system_identifier::text,'serverVersion',current_setting('server_version_num')::integer) from pg_control_system()"
        identity = json.loads(subprocess.check_output([*cli, "--tuples-only", "--no-align", "-c", identity_query], env=connection, text=True, timeout=10))
        require_identity(identity, data, system_id)
        database = "kova_work_native_" + secrets.token_hex(10)
        subprocess.run(cli, env=connection, input="create role anon;create role authenticated;create role service_role bypassrls;create database " + database + " template template0;", text=True, check=True, stdout=subprocess.DEVNULL, timeout=15)
        # The URI/password is never in argv. The only selected DB is this new one.
        result = subprocess.run(cli, env={**connection, "PGDATABASE": database}, input=smoke, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        output = result.stdout + result.stderr
        if password in output:
            output = output.replace(password, "[REDACTED]")
            raise RuntimeError("work_native_unexpected_credential_in_output")
        (evidence / "native-work.log").write_text(output)
        verified = [marker for marker in MARKERS if sum(line.strip() == marker for line in result.stdout.splitlines()) == 1]
        receipt.update({"database": database, "exitCode": result.returncode, "verifiedChecks": verified, "nativeQualified": result.returncode == 0 and len(verified) == len(MARKERS)})
        if not receipt["nativeQualified"]:
            raise RuntimeError("work_native_replay_or_session_guard_failed")
    finally:
        receipt["cleanupConfirmed"] = clean_cluster(root, data, binaries, environment, created)
        receipt["nativeQualified"] = receipt["nativeQualified"] and receipt["cleanupConfirmed"]
        (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if not receipt["nativeQualified"]:
        raise RuntimeError("work_native_cleanup_unconfirmed")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
