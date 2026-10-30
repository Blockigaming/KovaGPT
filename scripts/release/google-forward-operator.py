#!/usr/bin/env python3
"""Run only the reviewed Google forward migration using an existing protected connection."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "supabase/migrations/20261030132255_google_connection_lifecycle_forward.sql"
SOURCE_SHA256 = "4fde05fe365efabf0f5466640dc7ea07e8182864b4529dc7def2a71a4e82c3e2"
SYSTEM_SHA256 = "d165ac49d4d2aaa4733f7f220c351c99ff09493dace033a726f6fd722a573a15"
PROJECT = "mfbycmbjygcfkrsuepxf"
# Public CA used by Supabase Studio's Download certificate control, verified
# against Studio source ab448c11afd1ecc39190b6e0a972cc367e92a88e:
# https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
# DER SHA256:807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa.
# Trust only this pinned provider root for the already-restricted DB hosts.
CA = str(ROOT / "scripts/release/supabase-prod-ca-2021.crt")
CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
VERSION = "20261030132255"
SHA = re.compile(r"[0-9a-f]{40}\Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")


class Stopped(Exception):
    pass


def require(value, code):
    if not value:
        raise Stopped(code)


def approved_source():
    value = SOURCE.read_bytes()
    require(hashlib.sha256(value).hexdigest() == SOURCE_SHA256, "canonical_source_changed")
    return value.decode("utf-8")


def target_guard():
    return f"""current_database() = 'postgres' AND current_user = 'postgres'
      AND current_setting('server_version_num')::integer / 10000 = 17
      AND encode(sha256(convert_to((pg_control_system()).system_identifier::text,'UTF8')),'hex') = '{SYSTEM_SHA256}'"""


def build_sql():
    source = approved_source()
    tag = "$kova_approved_google_source$"
    require(tag not in source, "canonical_delimiter_collision")
    body_hash = hashlib.md5(source.encode()).hexdigest()
    return f"""BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
DO $install_google_repair$
DECLARE
  v_version constant text := '{VERSION}';
  v_name constant text := 'google_connection_lifecycle_forward';
  v_source constant text := {tag}{source}{tag};
  v_prior_history jsonb;
  v_after_history jsonb;
  v_existing record;
BEGIN
  IF NOT ({target_guard()}) THEN
    RAISE EXCEPTION 'google_operator_wrong_database';
  END IF;
  IF md5(v_source) <> '{body_hash}' THEN
    RAISE EXCEPTION 'google_operator_source_integrity_failed';
  END IF;
  IF NOT pg_try_advisory_xact_lock(7341021, 30132255) THEN
    RAISE EXCEPTION 'google_operator_another_repair_is_running';
  END IF;
  LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name = v_name AND version <> v_version) THEN
    RAISE EXCEPTION 'google_operator_migration_name_collision';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.version), '[]'::jsonb)
    INTO v_prior_history FROM supabase_migrations.schema_migrations h WHERE h.version <> v_version;
  SELECT name, statements INTO v_existing FROM supabase_migrations.schema_migrations
    WHERE version = v_version FOR UPDATE;
  IF FOUND THEN
    IF v_existing.name IS DISTINCT FROM v_name OR v_existing.statements IS DISTINCT FROM ARRAY[v_source] THEN
      RAISE EXCEPTION 'google_operator_migration_history_conflict';
    END IF;
    EXECUTE v_source;
  ELSE
    EXECUTE v_source;
    INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
      VALUES (v_version, v_name, ARRAY[v_source]);
  END IF;
  EXECUTE v_source;
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.version), '[]'::jsonb)
    INTO v_after_history FROM supabase_migrations.schema_migrations h WHERE h.version <> v_version;
  IF v_after_history IS DISTINCT FROM v_prior_history THEN
    RAISE EXCEPTION 'google_operator_existing_history_changed';
  END IF;
