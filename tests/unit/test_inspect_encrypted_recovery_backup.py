"""Exercise the private backup inspector with synthetic encrypted SQL only."""

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/release/inspect-encrypted-recovery-backup.py"
SECRET = "synthetic-testing-passphrase-long-enough"
SOURCE_SHA = "a" * 40


class RecoveryBackupInspectorTest(unittest.TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory(prefix="kova-backup-test-")
        self.addCleanup(self.private.cleanup)
        self.directory = Path(self.private.name)
        self.receipt = self.directory / "private-receipt.json"
        fake_bin = self.directory / "bin"
        fake_bin.mkdir()
        fake_gpg = fake_bin / "gpg"
        fake_gpg.write_text(
            '#!/usr/bin/env python3\nimport os, sys\nfrom pathlib import Path\n'
            'if "KOVA_PRODUCTION_BACKUP_PASSPHRASE" in os.environ: sys.exit(2)\n'
            'if sys.stdin.buffer.readline().strip() != b"synthetic-testing-passphrase-long-enough": sys.exit(2)\n'
            'data = Path(sys.argv[-1]).read_bytes()\n'
            'if not data.startswith(b"SYNTHETIC-CIPHER:"): sys.exit(2)\n'
            'sys.stdout.buffer.write(data[len(b"SYNTHETIC-CIPHER:"):])\n'
        )
        fake_gpg.chmod(0o700)
        self.fake_path = f"{fake_bin}:{os.environ['PATH']}"

    def archive(self, *, bad_manifest_hash=False, symlink=False, real_gpg=False):
        files = {name: b"-- synthetic only\nSELECT 1;\n" for name in
                 ("roles.sql", "schema.sql", "data.sql", "history_schema.sql", "history_data.sql")}
        manifest = {
            "schemaVersion": 1,
            "operation": "supabase-production-logical-backup",
            "projectRef": "mfbycmbjygcfkrsuepxf",
            "sourceSha": SOURCE_SHA,
            "files": [{"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                      for name, data in files.items()],
            "includesStorageObjectBytes": False,
            "includesAuthStorageManagedSchemaCustomizations": False,
            "restoreExercised": False,
        }
        if bad_manifest_hash:
            manifest["files"][0]["sha256"] = "0" * 64
        files["manifest.json"] = json.dumps(manifest).encode()
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode="w") as tar:
            for name, data in files.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                if symlink and name == "data.sql":
                    item.type = tarfile.SYMTYPE
                    item.linkname = "/etc/passwd"
                    item.size = 0
                tar.addfile(item, io.BytesIO(data) if item.isfile() else None)
        if real_gpg:
            plain_path = self.directory / "synthetic.tar"
            plain_path.write_bytes(tar_bytes.getvalue())
            encrypted_path = self.directory / "synthetic.gpg"
            encryption = subprocess.run(
                ["gpg", "--batch", "--quiet", "--pinentry-mode", "loopback",
                 "--passphrase-fd", "0", "--symmetric", "--cipher-algo", "AES256",
                 "--output", str(encrypted_path), str(plain_path)],
                input=(SECRET + "\n").encode(), stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=20, check=False,
            )
            plain_path.unlink()
            if encryption.returncode != 0:
                if os.environ.get("KOVA_REQUIRE_REAL_GPG_TEST") == "1":
                    self.fail("GPG agent unavailable for required real encryption check")
                self.skipTest("GPG agent is unavailable in this execution environment")
            encrypted = encrypted_path.read_bytes()
            encrypted_path.unlink()
        else:
            encrypted = b"SYNTHETIC-CIPHER:" + tar_bytes.getvalue()
        outer = {
            "schemaVersion": 1,
            "operation": "supabase-production-logical-backup-evidence",
            "projectRef": "mfbycmbjygcfkrsuepxf",
            "sourceSha": SOURCE_SHA,
            "encryptedArchiveSha256": hashlib.sha256(encrypted).hexdigest(),
            "encryptedArchiveBytes": len(encrypted),
            "plaintextUploaded": False,
            "databaseMutated": False,
            "restoreExercised": False,
            "storageObjectBytesBackedUp": False,
            "authStorageManagedSchemaCustomizationBackupComplete": False,
        }
        archive_path = self.directory / "synthetic.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr("backup-evidence.json", json.dumps(outer))
            zipped.writestr("kova-production-backup.tar.gpg", encrypted)
        return archive_path, hashlib.sha256(archive_path.read_bytes()).hexdigest()

    def inspect(self, archive_path, archive_hash, passphrase=SECRET, real_gpg=False,
                script=SCRIPT, receipt=None):
        return subprocess.run(
            ["python3", str(script), "--zip", str(archive_path),
             "--expected-zip-sha256", archive_hash, "--expected-source-sha", SOURCE_SHA,
             "--private-receipt", str(receipt or self.receipt)],
            env={**os.environ, "KOVA_PRODUCTION_BACKUP_PASSPHRASE": passphrase,
                 "PATH": os.environ["PATH"] if real_gpg else self.fake_path},
            text=True, capture_output=True, timeout=30, check=False,
        )

    def test_verified_payload_creates_private_receipt_without_sql_or_secret(self):
        archive_path, archive_hash = self.archive()
        result = self.inspect(archive_path, archive_hash)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertNotIn("SELECT 1", result.stdout + result.stderr)
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        receipt = json.loads(self.receipt.read_text())
        self.assertTrue(receipt["decryptionAndHashVerificationSucceeded"])
        self.assertEqual(receipt["sqlPayloadsVerified"], 5)
        self.assertFalse(receipt["restorePerformed"])
        self.assertFalse(receipt["plaintextArtifactWritten"])

    def test_downloads_copy_writes_private_documents_receipt(self):
        downloads = self.directory / "Downloads"
        documents = self.directory / "Documents"
        downloads.mkdir(mode=0o700)
        documents.mkdir(mode=0o700)
        standalone = downloads / SCRIPT.name
        shutil.copyfile(SCRIPT, standalone)
        receipt_path = documents / "inspection.json"
        archive_path, archive_hash = self.archive()
        result = self.inspect(archive_path, archive_hash, script=standalone,
                              receipt=receipt_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(receipt_path.read_text())
                        ["decryptionAndHashVerificationSucceeded"])

    def test_repository_receipt_remains_blocked(self):
        archive_path, archive_hash = self.archive()
        receipt_path = ROOT / "private-inspection-should-not-exist.json"
        self.assertFalse(receipt_path.exists())
        result = self.inspect(archive_path, archive_hash, receipt=receipt_path)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(receipt_path.exists())

    def test_wrong_passphrase_and_tampered_manifest_fail_without_receipt(self):
        archive_path, archive_hash = self.archive()
        result = self.inspect(archive_path, archive_hash, "wrong-long-passphrase-for-testing-only")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.receipt.exists())
        archive_path, archive_hash = self.archive(bad_manifest_hash=True)
        result = self.inspect(archive_path, archive_hash)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.receipt.exists())

    def test_archive_rejects_nonregular_tar_member(self):
        archive_path, archive_hash = self.archive(symlink=True)
        result = self.inspect(archive_path, archive_hash)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.receipt.exists())

    @unittest.skipUnless(shutil.which("gpg"), "GPG is required for the real encryption check")
    def test_real_gpg_encryption_and_decryption_when_agent_available(self):
        archive_path, archive_hash = self.archive(real_gpg=True)
        result = self.inspect(archive_path, archive_hash, real_gpg=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.receipt.exists())


if __name__ == "__main__":
    unittest.main()
