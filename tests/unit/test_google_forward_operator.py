import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("google_forward", ROOT / "scripts/release/google-forward-operator.py")
OP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OP)
SOURCE_SHA = "a" * 40
WINDOW = "11111111-1111-4111-8111-111111111111"


def env():
    return {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/tmp"),
            "GITHUB_REPOSITORY": "Blockigaming/KovaGPT", "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SOURCE_SHA,
            "KOVA_PRODUCTION_DATABASE_URL": f"postgresql://postgres:fixture%40password@db.{OP.PROJECT}.supabase.co:5432/postgres?sslmode=require",
            "PGSERVICE": "untrusted", "PGPASSFILE": "/untrusted", "PGSSLMODE": "disable"}


class Transport:
    def __init__(self, version=b"psql (PostgreSQL) 17.6\n", checked=None, applied=None, fail_apply=False):
        self.calls = []
        self.version = version
        self.checked = {"target_verified": True} if checked is None else checked
        self.applied = {"status": "google_schema_verified", "migration_version": OP.VERSION} if applied is None else applied
        self.fail_apply = fail_apply

    def __call__(self, argv, child, sql=None, timeout=10):
        self.calls.append((argv, child, sql, timeout))
        if argv[0] == "git":
            self.test_secret_free(child)
            return (SOURCE_SHA + "\n").encode()
        if "--version" in argv:
            return self.version
        if "BEGIN READ ONLY" in sql:
            return self.checked if isinstance(self.checked, bytes) else json.dumps(self.checked).encode()
        if self.fail_apply:
            raise OP.Stopped("database_execution_unconfirmed")
        return json.dumps(self.applied).encode()

    @staticmethod
    def test_secret_free(child):
        assert "KOVA_PRODUCTION_DATABASE_URL" not in child
        assert "PGPASSWORD" not in child


