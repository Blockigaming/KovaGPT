#!/usr/bin/env python3
"""Check a retained encrypted logical backup without restoring or emitting SQL."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile


EXPECTED_MEMBERS = frozenset(
    {"roles.sql", "schema.sql", "data.sql", "history_schema.sql", "history_data.sql", "manifest.json"}
)
EXPECTED_ZIP_MEMBERS = frozenset({"backup-evidence.json", "kova-production-backup.tar.gpg"})
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
PRODUCTION_REF = "mfbycmbjygcfkrsuepxf"
UNSAFE_SQL = re.compile(
    rb"^\s*(?:BEGIN|COMMIT|ROLLBACK|CREATE\s+DATABASE|CREATE\s+TABLESPACE|"
    rb"ALTER\s+SYSTEM|VACUUM|REINDEX)(?:\s|;|$)|^\s*\\(?:connect|c|gexec|i|include|!)(?:\s|$)",
    re.IGNORECASE | re.MULTILINE,
)


class StopInspection(Exception):
    pass


def require(ok, code):
    if not ok:
        raise StopInspection(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect(archive_path, expected_zip_sha256, expected_source_sha, output_path):
    require(re.fullmatch(r"[a-f0-9]{64}", expected_zip_sha256), "invalid_zip_pin")
    require(re.fullmatch(r"[a-f0-9]{40}", expected_source_sha), "invalid_source_pin")
    require(archive_path.is_file() and not archive_path.is_symlink(), "archive_missing")
    require(archive_path.stat().st_size <= MAX_ARCHIVE_BYTES, "archive_too_large")
    passphrase = os.environ.get("KOVA_PRODUCTION_BACKUP_PASSPHRASE", "")
    require(len(passphrase) >= 32, "passphrase_unavailable")
    archive_bytes = archive_path.read_bytes()
    require(digest(archive_bytes) == expected_zip_sha256, "archive_hash_mismatch")

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zipped:
        infos = zipped.infolist()
        require(len(infos) == 2 and {item.filename for item in infos} == EXPECTED_ZIP_MEMBERS,
                "archive_members_invalid")
        require(all(not item.is_dir() and item.file_size <= MAX_ARCHIVE_BYTES for item in infos),
                "archive_members_invalid")
        receipt_bytes = zipped.read("backup-evidence.json")
        encrypted = zipped.read("kova-production-backup.tar.gpg")
    require(len(receipt_bytes) < 16384 and len(encrypted) <= MAX_ARCHIVE_BYTES,
            "archive_members_invalid")
    receipt = json.loads(receipt_bytes)
    require(receipt.get("schemaVersion") == 1 and
            receipt.get("operation") == "supabase-production-logical-backup-evidence" and
            receipt.get("projectRef") == PRODUCTION_REF and
            receipt.get("sourceSha") == expected_source_sha and
            receipt.get("encryptedArchiveSha256") == digest(encrypted) and
            receipt.get("encryptedArchiveBytes") == len(encrypted) and
            receipt.get("plaintextUploaded") is False and
            receipt.get("databaseMutated") is False and
            receipt.get("restoreExercised") is False and
            receipt.get("storageObjectBytesBackedUp") is False and
            receipt.get("authStorageManagedSchemaCustomizationBackupComplete") is False,
            "backup_receipt_mismatch")

    # GPG reads the ciphertext from a regular 0600 file. It emits plaintext
    # only into this process's bounded pipe and never writes a decrypted tar.
    with tempfile.TemporaryDirectory(prefix="kova-recovery-") as tmp:
        os.chmod(tmp, 0o700)
        cipher_path = Path(tmp, "payload.gpg")
        cipher_path.write_bytes(encrypted)
        os.chmod(cipher_path, 0o600)
        child_env = os.environ.copy()
        child_env.pop("KOVA_PRODUCTION_BACKUP_PASSPHRASE", None)
        proc = subprocess.Popen(
            ["gpg", "--no-options", "--homedir", tmp, "--batch", "--quiet",
             "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--decrypt", str(cipher_path)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=child_env,
        )
        try:
            proc.stdin.write(passphrase.encode("utf-8") + b"\n")
            proc.stdin.close()
            deadline = time.monotonic() + 30
            plaintext_chunks = []
            bytes_read = 0
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, "decrypt_timeout")
                ready, _, _ = select.select([proc.stdout], [], [], remaining)
                require(bool(ready), "decrypt_timeout")
                chunk = os.read(proc.stdout.fileno(), min(65536, MAX_ARCHIVE_BYTES - bytes_read + 1))
                if not chunk:
                    break
                bytes_read += len(chunk)
                require(bytes_read <= MAX_ARCHIVE_BYTES, "plaintext_too_large")
                plaintext_chunks.append(chunk)
            require(proc.wait(timeout=max(0.1, deadline - time.monotonic())) == 0,
                    "decrypt_failed")
            plaintext = b"".join(plaintext_chunks)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            proc.stdout.close()

    with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:*") as tar:
        members = tar.getmembers()
        require(len(members) == 6 and {item.name for item in members} == EXPECTED_MEMBERS and
                all(item.isfile() and item.size <= MAX_ARCHIVE_BYTES for item in members),
                "payload_members_invalid")
        files = {member.name: tar.extractfile(member).read() for member in members}
    manifest_bytes = files.pop("manifest.json")
    require(len(manifest_bytes) < 16384, "manifest_invalid")
    manifest = json.loads(manifest_bytes)
    require(manifest.get("schemaVersion") == 1 and
            manifest.get("operation") == "supabase-production-logical-backup" and
            manifest.get("projectRef") == PRODUCTION_REF and
            manifest.get("sourceSha") == expected_source_sha and
            manifest.get("includesStorageObjectBytes") is False and
            manifest.get("includesAuthStorageManagedSchemaCustomizations") is False and
            manifest.get("restoreExercised") is False,
            "manifest_invalid")
    entries = manifest.get("files")
    require(isinstance(entries, list) and len(entries) == 5 and
            {row.get("name") for row in entries if isinstance(row, dict)} == set(files),
            "manifest_files_invalid")
    for row in entries:
        data = files[row["name"]]
        require(row.get("bytes") == len(data) and row.get("sha256") == digest(data),
                "payload_hash_mismatch")

    result = {
        "kind": "kova-encrypted-backup-private-inspection",
        "projectRef": PRODUCTION_REF,
        "sourceSha": expected_source_sha,
        "zipSha256": expected_zip_sha256,
        "encryptedSha256": digest(encrypted),
        "manifestSha256": digest(manifest_bytes),
        "sqlPayloadsVerified": 5,
        "potentialNontransactionalSqlPresent": any(UNSAFE_SQL.search(data) for data in files.values()),
        "transactionCompatibility": "requires_manual_review",
        "storageObjectBytesIncluded": False,
        "managedSchemaCustomizationsIncluded": False,
        "decryptionAndHashVerificationSucceeded": True,
        "restorePerformed": False,
        "plaintextArtifactWritten": False,
    }
    script_path = Path(__file__).resolve()
    # A standalone copy in ~/Downloads has no repository root. Its third
    # ancestor could be /Users, which would reject a private ~/Documents receipt.
    if (script_path.parent.name == "release" and
            script_path.parent.parent.name == "scripts"):
        repo_root = script_path.parents[2]
        if (repo_root / "package.json").is_file():
            require(not output_path.resolve().is_relative_to(repo_root),
                    "receipt_must_be_private")
    require(output_path.parent.is_dir() and not output_path.parent.is_symlink() and
            output_path.parent.stat().st_mode & 0o077 == 0, "receipt_directory_not_private")
    require(not output_path.exists() and not output_path.is_symlink(), "receipt_exists")
    fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--expected-zip-sha256", required=True)
    parser.add_argument("--expected-source-sha", required=True)
    parser.add_argument("--private-receipt", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.zip, args.expected_zip_sha256,
                         args.expected_source_sha, args.private_receipt)
    except (StopInspection, OSError, ValueError, KeyError, zipfile.BadZipFile, tarfile.TarError,
            subprocess.SubprocessError):
        print("Backup inspection stopped; check private operator logs and pins.", file=sys.stderr)
        return 1
    print("Backup decryption and five payload hashes verified; no restore performed.")
    print("Private receipt SHA-256:", digest(args.private_receipt.read_bytes()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