END
$install_google_repair$;
COMMIT;
SELECT json_build_object('status','google_schema_verified','migration_version','{VERSION}');
"""


def connection_environment(env):
    try:
        u = urlparse(env.get("KOVA_PRODUCTION_DATABASE_URL", ""))
        port = u.port or 5432
        user = unquote(u.username or "")
        password = unquote(u.password or "")
        query = parse_qs(u.query, keep_blank_values=True)
    except ValueError:
        raise Stopped("production_connection_rejected") from None
    direct = u.hostname == f"db.{PROJECT}.supabase.co" and user == "postgres"
    pooler = bool(re.fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com", u.hostname or "")) and user == f"postgres.{PROJECT}"
    require(u.scheme in {"postgres", "postgresql"} and (direct or pooler)
            and port == 5432 and u.path == "/postgres" and password and "\x00" not in password
            and not u.fragment and set(query) <= {"sslmode"}
            and all(len(v) == 1 for v in query.values())
            and query.get("sslmode", ["verify-full"])[0] in {"require", "verify-full"}, "production_connection_rejected")
    require(Path(CA).is_file(), "trusted_ca_bundle_missing")
    require(Path(CA).stat().st_size <= 16384 and
            hashlib.sha256(Path(CA).read_bytes()).hexdigest() == CA_SHA256,
            "trusted_ca_integrity_failed")
    child = {k: v for k, v in env.items() if k in {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"}}
    child.update(PGHOST=u.hostname, PGPORT="5432", PGDATABASE="postgres", PGUSER=user,
                 PGPASSWORD=password, PGSSLMODE="verify-full", PGSSLROOTCERT=CA,
                 PGCONNECT_TIMEOUT="5", PGAPPNAME="kova-approved-google-forward",
                 PGOPTIONS="-c TimeZone=UTC -c client_min_messages=error -c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000")
    return child


def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))


def safe_database_error(value):
    # Classify a finite set of diagnostics; never return provider text or URLs.
    lowered = value.lower()
    for marker, code in [
        (b"password authentication failed", "database_authentication_unconfirmed"),
        (b"certificate verify failed", "database_tls_unconfirmed"),
        (b"root certificate file", "database_tls_unconfirmed"),
        (b"could not translate host name", "database_network_unconfirmed"),
        (b"connection timed out", "database_network_unconfirmed"),
        (b"network is unreachable", "database_network_unconfirmed"),
    ]:
        if marker in lowered:
            return code
    return "database_execution_unconfirmed"


def bounded_run(argv, env, sql=None, timeout=10):
    # Keep provider diagnostics out of logs and artifacts, including error cases.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            result = subprocess.run(argv, env=env, input=sql.encode() if sql else None,
                                    stdout=out, stderr=err, timeout=timeout,
                                    preexec_fn=child_limits, check=False)
        except (subprocess.TimeoutExpired, OSError):
            raise Stopped("database_execution_unconfirmed") from None
        if result.returncode != 0:
            err.seek(0)
            raise Stopped(safe_database_error(err.read(65536)))
        out.seek(0)
        value = out.read(65537)
        require(len(value) <= 65536, "database_execution_unconfirmed")
        return value


def source_guard(env, source_sha, run=bounded_run):
    require(SHA.fullmatch(source_sha or "") is not None, "reviewed_source_required")
    require(env.get("GITHUB_REPOSITORY") == "Blockigaming/KovaGPT"
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_SHA") == source_sha, "protected_main_dispatch_required")
    clean = {k: v for k, v in env.items() if k in {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"}}
    head = run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], clean).decode().strip()
    require(head == source_sha, "checked_out_source_mismatch")


def window_guard(window_id, expires_at, now=None):
    now = time.time() if now is None else now
    require(UUID.fullmatch(window_id or "") is not None and isinstance(expires_at, int)
            and now < expires_at <= now + 1200, "current_exclusive_window_required")


def execute(mode, env, source_sha, confirmation, window_id="", expires_at=0, run=bounded_run, progress=None):
    require(mode in {"CHECK", "APPLY_GOOGLE_FORWARD"} and confirmation == mode, "exact_confirmation_required")
    approved_source()
    source_guard(env, source_sha, run)
    if mode == "APPLY_GOOGLE_FORWARD":
        window_guard(window_id, expires_at)
    child = connection_environment(env)
    require(re.match(rb"psql \(PostgreSQL\) 17\.", run(["psql", "--version"], child)) is not None, "pg17_client_required")
    argv = ["psql", "-X", "--no-password", "--quiet", "--tuples-only", "--no-align",
            "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=terse", "--set=SHOW_CONTEXT=never", "--file=-"]
    check_sql = f"BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SELECT json_build_object('target_verified',({target_guard()})); COMMIT;"
    try:
        checked = json.loads(run(argv, child, check_sql, 15))
    except (ValueError, UnicodeDecodeError):
        raise Stopped("target_verification_unconfirmed") from None
    require(isinstance(checked, dict) and set(checked) == {"target_verified"}
            and checked["target_verified"] is True, "production_identity_mismatch")
    if mode == "CHECK":
        return {"status": "target_verified", "write_attempted": False}
    window_guard(window_id, expires_at)
    if progress is not None:
        progress["write_attempted"] = True
    try:
        applied = json.loads(run(argv, child, build_sql(), 65))
    except (ValueError, UnicodeDecodeError):
        raise Stopped("database_execution_unconfirmed") from None
    require(applied == {"status": "google_schema_verified", "migration_version": VERSION}, "database_execution_unconfirmed")
    return {**applied, "write_attempted": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-sql", action="store_true")
    parser.add_argument("--mode", choices=["CHECK", "APPLY_GOOGLE_FORWARD"])
    parser.add_argument("--source-sha", default="")
    parser.add_argument("--confirmation", default="")
    parser.add_argument("--window-id", default="")
    parser.add_argument("--window-expires-at", type=int, default=0)
    parser.add_argument("--receipt")
    args = parser.parse_args()
    if args.print_sql:
        print(build_sql(), end="")
        return 0
    progress = {"status": "not_started", "write_attempted": False,
                "source_sha": args.source_sha if SHA.fullmatch(args.source_sha) else "",
                "canonical_sha256": SOURCE_SHA256,
                "window_id": args.window_id if UUID.fullmatch(args.window_id) else ""}
    receipt = Path(args.receipt or "")
    owns_receipt = False
    try:
        require(bool(args.receipt) and receipt.parent.resolve() == Path(os.environ.get("RUNNER_TEMP", "/nonexistent")).resolve(), "private_receipt_path_required")
        with receipt.open("x") as handle:
            os.chmod(receipt, 0o600)
            handle.write(json.dumps(progress) + "\n")
        owns_receipt = True
        progress.update(execute(args.mode, os.environ, args.source_sha, args.confirmation,
                                args.window_id, args.window_expires_at, progress=progress))
        code = 0
    except Exception as error:
        progress.update(status="unconfirmed" if progress["write_attempted"] else "stopped_before_write",
                        error= str(error) if isinstance(error, Stopped) else "operator_failed")
        code = 1
    if owns_receipt:
        receipt.write_text(json.dumps(progress, sort_keys=True) + "\n")
    print(json.dumps(progress, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
