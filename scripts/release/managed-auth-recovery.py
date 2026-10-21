#!/usr/bin/env python3
"""Private production capture and baseline-aware isolated restore.

No production writes. No plaintext output artifacts or raw child diagnostics.
An export/restore success is database recovery evidence, not provider login,
Storage-object recovery, key custody, migration approval or application acceptance.
"""
import argparse
from functools import wraps
import resource
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
from datetime import datetime, timezone
import stat
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import parse_qs, unquote, urlparse

PROJECT = "mfbycmbjygcfkrsuepxf"
BUILD = "17.6.1.155"
IMAGE_TAG = "public.ecr.aws/supabase/postgres:17.6.1.155"
SHA = re.compile(r"[a-f0-9]{64}\Z")
IDENT = re.compile(r"[a-z_][a-z0-9_]*\Z")
MANAGED_SCHEMAS = {"auth", "storage", "realtime"}
BASELINE_SERVICE_TABLES = {("auth", "schema_migrations"), ("storage", "migrations"), ("realtime", "schema_migrations")}
MEMBERS = {"full.dump", "schema.sql", "managed-schema.sql", "catalog.json", "rows.json", "toc.list", "manifest.json"}
TIMEOUT = 900
OPERATION_SECONDS = 1500
DEADLINE = None
STDOUT_BYTES = 128 * 1024**2
MAX_BYTES = 4 * 1024**3
CANONICAL_PG = "-c TimeZone=UTC -c DateStyle=ISO,YMD -c bytea_output=hex -c extra_float_digits=3"
GUARD = Path(__file__).with_name("managed-auth-recovery-target.mjs")


class Stopped(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stopped(code)


def digest(data):
    check_deadline()
    result = hashlib.sha256(data).hexdigest()
    check_deadline()
    return result


def file_digest(path):
    check_deadline()
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        while chunk := f.read(1024**2):
            check_deadline()
            h.update(chunk)
    check_deadline()
    return h.hexdigest()


def private_file(path):
    p = Path(path)
    s = p.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and not s.st_mode & 0o077, "private_file_required")
    return p


def fresh_file(path, data):
    check_deadline()
    p = Path(path)
    with p.open("xb") as f:
        os.chmod(p, 0o600)
        f.write(data)
    check_deadline()


def encoded(value):
    check_deadline()
    result = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    check_deadline()
    return result


def bounded_operation(fn):
    @wraps(fn)
    def bounded(*args, **kwargs):
        global DEADLINE
        previous = DEADLINE
        DEADLINE = time.monotonic() + OPERATION_SECONDS
        try:
            return fn(*args, **kwargs)
        finally:
            DEADLINE = previous
    return bounded


def remaining(timeout):
    if DEADLINE is not None:
        timeout = min(timeout, DEADLINE-time.monotonic())
    require(timeout > 0, "operation_deadline_exceeded")
    return timeout



def check_deadline():
    # Cooperative checks surround bounded local work. A private operator must
    # also provide a hard outer timeout; this is not a preemptive OS timer.
    remaining(OPERATION_SECONDS)


def budgeted(items):
    for item in items:
        check_deadline()
        yield item
    check_deadline()


class DeadlineReader:
    def __init__(self, raw):
        self.raw = raw

    def read(self, size=-1):
        check_deadline()
        data = self.raw.read(size)
        check_deadline()
        return data


def write_success_receipt(path, receipt):
    check_deadline()
    require(not path.exists(), "output_exists")
    data = encoded(receipt)
    try:
        check_deadline()
        fresh_file(path, data)
        check_deadline()
    except Exception:
        if path.is_file():
            path.unlink()
        raise


def child_limits():
    # Kernel-enforced per-file bound applies before pg_dump/GPG can fill disk.
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))


def run(argv, env, *, data=None, output=None, timeout=TIMEOUT):
    # Stdout is file-backed and bounded before being read into memory. All
    # private files written by the child also have a kernel-enforced size cap.
    try:
        with tempfile.TemporaryFile() as captured:
            result = subprocess.run(argv, env=env, input=data, stdout=captured if output is None else output,
                                    stderr=subprocess.DEVNULL, timeout=remaining(timeout), check=False,
                                    preexec_fn=child_limits)
            check_deadline()
            require(result.returncode == 0, "private_command_unconfirmed")
            if output is not None:
                return None
            require(captured.tell() <= STDOUT_BYTES, "private_output_bound_exceeded")
            captured.seek(0)
            data_out = captured.read(STDOUT_BYTES+1)
            check_deadline()
            return data_out
    except (OSError, subprocess.SubprocessError):
        raise Stopped("private_command_unconfirmed") from None


