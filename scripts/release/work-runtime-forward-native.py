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

EXPECTED = {'supabase/migrations/20261030163511_kova_work_runtime_forward.sql': '0857354f16914d32aa4c46a5841ef2ea9adfcfc858e634ca36473cfceab610db', 'scripts/release/work-runtime-forward-guards.mjs': 'b4d085782ae2b96124dcf05cffc83706636a87754a2dc36a7e0ce2be501fafd2', 'tests/fixtures/work-runtime-prerequisite-catalog-20261030.json': '13b8daf520686eccaa909a818ae9c3483b84d0edbc7afeae9e16703858dfe23a', 'tests/fixtures/work-runtime-forward-native-smoke-20261030.sql': '92fba32dd7aed4305c207ca9898c14abd0a43a25c258b10234f8dc54619e51c2', 'supabase/migrations/20260903213000_work_cross_device_sync.sql': '87209bc11cac44d6efc7f51f04886ae5ba44093fbc862a4fd0edef43850b810b', 'supabase/migrations/20260903214500_work_sync_protection_hardening.sql': '49beb15d9fc16cd72593bdf16b338a496fb3431bc8fa9539b4a6ff92d40e123b', 'supabase/migrations/20260904235937_work_session_sync.sql': '70b4564e0645906026f4cca32ffa29c2978a6a75667c6bf4f3a7899a43937418', 'supabase/migrations/20260905002615_unified_work_execution_protocol.sql': '39b33292df7317a15b7973c9196d218980b5b2e686211bfc992285318dea444d', 'supabase/migrations/20260905005310_work_accounting_reconciliation.sql': 'eddd3caa63401723a24f9f1b99ddc9f20eae88729f5f09b7091bfd97fc059ed1', 'supabase/migrations/20260905034000_work_browser_takeover.sql': 'ba24b2113aabdeb77b65dfb01236105f394c381299490e9aee9216fbb5fff6c1', 'supabase/migrations/20260910143000_work_specialist_state_transitions.sql': '75f9f68c264620470a8c32075a1b0eef6bdc342f6fb4b6ce9010ee12de2f8d66', 'supabase/migrations/20260913022249_stabilize_work_browser_session_timestamps.sql': '01a3f198633dd26ca38ee17ad70aa7c1a661059e1478686bfb18be06d278fb0f', 'supabase/migrations/20260905031000_library_content_versions.sql': '1ef0c7375c618516934bd1b8eb7ca0ff01ce11ba390ed909f39e060b012be025'}
SQL = "tests/fixtures/work-runtime-forward-native-smoke-20261030.sql"
MIGRATION = "supabase/migrations/20261030163511_kova_work_runtime_forward.sql"
MARKERS = (
    "WORK_FORWARD_NATIVE_PREFLIGHT_PASS",
    "WORK_FORWARD_NATIVE_ABSENT_BASELINE_INSTALL_PASS",
    "WORK_FORWARD_NATIVE_OWNED_REVOCATION_PASS",
    "WORK_FORWARD_NATIVE_VERSION_PROFILE_PASS",
)
CANONICAL_MARKERS = (
    "WORK_FORWARD_NATIVE_CANONICAL_DEFAULTLESS_NOOP_PASS",
    "WORK_FORWARD_NATIVE_CANONICAL_SUPABASE_DEFAULTS_NOOP_PASS",
    "WORK_FORWARD_NATIVE_CANONICAL_CLI_REVOKE_CRUD_NOOP_PASS",
    "WORK_FORWARD_NATIVE_CANONICAL_LIBRARY_COLUMNS_DEFAULTLESS_NOOP_PASS",
    "WORK_FORWARD_NATIVE_CANONICAL_LIBRARY_COLUMNS_SUPABASE_DEFAULTS_NOOP_PASS",
    "WORK_FORWARD_NATIVE_CANONICAL_LIBRARY_COLUMNS_CLI_REVOKE_CRUD_NOOP_PASS",
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


def canonical_smoke_sources(repository, smoke):
    """Exact historical-source no-op cases, each for a separate new synthetic DB."""
    prefix = smoke[:smoke.index("begin read only;")]
    catalog = json.loads((repository / "tests/fixtures/work-runtime-prerequisite-catalog-20261030.json").read_text())
    entries = catalog["canonicalSources"]
    if len(entries) != 8 or len({entry["path"] for entry in entries}) != 8:
        raise RuntimeError("work_native_canonical_sources_changed")
    for entry in entries:
        if EXPECTED.get(entry["path"]) != entry["sha256"]:
            raise RuntimeError("work_native_canonical_source_pins_missing")
    historical = "\n".join((repository / entry["path"]).read_text() for entry in entries)
    tables = ["work_sync_counters", "work_saved_records", "work_recent_items", "work_sync_mutations", "work_execution_runs", "work_execution_events", "work_execution_receipts", "work_execution_outputs", "work_accounting_settlements", "work_browser_sessions"]
    policies = "\n".join("create policy kova_owned_session_guard on public." + name + " as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()));" for name in tables)
    migration = (repository / MIGRATION).read_text()
    cases = {}
    library_source = (repository / "supabase/migrations/20260905031000_library_content_versions.sql").read_text()
    library_grants = "REVOKE UPDATE ON public.user_library_items FROM authenticated;\nGRANT UPDATE(title,folder_id,updated_at) ON public.user_library_items TO authenticated;"
    if library_source.count(library_grants) != 1:
        raise RuntimeError("work_native_canonical_library_source_changed")
    install_guard = migration[migration.index("do $work_forward_install$"):migration.rindex("\ncommit;")]
    negative_changes = [
        "revoke update(title) on public.user_library_items from authenticated",
        "grant select(title) on public.user_library_items to authenticated",
        "grant update(title) on public.user_library_items to authenticated with grant option",
        "grant update(title) on public.user_library_items to anon",
        "grant update(totals) on public.work_accounting_settlements to service_role",
        "grant update on public.user_library_items to authenticated",
        "alter table public.user_library_items disable row level security",
        "alter table public.user_library_items force row level security",
        "alter table public.user_library_items owner to service_role",
    ]
    negative_checks = "create function pg_temp.native_expect_column_acl_drift(p_change text) returns void language plpgsql as $native_check$ begin begin execute p_change;execute $native_replay$" + install_guard + "$native_replay$;raise exception 'native_work_column_acl_rejection_missing';exception when raise_exception then if sqlerrm<>'work_forward_column_acl_drift' then raise;end if;end;end $native_check$;\n" + "\n".join("select pg_temp.native_expect_column_acl_drift('" + change.replace("'", "''") + "');" for change in negative_changes)
    catalog_changes = [
        "grant update on public.work_execution_outputs to service_role",
        "grant delete on public.work_accounting_settlements to service_role",
        "revoke maintain on public.work_execution_runs from service_role",
        "revoke select on public.work_execution_outputs from service_role",
        "grant select on public.work_execution_runs to anon",
        "grant insert on public.work_execution_runs to authenticated",
        "comment on table public.work_execution_runs is 'unexpected catalog drift'",
        "create function public.next_work_sync_version(uuid,text) returns bigint language sql as $$select 1::bigint$$",
    ]
    catalog_checks = "create function pg_temp.native_expect_catalog_drift(p_change text) returns void language plpgsql as $native_check$ begin begin execute p_change;execute $native_replay$" + install_guard + "$native_replay$;raise exception 'native_work_catalog_rejection_missing';exception when raise_exception then if sqlerrm<>'work_forward_existing_object' then raise;end if;end;end $native_check$;\n" + "\n".join("select pg_temp.native_expect_catalog_drift('" + change.replace("'", "''") + "');" for change in catalog_changes)
    for index, marker in enumerate(CANONICAL_MARKERS):
        profile = index % 3
        defaults = "alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;" if profile else ""
        if profile == 2:
            # Exact public-table operation in Supabase CLI 2.111.0 ApplyApiPrivileges.
            # It subtracts CRUD from existing ALL defaults; it does not revoke
            # service-role TRUNCATE, REFERENCES, TRIGGER or PostgreSQL17 MAINTAIN.
            defaults += "alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;"
        cases[marker] = prefix + "\n" + defaults + "\n" + historical + "\n" + (library_grants if index >= 3 else "") + "\n" + policies + "\ninsert into public.work_sync_counters(owner_id) values('11111111-1111-4111-8111-111111111111');\nset default_transaction_read_only=on;\n" + migration + "\nbegin;reset default_transaction_read_only;commit;\n" + (negative_checks if index >= 3 else "") + "\n" + (catalog_checks if profile == 2 else "") + "\ndo $native_preserved$ begin if (select count(*) from public.work_sync_counters)<>1 then raise exception 'native_work_canonical_row_changed';end if;end $native_preserved$;\nselect '" + marker + "' as evidence;\n"
    return cases


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
        receipt.update({"database": database, "exitCode": result.returncode, "verifiedChecks": verified, "canonicalReplays": []})
        if result.returncode != 0 or len(verified) != len(MARKERS):
            raise RuntimeError("work_native_replay_or_session_guard_failed")
        for marker, sql in canonical_smoke_sources(repository, smoke).items():
            target = "kova_work_native_" + secrets.token_hex(10)
            subprocess.run(cli, env=connection, input="create database " + target + " template template0;", text=True, check=True, stdout=subprocess.DEVNULL, timeout=15)
            replay = subprocess.run(cli, env={**connection, "PGDATABASE": target}, input=sql, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            output = replay.stdout + replay.stderr
            if password in output:
                raise RuntimeError("work_native_unexpected_credential_in_output")
            with (evidence / "native-work.log").open("a") as log:
                log.write("\n-- " + marker + " --\n" + output)
            passed = replay.returncode == 0 and sum(line.strip() == marker for line in replay.stdout.splitlines()) == 1
            library_case = "LIBRARY_COLUMNS" in marker
            cli_case = "CLI_REVOKE_CRUD" in marker
            receipt["canonicalReplays"].append({"database": target, "marker": marker, "exitCode": replay.returncode, "readOnlyNoopAndRowsPreserved": passed, "canonicalLibraryColumnAclProfileVerified": passed and library_case, "columnAclNegativeCasesVerified": 9 if passed and library_case else 0, "canonicalCliRevokeCrudProfileVerified": passed and cli_case, "catalogNegativeCasesVerified": 8 if passed and cli_case else 0})
            if not passed:
                raise RuntimeError("work_native_canonical_noop_failed")
            receipt["verifiedChecks"].append(marker)
        receipt["nativeQualified"] = len(receipt["verifiedChecks"]) == len(MARKERS) + len(CANONICAL_MARKERS)
    finally:
        receipt["cleanupConfirmed"] = clean_cluster(root, data, binaries, environment, created)
        receipt["nativeQualified"] = receipt["nativeQualified"] and receipt["cleanupConfirmed"]
        (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if not receipt["nativeQualified"]:
        raise RuntimeError("work_native_cleanup_unconfirmed")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
