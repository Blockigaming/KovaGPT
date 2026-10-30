"""Synthetic launcher tests; no Docker, network, customer data or restore."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2]/"scripts/release/run-isolated-recovery-client.py"
spec = importlib.util.spec_from_file_location("isolated_recovery_client", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bindings = self.root/"bindings.json"
        self.phrase = self.root/"phrase"
        self.phrase.write_text("synthetic-local-only-passphrase-0123456789")
        self.phrase.chmod(0o600)
        self.values = {k:"synthetic-public-fixture" for k in m.BINDINGS}
        self.values.update(KOVA_AUTH_RECOVERY_CONFIRMATION="RESTORE_EMPTY_ISOLATED",
                           KOVA_AUTH_RESTORE_BASELINE_MODE="empty-database")
        self.write_bindings()
        self.engine_sha = hashlib.sha256(m.ENGINE.read_bytes()).hexdigest()
        self.actual_load_engine=m.load_engine
        self.engine = m.load_engine(self.engine_sha)
        engine_loader = patch.object(m,"load_engine",return_value=self.engine)
        engine_loader.start();self.addCleanup(engine_loader.stop)

    def write_bindings(self):
        self.bindings.write_text(json.dumps(self.values));self.bindings.chmod(0o600)

    def launch(self):
        return m.launch(self.bindings,self.phrase,self.root/"ciphertext",self.root/"receipt.json",
                        self.engine_sha,{"PATH":"/approved/bin","TMPDIR":"/work", "PGPASSWORD":"unsafe",
                            "KOVA_PRODUCTION_DATABASE_URL":"unsafe-production-secret",
                            "OPENAI_API_KEY":"unsafe-provider-secret"})

    def test_only_fixed_runtime_and_complete_approved_bindings_reach_engine(self):
        seen=[]
        def attest_now(env):seen.append(dict(env));return {"review":"fixture"}
        with patch.object(self.engine,"attest",side_effect=attest_now) as attest, \
             patch.object(self.engine,"restore_baseline_mode",return_value="empty-database") as mode, \
             patch.object(self.engine,"restore",return_value={"verified":"fixture"}) as restore:
            result = self.launch()
        self.assertEqual(result,{"verified":"fixture"})
        env = restore.call_args.args[0]
        self.assertEqual(set(env),set(m.BINDINGS)|{"PATH","TMPDIR","KOVA_PRODUCTION_BACKUP_PASSPHRASE"})
        self.assertEqual(env["KOVA_PRODUCTION_BACKUP_PASSPHRASE"],self.phrase.read_text())
        self.assertNotIn("unsafe",json.dumps(env))
        self.assertNotIn("KOVA_PRODUCTION_BACKUP_PASSPHRASE",seen[0])
        self.assertEqual(mode.call_args.args[1],{"review":"fixture"})

    def test_stale_or_unbound_attestation_stops_before_phrase_read_or_restore(self):
        self.phrase.unlink()
        with patch.object(self.engine,"attest",side_effect=self.engine.Stopped("isolation_attestation_stale")), \
             patch.object(self.engine,"restore") as restore:
            with self.assertRaisesRegex(self.engine.Stopped,"isolation_attestation_stale"):
                self.launch()
        restore.assert_not_called()

    def test_unknown_binding_duplicate_missing_or_wrong_mode_rejected_before_unlock(self):
        for change in ["extra","missing","mode","duplicate"]:
            with self.subTest(change=change):
                self.values = {k:"synthetic-public-fixture" for k in m.BINDINGS}
                self.values.update(KOVA_AUTH_RECOVERY_CONFIRMATION="RESTORE_EMPTY_ISOLATED",
                                   KOVA_AUTH_RESTORE_BASELINE_MODE="empty-database")
                if change == "extra":self.values["KOVA_PRODUCTION_DATABASE_URL"]="unsafe"
                if change == "missing":self.values.pop("PGPASSFILE")
                if change == "mode":self.values["KOVA_AUTH_RECOVERY_CONFIRMATION"]="CAPTURE_ONLY"
                self.write_bindings()
                if change == "duplicate":self.bindings.write_text('{"PGPASSFILE":"a","PGPASSFILE":"b"}')
                with patch.object(self.engine,"attest") as attest,patch.object(self.engine,"restore") as restore:
                    with self.assertRaises((m.Stopped,self.engine.Stopped)):self.launch()
                attest.assert_not_called();restore.assert_not_called()

    def test_engine_source_pin_mismatch_fails_before_reading_bindings(self):
        self.bindings.unlink()
        # Bypass only this test fixture's loader patch to test actual pin-before-exec.
        with patch.object(m.importlib.util,"spec_from_file_location") as spec_loader:
            with self.assertRaisesRegex(m.Stopped,"private_client_engine_pin"):
                self.actual_load_engine("0"*64)
        spec_loader.assert_not_called()

    def test_world_readable_and_symlink_private_inputs_rejected(self):
        for file in [self.bindings,self.phrase]:
            file.chmod(0o644)
            with self.assertRaisesRegex(m.Stopped,"private_client_input_required"):
                m.private_bytes(file,8192)
            file.chmod(0o600)
            linked = self.root/(file.name+"-link");linked.symlink_to(file)
            with self.assertRaisesRegex(m.Stopped,"private_client_input_required"):
                m.private_bytes(linked,8192)

    def test_oversized_or_newline_phrase_never_reaches_engine(self):
        for value in ["x"*8193,"synthetic-local-only-passphrase\n0123456789"]:
            self.phrase.write_text(value)
            with patch.object(self.engine,"attest",return_value={}), \
                 patch.object(self.engine,"restore_baseline_mode",return_value="empty-database"), \
                 patch.object(self.engine,"restore") as restore:
                with self.assertRaises((m.Stopped,self.engine.Stopped)):self.launch()
            restore.assert_not_called()


if __name__ == "__main__":unittest.main()
