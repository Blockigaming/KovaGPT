import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("work_native", ROOT / "scripts/release/work-runtime-forward-native.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeWorkSafety(unittest.TestCase):
    def test_exact_reviewed_sources_embed_only_one_exact_migration(self):
        sql = MODULE.validate_sources(ROOT)
        self.assertEqual(sql.count((ROOT / MODULE.MIGRATION).read_text()), 1)

    def test_altered_source_stops_before_any_native_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in MODULE.EXPECTED:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, target)
            (root / MODULE.MIGRATION).write_text((root / MODULE.MIGRATION).read_text() + "\n-- unexpected\n")
            with patch.object(MODULE.subprocess, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "work_native_source_hash_changed"):
                    MODULE.validate_sources(root)
                run.assert_not_called()

    def test_source_symlink_is_rejected_even_when_bytes_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in MODULE.EXPECTED:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(ROOT / name)
            with self.assertRaisesRegex(RuntimeError, "work_native_source_shape_changed"):
                MODULE.validate_sources(root)

    def test_wrong_address_system_id_directory_database_or_server_cannot_pass(self):
        data = Path("/tmp/kova-work-native-pg17-" + "a" * 24) / "data"
        value = {"address": "127.0.0.1", "database": "postgres", "user": "postgres", "dataDirectory": str(data), "systemIdentifier": "1234567890123456789", "serverVersion": 170011}
        MODULE.require_identity(value, data, "1234567890123456789")
        for key, wrong in (("address", "10.0.0.1"), ("database", "production"), ("user", "service_role"), ("dataDirectory", "/var/lib/postgresql/data"), ("systemIdentifier", "9876543210987654321"), ("serverVersion", 180003)):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                MODULE.require_identity({**value, key: wrong}, data, "1234567890123456789")

    def test_cleanup_refuses_unowned_paths_without_process_or_file_changes(self):
        with patch.object(MODULE.subprocess, "run") as run, patch.object(MODULE.shutil, "rmtree") as remove:
            self.assertFalse(MODULE.clean_cluster(Path("/tmp/unrelated"), Path("/tmp/unrelated/data"), Path("/usr/bin"), {}, True))
            run.assert_not_called()
            remove.assert_not_called()

    def test_root_account_is_rejected_before_any_source_or_process_use(self):
        arguments = ["work-native", "--repository", str(ROOT), "--pg17-bin", "/usr/bin", "--evidence-directory", "/tmp/unused-work-native-evidence"]
        with patch.object(MODULE.os, "geteuid", return_value=0), patch.object(MODULE.subprocess, "run") as run, patch("sys.argv", arguments):
            with self.assertRaisesRegex(SystemExit, "actual nonroot"):
                MODULE.main()
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