def clean_pg_env(env):
    # No inherited service files/options can override a validated destination.
    out = {k: v for k, v in env.items() if k in {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SYSTEMROOT"}}
    out.update(PGCONNECT_TIMEOUT="5", PGAPPNAME="kova-private-auth-recovery")
    return out


def source_environment(env):
    raw = env.get("KOVA_PRODUCTION_DATABASE_URL", "")
    try:
        u = urlparse(raw)
        port = u.port or 5432
    except ValueError:
        raise Stopped("production_connection_rejected") from None
    user = unquote(u.username or "")
    direct = u.hostname == f"db.{PROJECT}.supabase.co" and user == "postgres"
    pooler = (u.hostname or "").endswith(".pooler.supabase.com") and user == f"postgres.{PROJECT}"
    params = parse_qs(u.query, keep_blank_values=True)
    require(u.scheme in {"postgres", "postgresql"} and (direct or pooler) and port == 5432
            and u.path == "/postgres" and u.password and not u.fragment
            and set(params) <= {"sslmode"} and all(len(v) == 1 for v in params.values())
            and params.get("sslmode", ["verify-full"])[0] == "verify-full", "production_connection_rejected")
    ca = Path(env.get("KOVA_RECOVERY_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt"))
    require(ca.is_file(), "trusted_ca_bundle_required")
    child = clean_pg_env(env)
    child.update(PGHOST=u.hostname, PGPORT=str(port), PGDATABASE="postgres", PGUSER=user,
                 PGPASSWORD=unquote(u.password), PGSSLMODE="verify-full", PGSSLROOTCERT=str(ca),
                 PGOPTIONS=CANONICAL_PG + " -c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=1600000")
    return child


def client_check(env):
    for name in ["psql", "pg_dump", "pg_restore"]:
        require(re.match(rb"(?:psql|pg_dump|pg_restore) \(PostgreSQL\) 17\.", run([name, "--version"], env, timeout=5)), "pg17_client_required")


def psql(env, sql, *, output=None):
    return run(["psql", "-X", "--no-password", "--quiet", "--tuples-only", "--no-align",
                "--set", "ON_ERROR_STOP=1", "--file", "-"], env, data=sql.encode(), output=output)


class Snapshot:
    def __init__(self, env):
        self.env = env
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(["psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                        env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, preexec_fn=child_limits)
        self.buffer = b""
        try:
            row = self.query("SELECT jsonb_build_object('snapshot',pg_export_snapshot(),'database',current_database(),'version',current_setting('server_version'),'versionNum',current_setting('server_version_num')::int);", begin=True)
            require(row["database"] == "postgres" and row["versionNum"] == 170006, "source_version_mismatch")
            self.id = row["snapshot"]
            require(re.fullmatch(r"[a-fA-F0-9]+-[a-fA-F0-9]+-\d+", self.id), "snapshot_rejected")
            self.version = row["version"]
            return self
        except Exception:
            self.__exit__()
            raise

    def query(self, sql, begin=False):
        check_deadline()
        require(self.process and self.process.poll() is None, "snapshot_lost")
        # Fixed JSON-producing read queries. No user-supplied SQL enters this API.
        self.process.stdin.write((("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n" if begin else "") + sql + "\n").encode())
        self.process.stdin.flush()
        deadline = time.monotonic() + remaining(125)
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while b"\n" not in self.buffer:
                wait_seconds = deadline-time.monotonic()
                require(wait_seconds > 0 and selector.select(wait_seconds), "snapshot_deadline_exceeded")
                check_deadline()
                chunk = os.read(self.process.stdout.fileno(), 65536)
                require(chunk, "snapshot_lost")
                self.buffer += chunk
                require(len(self.buffer) <= 32*1024**2, "snapshot_response_invalid")
        line, self.buffer = self.buffer.split(b"\n", 1)
        require(line, "snapshot_response_invalid")
        try:
            result = json.loads(line)
            check_deadline()
            return result
        except ValueError:
            raise Stopped("snapshot_response_invalid") from None

    def __exit__(self, *_):
        if self.process:
            try:
                self.process.communicate(b"ROLLBACK;\n", timeout=5)
            except (OSError, subprocess.SubprocessError):
                self.process.kill()
                self.process.wait(timeout=5)


CATALOG_SQL = """
SELECT jsonb_build_object(
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname),'[]') FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl,'comment',obj_description(n.oid,'pg_namespace')) ORDER BY n.nspname),'[]') FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'populated',c.relispopulated) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m','f') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'preinstalledObjects',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',o.schema,'name',o.name,'kind',o.kind) ORDER BY o.schema,o.kind,o.name),'[]') FROM (
   SELECT n.nspname AS schema,c.relname AS name,'relation' AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
   UNION ALL SELECT n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','routine' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
   UNION ALL SELECT n.nspname,t.typname,'type' FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND t.typtype IN ('d','e','r','m') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
 )o),
 'sequences',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil) ORDER BY rolname),'[]') FROM pg_roles),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid,member),'[]') FROM pg_auth_members),
 'roleSettings',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',CASE WHEN s.setrole=0 THEN '*' ELSE pg_get_userbyid(s.setrole) END,'database',coalesce(d.datname,'*'),'settings',s.setconfig) ORDER BY s.setrole,s.setdatabase),'[]') FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase),
 'publications',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',pubname,'owner',pg_get_userbyid(pubowner),'allTables',puballtables,'insert',pubinsert,'update',pubupdate,'delete',pubdelete,'truncate',pubtruncate,'viaRoot',pubviaroot) ORDER BY pubname),'[]') FROM pg_publication),
 'largeObjects',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid::text,'owner',pg_get_userbyid(lomowner),'acl',lomacl,'sha256',encode(sha256(lo_get(oid)),'hex')) ORDER BY oid),'[]') FROM pg_largeobject_metadata)
)::text;
"""


def identifiers(catalog):
    require(not any(r["kind"] == "f" for r in catalog["tables"]), "foreign_data_recovery_unqualified")
    for row in budgeted(catalog["tables"] + catalog["sequences"]):
        require(IDENT.fullmatch(row["schema"]) and IDENT.fullmatch(row["name"]), "identifier_review_required")
    require(all(IDENT.fullmatch(s["name"]) for s in catalog["schemas"]), "schema_review_required")


def schema_hash(data):
    # Remove only pg_dump's outer random psql restriction wrappers and header
    # version comments. Never normalize SQL bodies, ownership or privileges.
    lines = data.decode("utf-8").splitlines(keepends=True)
    # Only pg_dump's initial comment/blank/restriction header is normalized.
    # A similarly named comment inside an early function body is real SQL.
    remove = set()
    for i, line in budgeted(enumerate(lines[:12])):
        if not (line.startswith("--") or not line.strip() or line.startswith("\\restrict ")):
            break
        if line.startswith(("-- Dumped from database version ", "-- Dumped by pg_dump version ")):
            remove.add(i)
    outer = [(i, re.fullmatch(r"\\(un)?restrict ([A-Za-z0-9]+)\r?\n?", line)) for i, line in budgeted(enumerate(lines))]
    starts = [(i, m) for i, m in outer if m and not m[1] and i < 12]
    ends = [(i, m) for i, m in outer if m and m[1] and i >= len(lines)-12]
    if starts or ends:
        require(len(starts) == len(ends) == 1 and starts[0][1][2] == ends[0][1][2], "dump_wrapper_invalid")
        remove.update([starts[0][0], ends[0][0]])
    return digest("".join(line for i, line in budgeted(enumerate(lines)) if i not in remove).encode())


# pg_restore's ordered TOC grammar; unsupported types/quoted identifiers stop
# before execution rather than guessing which managed objects to skip.
TOC_TYPES = sorted(["SCHEMA", "EXTENSION", "COMMENT", "ACL", "DEFAULT ACL", "TABLE", "TABLE DATA", "SEQUENCE", "SEQUENCE OWNED BY", "SEQUENCE SET", "FUNCTION", "PROCEDURE", "TYPE", "DOMAIN", "SHELL TYPE", "VIEW", "MATERIALIZED VIEW", "MATERIALIZED VIEW DATA", "CONSTRAINT", "FK CONSTRAINT", "INDEX", "INDEX ATTACH", "TABLE ATTACH", "RULE", "TRIGGER", "POLICY", "ROW SECURITY", "PUBLICATION", "PUBLICATION TABLE", "PUBLICATION TABLES IN SCHEMA", "EVENT TRIGGER", "COLLATION", "CONVERSION", "TEXT SEARCH CONFIGURATION", "TEXT SEARCH DICTIONARY", "TEXT SEARCH PARSER", "TEXT SEARCH TEMPLATE", "OPERATOR", "OPERATOR CLASS", "OPERATOR FAMILY", "CAST", "AGGREGATE", "BLOB", "BLOBS", "BLOB COMMENTS", "BLOB ACL", "ENCODING", "STDSTRINGS", "SEARCHPATH"], key=len, reverse=True)
TOC = re.compile(r"^(\d+); \d+ \d+ (" + "|".join(map(re.escape, TOC_TYPES)) + r") (\S+) (.+)$")


def toc_entries(text):
    out = []
    for line in budgeted(text.splitlines()):
        if not line or line.startswith(";"):
            continue
        m = TOC.fullmatch(line)
        require(m is not None and (m[3] == "-" or IDENT.fullmatch(m[3])), "toc_review_required")
        out.append({"id":m[1], "kind":m[2], "schema":m[3], "nameOwner":m[4], "line":line})
    require(out, "empty_archive")
    return out


def table_coverage(catalog, entries):
    present = {(e["schema"], e["nameOwner"].split()[0]) for e in entries if e["kind"] == "TABLE DATA"}
    expected = {(r["schema"], r["name"]) for r in catalog["tables"] if r["kind"] == "r"}
    require(expected <= present, "full_table_data_coverage_missing")
    materialized = {(r["schema"],r["name"]) for r in catalog["tables"] if r["kind"] == "m" and r.get("populated") is True}
    included = {(e["schema"],e["nameOwner"].split()[0]) for e in entries if e["kind"] == "MATERIALIZED VIEW DATA"}
    require(materialized <= included, "materialized_data_coverage_missing")
    require({"auth", "storage", "public", "supabase_migrations"} <= {s["name"] for s in catalog["schemas"]}, "required_schema_missing")
    require({("auth","users"),("auth","identities"),("auth","sessions")} <= expected, "hosted_auth_capture_missing")


def row_fingerprints(env, catalog, snapshot=None):
    out = []
    for row in budgeted(catalog["tables"]):
        if row["kind"] not in {"r", "m"} or (row["kind"] == "m" and row.get("populated") is not True):
            continue
        table = f'"{row["schema"]}"."{row["name"]}"'
        prefix = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
        if snapshot:
            require(re.fullmatch(r"[a-fA-F0-9]+-[a-fA-F0-9]+-\d+", snapshot), "snapshot_rejected")
            prefix += f"SET TRANSACTION SNAPSHOT '{snapshot}';\n"
        sql = prefix + f"COPY (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM {table} t ORDER BY h) TO STDOUT;\nCOMMIT;\n"
        with tempfile.TemporaryFile() as f:
            psql(env, sql, output=f)
            require(f.tell() <= MAX_BYTES, "row_proof_bound_exceeded")
            f.seek(0)
            h, count = hashlib.sha256(), 0
            for line in budgeted(f):
                require(re.fullmatch(rb"[a-f0-9]{64}\n", line) is not None, "row_proof_invalid")
                h.update(line)
                count += 1
        out.append({"schema":row["schema"],"name":row["name"],"rows":count,"sha256":h.hexdigest()})
    return out


def passphrase(env):
    p = env.get("KOVA_PRODUCTION_BACKUP_PASSPHRASE", "")
    require(len(p) >= 32 and "\n" not in p and "\r" not in p, "backup_passphrase_missing")
    return p.encode()


def crypt(env, phrase, src, dest, decrypt=False):
    child = clean_pg_env(env)
    argv = ["gpg", "--no-options", "--no-symkey-cache", "--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--output", str(dest)]
    argv += ["--decrypt", str(src)] if decrypt else ["--symmetric", "--cipher-algo", "AES256", str(src)]
    with tempfile.TemporaryDirectory(prefix="kova-gpg-private-") as home:
        os.chmod(home, 0o700)
        child["GNUPGHOME"] = home
        run(argv, child, data=phrase)
    os.chmod(dest, 0o600)


def bounded_archive(path, out):
    with tarfile.open(path, "r:") as archive:
        check_deadline()
        members = []
        for member in budgeted(archive):
            require(len(members) < len(MEMBERS), "backup_members_rejected")
            members.append(member)
        require(len(members) == len(MEMBERS) and {m.name for m in members} == MEMBERS
                and all(m.isfile() and 0 < m.size <= (MAX_BYTES if m.name == "full.dump" else 128*1024**2) for m in members)
                and sum(m.size for m in members) <= MAX_BYTES, "backup_members_rejected")
        for m in budgeted(members):
            with archive.extractfile(m) as src, (out/m.name).open("xb") as dst:
                os.chmod(out/m.name, 0o600)
                reader = DeadlineReader(src)
                while chunk := reader.read(1024**2):
                    dst.write(chunk)
                    check_deadline()


@bounded_operation
def capture(env, output):
    require(env.get("KOVA_AUTH_RECOVERY_CONFIRMATION") == "CAPTURE_ONLY", "capture_not_enabled")
    source = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", source) and env.get("KOVA_APPROVED_SOURCE_SHA") == source
            and env.get("GITHUB_REF") == "refs/heads/main", "source_approval_mismatch")
    require(env.get("KOVA_AUTH_APPROVED_SOURCE_DATABASE_VERSION") == BUILD, "source_build_approval_missing")
    phrase = passphrase(env)
    source_env = source_environment(env)
    client_check(source_env)
    require(not output.exists(), "output_exists")
    output.mkdir(mode=0o700)
    success = False
    try:
        with tempfile.TemporaryDirectory(prefix="kova-full-auth-capture-") as temp:
            work = Path(temp)
            os.chmod(work, 0o700)
            with Snapshot(source_env) as snapshot:
                catalog = snapshot.query(CATALOG_SQL)
                identifiers(catalog)
                fresh_file(work/"catalog.json", encoded(catalog))
                run(["pg_dump", "--no-password", "--format=custom", "--snapshot", snapshot.id,
                     "--file", str(work/"full.dump")], source_env)
                require(0 < (work/"full.dump").stat().st_size <= MAX_BYTES, "dump_bound_exceeded")
                snapshot.query("SELECT '{}'::jsonb;")  # keep exporter alive between bounded children
                for name, args in [("schema.sql", []), ("managed-schema.sql", ["--schema="+s for s in sorted(MANAGED_SCHEMAS)])]:
                    run(["pg_dump", "--no-password", "--schema-only", "--snapshot", snapshot.id,
                         *args, "--file", str(work/name)], source_env)
                    snapshot.query("SELECT '{}'::jsonb;")
                toc = run(["pg_restore", "--list", str(work/"full.dump")], clean_pg_env(env))
                fresh_file(work/"toc.list", toc)
                table_coverage(catalog, toc_entries(toc.decode()))
                fresh_file(work/"rows.json", encoded(row_fingerprints(source_env, catalog, snapshot.id)))
            # Hashes and all schema/role/user-derived data stay INSIDE ciphertext.
            manifest = {"format":1,"operation":"complete-managed-auth-database-capture","project":PROJECT,
                        "sourceSha":source,"postgresBuild":BUILD,"capturedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
                        "schemaSha256":schema_hash((work/"schema.sql").read_bytes()),
                        "managedSchemaSha256":schema_hash((work/"managed-schema.sql").read_bytes()),
                        "consistentExportedSnapshot":True,"storageObjectBytesIncluded":False,
                        "dashboardProviderConfigurationIncluded":False,"postgresRolePasswordsIncluded":False,
                        "hostedMfaRuntimeKeyCustodyVerified":False,
                        "files":[{"name":n,"bytes":(work/n).stat().st_size,"sha256":file_digest(work/n)} for n in sorted(MEMBERS-{"manifest.json"})]}
            require(sum((work/n).stat().st_size for n in MEMBERS-{"manifest.json"}) <= MAX_BYTES, "archive_bound_exceeded")
            fresh_file(work/"manifest.json", encoded(manifest))
            plain = work/"payload.tar"
            with tarfile.open(plain, "w") as archive:
                for name in budgeted(sorted(MEMBERS)):
                    member = archive.gettarinfo(str(work/name), arcname=name)
                    with (work/name).open("rb") as raw:
                        archive.addfile(member, DeadlineReader(raw))
                    check_deadline()
            require(plain.stat().st_size <= MAX_BYTES, "archive_bound_exceeded")
            encrypted = output/"managed-auth-backup.tar.gpg"
            crypt(env, phrase, plain, encrypted)
            # Prove the just-created artifact decrypts under the bound key without
            # exposing it or creating a second uploaded plaintext artifact.
            check = work/"decrypt-check.tar"
            crypt(env, phrase, encrypted, check, decrypt=True)
            require(file_digest(check) == file_digest(plain), "encryption_roundtrip_mismatch")
            receipt = {"operation":"managed-auth-capture","project":PROJECT,"sourceSha":source,
                       "encryptedSha256":file_digest(encrypted),"encryptedBytes":encrypted.stat().st_size,
                       "completeRequiredDatabaseTableCoverage":True,"consistentSnapshot":True,"encryptedRoundtripVerified":True,
                       "restoreExercised":False,"fullProjectRecoveryQualified":False,
                       "storageObjectBytesBackedUp":False,"providerConfigRecoveryQualified":False,
                       "credentialCustodyQualified":False,"productionMutated":False,"plaintextUploaded":False}
            write_success_receipt(output/"capture-receipt.json", receipt)
            check_deadline()
            success = True
            return receipt
    finally:
        if not success:
            for p in output.iterdir():
                if p.is_file():
                    p.unlink()
            output.rmdir()


def attest(env):
    path = private_file(env.get("KOVA_AUTH_RESTORE_ATTESTATION", ""))
    raw = path.read_bytes()
    require(SHA.fullmatch(env.get("KOVA_AUTH_RESTORE_ATTESTATION_SHA256", ""))
            and digest(raw) == env["KOVA_AUTH_RESTORE_ATTESTATION_SHA256"], "isolation_attestation_unbound")
    a = json.loads(raw)
    require(a.get("format") == 1 and a.get("sourceProject") == PROJECT and a.get("imageTag") == IMAGE_TAG
            and re.fullmatch(r"public\.ecr\.aws/supabase/postgres@sha256:[a-f0-9]{64}", a.get("actualImageRepoDigest", ""))
            and a.get("postgresBuild") == BUILD and SHA.fullmatch(a.get("networkEvidenceSha256", ""))
            and a.get("productionRoutesDenied") is True and a.get("internetEgressDenied") is True
            and a.get("consumersStopped") is True and a.get("cronLaunchActiveJobs") is False
            and a.get("independentlyReviewed") is True, "isolation_attestation_rejected")
    try:
        observed = datetime.fromisoformat(a["observedAt"].replace("Z", "+00:00")).timestamp()
    except (ValueError, KeyError, TypeError):
        raise Stopped("isolation_attestation_time_invalid") from None
    require(-5 <= time.time()-observed <= 900, "isolation_attestation_stale")
    return a


def target_environment(env, approved):
    u = urlparse(approved["uri"])
    out = clean_pg_env(env)
    out.update(PGHOST=u.hostname, PGHOSTADDR=approved["expectedIp"], PGPORT=str(approved["port"]),
               PGDATABASE=approved["database"], PGUSER=unquote(u.username), PGPASSFILE=str(private_file(env["PGPASSFILE"])),
               PGCONNECT_TIMEOUT="5", PGOPTIONS=CANONICAL_PG + " -c statement_timeout=120000 -c lock_timeout=5000")
    params = parse_qs(u.query)
    require(params.get("sslmode") == ["verify-full"] and len(params.get("sslrootcert", [])) == 1
            and Path(params["sslrootcert"][0]).is_file(), "isolated_target_tls_required")
    # Preserve only the existing guard's explicitly permitted TLS options.
    for key, value in parse_qs(u.query).items():
        if key in {"sslmode","sslrootcert"}:
            out[{"sslmode":"PGSSLMODE","sslrootcert":"PGSSLROOTCERT"}[key]] = value[0]
    return out


def target_observation(env, source_catalog):
    sql = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('database',current_database(),'serverAddress',inet_server_addr()::text,
'serverPort',inet_server_port(),'serverVersionNum',current_setting('server_version_num')::int,
'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
'authUsers',(SELECT count(*)::int FROM auth.users),'authIdentities',(SELECT count(*)::int FROM auth.identities),
'authSessions',(SELECT count(*)::int FROM auth.sessions),'storageBuckets',(SELECT count(*)::int FROM storage.buckets),
'storageObjects',(SELECT count(*)::int FROM storage.objects),'applicationRelations',(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','kova_private') AND c.relkind IN ('r','p','f','S','v','m') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')),
'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname),'[]') FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace))::text;
COMMIT;"""
    observed = json.loads(psql(env, sql))
    return {"observed":observed,"sourceExtensions":source_catalog["extensions"]}


def role_compatibility(source, target, approved_extra_roles):
    extra = set(approved_extra_roles)
    require(all(IDENT.fullmatch(r) for r in extra), "extra_role_review_required")
    target_filtered = [r for r in target["roles"] if r["name"] not in extra]
    require(encoded(sorted(source["roles"],key=lambda r:r["name"])) == encoded(sorted(target_filtered,key=lambda r:r["name"])), "managed_role_baseline_mismatch")
    order = lambda rows: sorted(rows,key=lambda row:encoded(row))
    require(encoded(order(source["memberships"])) == encoded(order(target["memberships"]))
            and encoded(order(source["roleSettings"])) == encoded(order(target["roleSettings"])), "managed_role_privileges_mismatch")


def schema_restore_list(entries, source_catalog, target_catalog):
    source_ns = {s["name"]:s for s in source_catalog["schemas"]}
    target_ns = {s["name"]:s for s in target_catalog["schemas"]}
    result = []
    for entry in budgeted(entries):
        kind, schema, name = entry["kind"], entry["schema"], entry["nameOwner"]
        if kind in {"TABLE DATA","SEQUENCE SET","MATERIALIZED VIEW DATA","BLOB","BLOBS","BLOB COMMENTS","BLOB ACL"}:
            continue
        if schema in MANAGED_SCHEMAS or kind in {"EXTENSION","ENCODING","STDSTRINGS","SEARCHPATH"}:
            continue
        if kind == "SCHEMA":
            ns = name.split()[0]
            require(ns in source_ns, "schema_toc_mismatch")
            if ns in target_ns:
                require(source_ns[ns] == target_ns[ns], "namespace_owner_acl_mismatch")
                continue
        if kind == "PUBLICATION":
            pub = name.split()[0]
            before = {p["name"]:p for p in source_catalog["publications"]}
            existing = {p["name"]:p for p in target_catalog["publications"]}
            if pub in existing:
                require(before.get(pub) == existing[pub], "publication_baseline_mismatch")
                continue
        if schema == "-" and kind not in {"SCHEMA","PUBLICATION"}:
            # Global comments/ACLs and other unclassified dependencies need an
            # exact operator reconciliation, never a guessed omission.
            if kind in {"COMMENT","ACL"} and name.startswith("SCHEMA "):
                ns = name.split()[1]
                if ns in target_ns:
                    require(source_ns.get(ns) == target_ns[ns], "namespace_owner_acl_mismatch")
                    continue
                require(ns in source_ns and ns not in MANAGED_SCHEMAS, "schema_acl_reconciliation_required")
                result.append(entry["line"])
                continue
            if kind == "COMMENT" and name.startswith("EXTENSION "):
                continue
            require(False, "global_object_reconciliation_required")
        result.append(entry["line"])
    return ("\n".join(result) + "\n").encode()



def baseline_service_data(source_rows, target_rows):
    """Skip only proven-identical initialized service migration markers.

    Actual users/identities/password hashes/MFA/session/recovery/Storage records
    must be absent from the isolated baseline and are restored from ciphertext.
    """
    before = {(r["schema"], r["name"]):r for r in source_rows}
    after = {(r["schema"], r["name"]):r for r in target_rows}
    skip = set()
    for key, row in budgeted(after.items()):
        if key[0] not in MANAGED_SCHEMAS:
            require(row["rows"] == 0, "isolated_seed_data_reconciliation_required")
            continue
        if key in BASELINE_SERVICE_TABLES:
            require(key in before and row == before[key], "service_migration_baseline_mismatch")
            skip.add(key)
        else:
            require(row["rows"] == 0, "managed_target_not_empty")
    require(BASELINE_SERVICE_TABLES <= skip, "service_migration_baseline_missing")
    return skip


def data_restore_list(entries, skip_tables):
    # SEQUENCE SET entries remain included, even for a skipped service table;
    # all sequence values are restored and checked against captured setval SQL.
    return ("\n".join(e["line"] for e in budgeted(entries)
                      if not (e["kind"] == "TABLE DATA" and
                              (e["schema"], e["nameOwner"].split()[0]) in skip_tables)) + "\n").encode()



def materialized_restore_list(entries):
    # pg_restore classifies MATERIALIZED VIEW DATA as post-data schema work;
    # --data-only does not emit its REFRESH command.
    selected = [e["line"] for e in budgeted(entries) if e["kind"] == "MATERIALIZED VIEW DATA"]
    return ("\n".join(selected)+"\n").encode() if selected else b""


def sequence_values(sql):
    out = []
    for line in budgeted(sql.decode().splitlines()):
        if "pg_catalog.setval(" not in line:
            continue
        m = re.fullmatch(r"SELECT pg_catalog\.setval\('([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)', (-?\d+), (true|false)\);", line)
        require(m is not None, "sequence_reconciliation_required")
        out.append({"schema":m[1],"name":m[2],"value":m[3],"called":m[4]=="true"})
    return out


@bounded_operation
def restore(env, archive, output):
    require(env.get("KOVA_AUTH_RECOVERY_CONFIRMATION") == "RESTORE_ISOLATED", "restore_not_enabled")
    a = attest(env)  # isolation is established BEFORE receiving plaintext
    require(not env.get("PGPASSWORD"), "isolated_password_environment_rejected")
    guard_env = {**clean_pg_env(env), **{k:v for k,v in env.items() if k.startswith("APPROVED_ISOLATED_") or k == "PGPASSFILE"}}
    approved = json.loads(run(["node", str(GUARD), "--configuration"], guard_env, timeout=5))
    require(all(str(a.get(k)) == str(approved[v]) for k,v in {
        "host":"host","database":"database","port":"port","serverIp":"expectedIp","systemIdentifier":"expectedSystemId"}.items()), "attested_target_mismatch")
    target = target_environment(env, approved)
    client_check(target)
    expected = env.get("KOVA_AUTH_BACKUP_ENCRYPTED_SHA256", "")
    require(SHA.fullmatch(expected) and file_digest(private_file(archive)) == expected, "backup_pin_mismatch")
    require(not output.exists(), "output_exists")
    phrase = passphrase(env)
    with tempfile.TemporaryDirectory(prefix="kova-private-auth-restore-") as temp:
        work = Path(temp)
        os.chmod(work, 0o700)
        plain = work/"payload.tar"
        crypt(env, phrase, archive, plain, decrypt=True)
        extracted = work/"payload"
        extracted.mkdir(mode=0o700)
        bounded_archive(plain, extracted)
        manifest = json.loads((extracted/"manifest.json").read_bytes())
        require(manifest.get("format") == 1 and manifest.get("operation") == "complete-managed-auth-database-capture" and manifest.get("project") == PROJECT
                and manifest.get("postgresBuild") == BUILD and manifest.get("consistentExportedSnapshot") is True
                and manifest.get("sourceSha") == env.get("KOVA_APPROVED_BACKUP_SOURCE_SHA")
                and len(manifest["files"]) == len(MEMBERS)-1
                and {r["name"] for r in manifest["files"]} == MEMBERS-{"manifest.json"}, "backup_manifest_rejected")
        for row in budgeted(manifest["files"]):
            member = extracted/row["name"]
            require(member.stat().st_size == row["bytes"] and file_digest(member) == row["sha256"], "backup_member_integrity_failed")
        source_catalog = json.loads((extracted/"catalog.json").read_bytes())
        identifiers(source_catalog)
        proof = target_observation(target, source_catalog)
        require(proof["observed"]["serverVersionNum"] == 170006, "target_postgres_patch_mismatch")
        run(["node", str(GUARD), "--observation"], guard_env, data=encoded(proof), timeout=5)
        # The target is independently pinned and empty; current schema/roles
        # must also match the capture. Historical baseline metadata cannot pass.
        require(psql(target, "SELECT has_parameter_privilege(current_user,'session_replication_role','SET');\n").strip() == b"t", "isolated_restore_authority_missing")
        target_catalog = json.loads(psql(target, CATALOG_SQL))
        role_compatibility(source_catalog, target_catalog, a.get("approvedTargetOnlyRoles", []))
        require(psql(target, "SELECT coalesce(current_setting('cron.launch_active_jobs',true),'off');\n").strip() == b"off", "cron_not_disabled")
        identifiers(target_catalog)
        require(not any(o["schema"] not in MANAGED_SCHEMAS for o in target_catalog["preinstalledObjects"]), "unsupported_preinstalled_baseline_collision")
        source_rows = json.loads((extracted/"rows.json").read_bytes())
        require(not target_catalog["largeObjects"], "isolated_large_objects_not_empty")
        skip_tables = baseline_service_data(source_rows, row_fingerprints(target, target_catalog))
        managed = work/"target-managed.sql"
        run(["pg_dump","--no-password","--schema-only",*["--schema="+s for s in sorted(MANAGED_SCHEMAS)],"--file",str(managed)],target)
        require(schema_hash(managed.read_bytes()) == manifest["managedSchemaSha256"], "managed_ddl_baseline_mismatch")
        entries = toc_entries((extracted/"toc.list").read_text())
        table_coverage(source_catalog, entries)
        selected = work/"schema-restore.list"
        fresh_file(selected, schema_restore_list(entries, source_catalog, target_catalog))
        # Every owner/ACL is retained. Managed definitions are not replayed over
        # the exact matching baseline. Any conflict aborts this transaction.
        run(["pg_restore","--no-password","--exit-on-error","--single-transaction",
             "--section=pre-data","--section=post-data","--use-list",str(selected),
             "--dbname",approved["uri"],str(extracted/"full.dump")],target)
        data_selected = work/"data-restore.list"
        fresh_file(data_selected, data_restore_list(entries, skip_tables))
        data_sql = work/"data.sql"
        run(["pg_restore","--data-only","--use-list",str(data_selected),"--file",str(data_sql),str(extracted/"full.dump")],target)
        expected_sequences = []
        with data_sql.open("rb") as data:
            while line := data.readline(8*1024**2+1):
                check_deadline()
                require(len(line) <= 8*1024**2, "data_record_review_required")
                if line.startswith(b"SELECT pg_catalog.setval("):
                    expected_sequences.extend(sequence_values(line))
        require(len(expected_sequences) == len(source_catalog["sequences"]), "sequence_coverage_missing")
        materialized = materialized_restore_list(entries)
        if materialized:
            matlist, matsql = work/"materialized.list", work/"materialized.sql"
            fresh_file(matlist, materialized)
            run(["pg_restore","--use-list",str(matlist),"--file",str(matsql),str(extracted/"full.dump")],target)
            require(data_sql.stat().st_size+matsql.stat().st_size <= MAX_BYTES, "data_bound_exceeded")
            with data_sql.open("ab") as data, matsql.open("rb") as extra:
                reader = DeadlineReader(extra)
                while chunk := reader.read(1024**2):
                    data.write(chunk)
                    check_deadline()
        # Import only on the isolated target. SET replication_role suppresses
        # triggers without changing their saved enabled/disabled definitions.
        run(["psql","-X","--no-password","--quiet","--single-transaction","--set","ON_ERROR_STOP=1",
             "--command","SET session_replication_role=replica","--file",str(data_sql),
             "--command","SET session_replication_role=origin"],target,output=subprocess.DEVNULL)
        require(encoded(row_fingerprints(target, source_catalog)) == (extracted/"rows.json").read_bytes(), "restored_table_state_mismatch")
        for row in budgeted(expected_sequences):
            actual = json.loads(psql(target,f'SELECT jsonb_build_object(\'value\',last_value::text,\'called\',is_called) FROM "{row["schema"]}"."{row["name"]}";\n'))
            require(actual == {"value":row["value"],"called":row["called"]}, "restored_sequence_state_mismatch")
        after = json.loads(psql(target, CATALOG_SQL))
        role_compatibility(source_catalog, after, a.get("approvedTargetOnlyRoles", []))
        require(source_catalog["largeObjects"] == after["largeObjects"], "restored_large_objects_mismatch")
        matviews = lambda c: sorted((r["schema"],r["name"],r["populated"]) for r in c["tables"] if r["kind"] == "m")
        require(matviews(source_catalog) == matviews(after), "restored_materialized_population_mismatch")
        schema = work/"restored-schema.sql"
        run(["pg_dump","--no-password","--schema-only","--file",str(schema)],target)
        require(schema_hash(schema.read_bytes()) == manifest["schemaSha256"], "restored_schema_privileges_mismatch")
        receipt = {"operation":"managed-auth-isolated-restore","project":PROJECT,"backupSourceSha":manifest["sourceSha"],
                   "encryptedBackupSha256":expected,"isolationAttestationSha256":env["KOVA_AUTH_RESTORE_ATTESTATION_SHA256"],
                   "actualImageRepoDigest":a["actualImageRepoDigest"],"postgresBuild":BUILD,
                   "restoredDatabaseStateVerified":True,"tablesSequencesLargeObjectsVerified":True,
                   "schemaOwnersPoliciesPrivilegesVerified":True,"productionMutated":False,
                   "providerConfigRecoveryQualified":False,"credentialCustodyQualified":False,
                   "storageObjectBytesRecovered":False,"fullProjectRecoveryQualified":False}
        write_success_receipt(output, receipt)
        return receipt


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["capture","restore"])
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--archive")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    require(args.execute, "explicit_execution_required")
    if args.mode == "capture":
        capture(os.environ, Path(args.output))
    else:
        require(args.archive, "archive_required")
        restore(os.environ, Path(args.archive), Path(args.output))
    print('{"ok":true,"receiptWritten":true}')


if __name__ == "__main__":
    def interrupted(*_):
        raise Stopped("operator_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception:
        # Database/provider diagnostics may contain credentials or account data.
        # The public failure is deliberately fixed; private state is quarantined
        # by the isolated operator and must never be retried against production.
        print('{"ok":false,"error":"managed_auth_recovery_unqualified"}')
        raise SystemExit(1)