class GoogleForwardOperatorTests(unittest.TestCase):
    def test_native_pg17_prerequisite_is_verified_without_credentials_and_precedes_transport(self):
        workflow = (ROOT / ".github/workflows/google-connection-forward.yml").read_text()
        source, operator = workflow.split("  source-tests:", 1)[1].split("  google-forward-only:", 1)
        self.assertIn("bash scripts/release/ensure-pg17-client.sh", source)
        self.assertLess(operator.index("bash scripts/release/ensure-pg17-client.sh"), operator.index("KOVA_PRODUCTION_DATABASE_URL:"))
        installer = (ROOT / "scripts/release/ensure-pg17-client.sh").read_text()
        self.assertIn("B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8", installer)
        self.assertIn("https://apt.postgresql.org/pub/repos/apt", installer)
        self.assertIn("signed-by=", installer)
        self.assertIn("postgresql-client-17", installer)
        self.assertNotIn("allow-unauthenticated", installer)
        self.assertNotIn("trusted=yes", installer)
        self.assertNotIn("secrets.", source)

    def test_untrusted_pull_request_tests_cannot_receive_the_production_connection(self):
        workflow = (ROOT / ".github/workflows/google-connection-forward.yml").read_text()
        source_tests = workflow.split("  source-tests:", 1)[1].split("  google-forward-only:", 1)[0]
        self.assertNotIn("secrets.", source_tests)
        self.assertNotIn("environment:", source_tests)
        self.assertNotIn("id-token:", workflow)
        operator = workflow.split("  google-forward-only:", 1)[1]
        for required in ["github.event_name == 'workflow_dispatch'", "github.repository == 'Blockigaming/KovaGPT'", "github.ref == 'refs/heads/main'", "inputs.source_sha == github.sha", "inputs.confirmation == inputs.operation", "name: production", "cancel-in-progress: false"]:
            self.assertIn(required, operator if required != "cancel-in-progress: false" else workflow)

    def test_exact_canonical_source_is_embedded_once(self):
        sql = OP.build_sql()
        self.assertEqual(sql.count(OP.approved_source()), 1)
        self.assertIn("LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE", sql)
        self.assertIn("ARRAY[v_source]", sql)
        self.assertNotIn("UPDATE supabase_migrations.schema_migrations", sql)
        self.assertNotIn("DELETE FROM supabase_migrations.schema_migrations", sql)

    def test_changed_source_fails_before_transport(self):
        t = Transport()
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "changed.sql"; p.write_text("select 1;")
            with patch.object(OP, "SOURCE", p):
                with self.assertRaisesRegex(OP.Stopped, "canonical_source_changed"):
                    OP.execute("CHECK", env(), SOURCE_SHA, "CHECK", run=t)
        self.assertEqual(t.calls, [])

    def test_tls_is_always_verified_and_credentials_are_not_arguments(self):
        child = OP.connection_environment(env())
        self.assertEqual(child["PGSSLMODE"], "verify-full")
        self.assertEqual(child["PGPASSWORD"], "fixture@password")
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL", child)
        self.assertNotIn("PGSERVICE", child); self.assertNotIn("PGPASSFILE", child)
        t = Transport(); OP.execute("CHECK", env(), SOURCE_SHA, "CHECK", run=t)
        for argv, _, _, _ in t.calls:
            self.assertNotIn("fixture@password", " ".join(argv))
            self.assertNotIn("fixture%40password", " ".join(argv))
        self.assertEqual(sum(sql is not None for _, _, sql, _ in t.calls), 1)
        self.assertIn("BEGIN READ ONLY", t.calls[-1][2])

    def test_session_pooler_uses_exact_project_identity(self):
        e = env(); e["KOVA_PRODUCTION_DATABASE_URL"] = f"postgres://postgres.{OP.PROJECT}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
        self.assertEqual(OP.connection_environment(e)["PGUSER"], f"postgres.{OP.PROJECT}")

    def test_invalid_connection_variants_fail_closed(self):
        valid = env()["KOVA_PRODUCTION_DATABASE_URL"]
        variants = ["", valid.replace(OP.PROJECT, "otherproject"), valid.replace("postgres:", "other:"),
                    valid.replace(":5432", ":6543"), valid.replace("/postgres?", "/other?"),
                    valid.replace("sslmode=require", "sslmode=disable"), valid + "&sslmode=verify-full",
                    valid + "&options=-csearch_path=public", valid + "#fragment",
                    valid.replace(".supabase.co", ".supabase.co.attacker.invalid"),
                    valid.replace("fixture%40password", ""), valid.replace("fixture%40password", "%00")]
        for value in variants:
            with self.subTest(value=value):
                e = env(); e["KOVA_PRODUCTION_DATABASE_URL"] = value
                with self.assertRaisesRegex(OP.Stopped, "production_connection_rejected"):
                    OP.connection_environment(e)

    def test_missing_ca_stops_without_relaxing_tls(self):
        with patch.object(OP, "CA", "/nonexistent-kova-test-ca"):
            with self.assertRaisesRegex(OP.Stopped, "trusted_ca_bundle_missing"):
                OP.connection_environment(env())

    def test_only_exact_main_manual_source_can_connect(self):
        for field, value in [("GITHUB_REF", "refs/heads/feature"), ("GITHUB_EVENT_NAME", "pull_request"),
                             ("GITHUB_REPOSITORY", "Other/Repo"), ("GITHUB_SHA", "b" * 40)]:
            e = env(); e[field] = value; t = Transport()
            with self.subTest(field=field):
                with self.assertRaisesRegex(OP.Stopped, "protected_main_dispatch_required"):
                    OP.execute("CHECK", e, SOURCE_SHA, "CHECK", run=t)
                self.assertEqual(t.calls, [])

    def test_checked_out_source_must_match_approved_main(self):
        with self.assertRaisesRegex(OP.Stopped, "checked_out_source_mismatch"):
            OP.execute("CHECK", env(), SOURCE_SHA, "CHECK", run=lambda *_: b"b" * 40)

    def test_exact_operation_confirmation_is_required(self):
        for mode, confirmation in [("CHECK", "APPLY_GOOGLE_FORWARD"), ("APPLY_GOOGLE_FORWARD", "CHECK"), ("other", "other")]:
            t = Transport()
            with self.assertRaisesRegex(OP.Stopped, "exact_confirmation_required"):
                OP.execute(mode, env(), SOURCE_SHA, confirmation, run=t)
            self.assertEqual(t.calls, [])

    def test_apply_requires_a_current_bounded_window_before_any_connection(self):
        for window, expiry in [("", int(time.time()) + 60), (WINDOW, 0), (WINDOW, int(time.time()) + 3600)]:
            t = Transport()
            with self.assertRaisesRegex(OP.Stopped, "current_exclusive_window_required"):
                OP.execute("APPLY_GOOGLE_FORWARD", env(), SOURCE_SHA, "APPLY_GOOGLE_FORWARD", window, expiry, run=t)
            self.assertTrue(all(argv[0] == "git" for argv, *_ in t.calls))

    def test_window_is_rechecked_after_target_verification(self):
        t = Transport(); moments = iter([1000, 2001])
        with patch.object(OP.time, "time", side_effect=lambda: next(moments)):
            with self.assertRaisesRegex(OP.Stopped, "current_exclusive_window_required"):
                OP.execute("APPLY_GOOGLE_FORWARD", env(), SOURCE_SHA, "APPLY_GOOGLE_FORWARD", WINDOW, 1900, run=t)
        self.assertFalse(any(sql and "INSERT INTO supabase_migrations" in sql for _, _, sql, _ in t.calls))

    def test_pg17_client_is_required_before_queries(self):
        t = Transport(version=b"psql (PostgreSQL) 16.9\n")
        with self.assertRaisesRegex(OP.Stopped, "pg17_client_required"):
            OP.execute("CHECK", env(), SOURCE_SHA, "CHECK", run=t)
        self.assertFalse(any(sql for _, _, sql, _ in t.calls))

    def test_target_requires_a_strict_true_boolean(self):
        for value in [{"target_verified": False}, {"target_verified": 1}, {"target_verified": "true"}, {}, []]:
            t = Transport(checked=value)
            with self.assertRaisesRegex(OP.Stopped, "production_identity_mismatch"):
                OP.execute("CHECK", env(), SOURCE_SHA, "CHECK", run=t)
            self.assertEqual(len(t.calls), 3)

    def test_invalid_target_json_does_not_attempt_ddl(self):
        t = Transport(checked=b"not json")
        with self.assertRaisesRegex(OP.Stopped, "target_verification_unconfirmed"):
            OP.execute("APPLY_GOOGLE_FORWARD", env(), SOURCE_SHA, "APPLY_GOOGLE_FORWARD", WINDOW, int(time.time()) + 900, run=t)
        self.assertEqual(len(t.calls), 3)

    def test_success_reports_only_acknowledged_commit(self):
        t = Transport(); progress = {"write_attempted": False}
        result = OP.execute("APPLY_GOOGLE_FORWARD", env(), SOURCE_SHA, "APPLY_GOOGLE_FORWARD", WINDOW, int(time.time()) + 900, run=t, progress=progress)
        self.assertEqual(result["status"], "google_schema_verified")
        self.assertTrue(progress["write_attempted"])
        self.assertEqual(len(t.calls), 4)
        self.assertIn("COMMIT;", t.calls[-1][2]); self.assertEqual(t.calls[-1][3], 65)

    def test_uncertain_execution_is_not_retried_or_claimed_successful(self):
        t = Transport(fail_apply=True); progress = {"write_attempted": False}
        with self.assertRaisesRegex(OP.Stopped, "database_execution_unconfirmed"):
            OP.execute("APPLY_GOOGLE_FORWARD", env(), SOURCE_SHA, "APPLY_GOOGLE_FORWARD", WINDOW, int(time.time()) + 900, run=t, progress=progress)
        self.assertTrue(progress["write_attempted"]); self.assertEqual(len(t.calls), 4)

    def test_raw_provider_errors_and_flooded_output_are_not_returned(self):
        for program in ["import sys;sys.stderr.write('synthetic-private-detail');sys.exit(1)", "print('x'*100000)"]:
            with self.assertRaisesRegex(OP.Stopped, "database_execution_unconfirmed") as caught:
                OP.bounded_run([sys.executable, "-c", program], {"PATH": os.environ["PATH"]})
            self.assertNotIn("synthetic-private-detail", str(caught.exception))

    def test_diagnostics_are_fixed_codes_without_raw_connection_details(self):
        for marker, code in [(b"password authentication failed", "database_authentication_unconfirmed"),
                             (b"certificate verify failed", "database_tls_unconfirmed"),
                             (b"could not translate host name", "database_network_unconfirmed")]:
            raw = b"synthetic-private-username and credential " + marker
            self.assertEqual(OP.safe_database_error(raw), code)
            self.assertNotIn("synthetic-private", OP.safe_database_error(raw))

    def test_existing_receipt_is_preserved_and_invalid_metadata_is_not_logged(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "receipt.json"; path.write_text("prior-private-marker")
            e = dict(os.environ, RUNNER_TEMP=td)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/release/google-forward-operator.py"), "--mode", "CHECK", "--source-sha", "not-a-reviewed-sha", "--confirmation", "CHECK", "--receipt", str(path)], env=e, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1); self.assertEqual(path.read_text(), "prior-private-marker")
            self.assertNotIn("prior-private-marker", result.stdout); self.assertEqual(json.loads(result.stdout)["source_sha"], "")


if __name__ == "__main__":
    unittest.main()
