import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[2] / "scripts/release/private-capture-memory.py"
SPEC = importlib.util.spec_from_file_location("private_capture_memory", SOURCE)
memory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(memory)


class CaptureMemoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.target = Path(self.directory.name) / "owned-memory"
        self.target.mkdir(mode=0o700)

    def line(self, filesystem="tmpfs", options="rw,nosuid,nodev,noexec", superoptions="rw,noswap"):
        return f"47 30 0:42 / {self.target} {options} - {filesystem} {filesystem} {superoptions}\n"

    def test_exact_mount_proves_kernel_noswap_and_private_permissions(self):
        found = memory.mount_for(self.target, self.line())
        memory.private_mount(self.target, found)

    def test_disk_filesystem_or_missing_noswap_or_protections_is_rejected(self):
        for line in [self.line(filesystem="ext4"), self.line(superoptions="rw"),
                     self.line(options="rw,nodev,noexec"), self.line(options="ro,nosuid,nodev,noexec")]:
            with self.subTest(line=line), self.assertRaises(memory.Rejected):
                memory.private_mount(self.target, memory.mount_for(self.target, line))

    def test_ancestor_mount_does_not_qualify_selected_directory(self):
        self.assertIsNone(memory.mount_for(self.target / "nested", self.line()))
        with patch.object(memory, "mount_for", return_value=None), self.assertRaises(memory.Rejected):
            memory.private_mount(self.target)

    def test_duplicate_or_malformed_mount_proofs_are_rejected(self):
        for line in [self.line() * 2, self.line().replace(" - tmpfs", " - - tmpfs")]:
            with self.subTest(line=line), self.assertRaises(memory.Rejected):
                memory.mount_for(self.target, line)

    def test_group_or_public_readable_or_symlink_workspaces_are_rejected(self):
        for mode in [0o750, 0o770, 0o755]:
            self.target.chmod(mode)
            with self.assertRaises(memory.Rejected):
                memory.private_mount(self.target, memory.mount_for(self.target, self.line()))
        self.target.chmod(0o700)
        alias = Path(self.directory.name) / "alias"
        alias.symlink_to(self.target, target_is_directory=True)
        with self.assertRaises(memory.Rejected):
            memory.private_mount(alias, memory.mount_for(self.target, self.line()))

    def test_context_rejects_non_actions_foreign_repository_and_unsafe_run_identity(self):
        valid = dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY="Blockigaming/KovaGPT",
                     GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1", RUNNER_TEMP=self.directory.name)
        for override in [dict(GITHUB_ACTIONS="false"), dict(GITHUB_REPOSITORY="other/repo"),
                         dict(GITHUB_RUN_ID="../123"), dict(GITHUB_RUN_ATTEMPT="0"),
                         dict(RUNNER_TEMP=self.directory.name + "/../")]:
            with self.subTest(override=override), self.assertRaises(memory.Rejected):
                memory.target_for(valid | override)

    def test_existing_run_directory_stops_before_mount_or_environment_write(self):
        with patch.object(memory, "target_for", return_value=self.target), \
                patch.object(memory, "mount_for", return_value=None), \
                patch.object(memory, "command") as command, self.assertRaises(memory.Rejected):
            memory.prepare({})
        command.assert_not_called()

    def test_successful_mount_command_without_kernel_proof_never_exports_tmpdir(self):
        target = Path(self.directory.name) / "new-memory"
        environment = Path(self.directory.name) / "github-env"
        environment.write_text("")
        with patch.object(memory, "target_for", return_value=target), \
                patch.object(memory, "mount_for", return_value=None), \
                patch.object(memory, "command"), self.assertRaises(memory.Rejected):
            memory.prepare({"GITHUB_ENV": str(environment)})
        self.assertEqual(environment.read_text(), "")

    def test_python_tempfile_fallback_to_disk_is_rejected(self):
        with patch.object(memory, "target_for", return_value=self.target), \
                patch.object(memory, "private_mount"), \
                patch.object(memory.tempfile, "gettempdir", return_value="/tmp"), \
                self.assertRaises(memory.Rejected):
            memory.verify({"TMPDIR": str(self.target)})

    def test_cleanup_refuses_unrelated_filesystems_and_never_calls_unmount(self):
        with patch.object(memory, "target_for", return_value=self.target), \
                patch.object(memory, "mount_for", return_value=memory.mount_for(self.target, self.line(filesystem="ext4"))), \
                patch.object(memory, "command") as command, self.assertRaises(memory.Rejected):
            memory.cleanup({})
        command.assert_not_called()

    def test_cleanup_never_removes_nonempty_unmounted_directory(self):
        (self.target / "unexpected-file").write_text("synthetic")
        with patch.object(memory, "target_for", return_value=self.target), \
                patch.object(memory, "mount_for", return_value=None), self.assertRaises(OSError):
            memory.cleanup({})
        self.assertTrue((self.target / "unexpected-file").is_file())

    def test_cleanup_verifies_unmount_and_removes_only_its_empty_mountpoint(self):
        proof = memory.mount_for(self.target, self.line())
        with patch.object(memory, "target_for", return_value=self.target), \
                patch.object(memory, "mount_for", side_effect=[proof, None]), \
                patch.object(memory, "command") as command:
            result = memory.cleanup({})
        command.assert_called_once_with(["sudo", "-n", "umount", "--", str(self.target)])
        self.assertTrue(result["plaintextMemoryCleanupConfirmed"])
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
