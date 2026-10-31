#!/usr/bin/env python3
"""Private operator: run the frozen monthly harness against a disposable PG17.

Use from an actual nonroot POSIX account with native PG17 and repo dependencies.
No source database, production environment or customer credential is accepted.
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
import socket
import subprocess
import signal

EXPECTED = {
    "database-contract.json": "0a36a0ab88e167f5062712671bc2acf1202c7366de7d897b3732327339fef6ae",
    "release-migrations.json": "e77fb3ee835171ccc69ddcc26ef5d691305f97d4e5f3985a763454cca97ee32e",
    "scripts/release/monthly-intro-lifecycle-guards.mjs": "6b12d22e1b4321b59de5ba4307d564355e2350de23efd3b6c17184a5b0b8139d",
    "supabase/migrations/20261030141704_kova_monthly_intro_lifecycle_forward.sql": "04dbfd519ac70c5d643c9b06dd506fb767fa203163556b62c148262cd3cb391e",
    "tests/unit/monthly-intro-lifecycle-forward.test.mjs": "b1e562a2c39e8e2c0034e47e2e12989e14e3c9a6a5eff922e3b51c3f6cdebd1e",
    "supabase/migrations/20260904231213_billing_plan_tier_and_atomic_stripe_events.sql": "224240168c4f6752f691c8e50b4669b2caeac408094af6024a6eefc0ed7c6541",
    "supabase/migrations/20261029235133_kova_production_subscription_summary_read_only_forward.sql": "8856b46715d701be07cdccadfc833ef22659ee80ff71459f4f7ad53513af1cd4",
    "supabase/migrations/20260905030947_irreversible_account_deletion.sql": "f29466776b99a5c8661de1b8a7ac1d82c11afe2ff4feaa9dc1033d74cf161e29"
}


def clean_disposable_cluster(root, data, binaries, environment, created):
    if not created:
        return not root.exists()
    if root.parent != Path("/tmp") or not re.fullmatch(r"kova-monthly-native-pg17-[a-f0-9]{24}", root.name):
        return False
    try:
        (root / "pwfile").unlink(missing_ok=True)
        # Check even if pg_ctl start failed or timed out after launching postgres.
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--pg17-bin", required=True, type=Path)
    parser.add_argument("--evidence-directory", required=True, type=Path)
    options = parser.parse_args()
    if os.geteuid() == 0:
        raise SystemExit("REFUSED: actual nonroot OS account required; no UID simulation permitted")
    repository = options.repository.resolve(strict=True)
    binaries = options.pg17_bin.resolve(strict=True)
    evidence = options.evidence_directory.resolve()
    evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, expected in EXPECTED.items():
        if hashlib.sha256((repository / name).read_bytes()).hexdigest() != expected:
            raise SystemExit("REFUSED: frozen reviewed source hash differs: " + name)
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "LC_ALL", "LD_LIBRARY_PATH") if key in os.environ}
    environment["PATH"] = str(binaries) + os.pathsep + environment.get("PATH", "/usr/bin:/bin")
    environment["LC_ALL"] = "C"
    environment["LANG"] = "C"
    versions = {}
    for executable in ("psql", "postgres", "initdb", "pg_ctl", "pg_controldata"):
        version = subprocess.check_output([str(binaries / executable), "--version"], env=environment, text=True, timeout=5)
        if not re.search(r"\b17\.\d+\b", version):
            raise SystemExit("REFUSED: native PostgreSQL17 required: " + executable)
        versions[executable] = version.strip()
    root = Path("/tmp/kova-monthly-native-pg17-" + secrets.token_hex(12))
    data = root / "data"
    password = secrets.token_hex(24)
    password_file = root / "pwfile"
    created = False
    receipt = {"operation": "disposable-monthly-native-pg17", "approvedBaseCommit": "cf76d308c9528bcaa516d04083021415d02206cc", "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True, timeout=5).strip(), "checkedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sourceHashes": EXPECTED, "nativeVersions": versions, "productionConnected": False, "customerRowsUsed": False, "nativeQualified": False}
    def cancelled(signum, frame):
        raise KeyboardInterrupt("native_operator_cancelled")
    signal.signal(signal.SIGTERM, cancelled)
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
        # Independently pin the on-disk control identity before starting the server.
        control = subprocess.check_output([str(binaries / "pg_controldata"), str(data)], env=environment, text=True, timeout=5)
        system_id = re.search(r"^Database system identifier:\s+(\d{10,24})$", control, re.MULTILINE)
        if not system_id:
            raise RuntimeError("independent_control_identity_absent")
        receipt["systemIdentifier"] = system_id.group(1)
        receipt["dataDirectory"] = str(data)
        subprocess.run([str(binaries / "pg_ctl"), "-D", str(data), "-l", str(root / "server.log"), "-w", "-t", "20", "start"], env=environment, check=True, stdout=subprocess.DEVNULL, timeout=25)
        connection = {**environment, "PGHOST": "127.0.0.1", "PGPORT": str(port), "PGDATABASE": "postgres", "PGUSER": "postgres", "PGPASSWORD": password, "PGCONNECT_TIMEOUT": "5"}
        subprocess.run([str(binaries / "psql"), "-X", "--no-password", "--set=ON_ERROR_STOP=1", "-c", "create role anon;create role authenticated;create role service_role bypassrls;"], env=connection, check=True, stdout=subprocess.DEVNULL, timeout=10)
        native = {**environment, "KOVA_MONTHLY_NATIVE_ENABLE": "disposable-loopback-pg17", "KOVA_MONTHLY_NATIVE_PG17_URL": "postgresql://postgres:" + password + "@127.0.0.1:" + str(port) + "/postgres", "KOVA_MONTHLY_NATIVE_PG17_SYSTEM_ID": system_id.group(1)}
        with (evidence / "native-tap.log").open("w") as log:
            result = subprocess.run(["node", "--test", "--test-reporter=tap", "--test-name-pattern=^native", "tests/unit/monthly-intro-lifecycle-forward.test.mjs"], cwd=repository, env=native, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        text = (evidence / "native-tap.log").read_text()
        if password in text:
            (evidence / "native-tap.log").write_text(text.replace(password, "[REDACTED]"))
            raise RuntimeError("unexpected_credential_in_test_output")
        verified = text.count("NATIVE CONTENTION VERIFIED:")
        canonical_verified = text.count("NATIVE CANONICAL BILLING VERIFIED:")
        receipt.update({"exitCode": result.returncode, "contentionCasesVerified": verified, "canonicalBillingCasesVerified": canonical_verified, "nativeQualified": result.returncode == 0 and verified == 3 and canonical_verified == 1})
        if not receipt["nativeQualified"]:
            raise RuntimeError("native_monthly_contention_not_qualified")
    finally:
        receipt["cleanupConfirmed"] = clean_disposable_cluster(root, data, binaries, environment, created)
        receipt["nativeQualified"] = receipt["nativeQualified"] and receipt["cleanupConfirmed"]
        (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if not receipt["nativeQualified"]:
        raise RuntimeError("native_monthly_contention_or_cleanup_not_qualified")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
