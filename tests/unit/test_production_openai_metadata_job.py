import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("openai_metadata_job", ROOT / "scripts/azure/production-openai-metadata-job.py")
JOB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(JOB)
SOURCE = "a" * 40


def environment(folder):
    return {"GITHUB_SHA": SOURCE, "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": "Blockigaming/KovaGPT",
        "KOVA_METADATA_CONFIRMATION": "READ_OPENAI_METADATA_ONLY", "KOVA_APPROVED_SOURCE_SHA": SOURCE,
        "KOVA_METADATA_SUBSCRIPTION_ID": "00000000-0000-0000-0000-000000000001",
        "KOVA_METADATA_RESOURCE_GROUP": "rg-kovagpt-prod", "KOVA_METADATA_CONTAINER_APP": "kovagpt-prod-web",
        "RUNNER_TEMP": folder, "PATH": os.environ["PATH"], "HOME": folder,
        "GITHUB_TOKEN": "synthetic-github-token", "KOVA_PRODUCTION_BACKUP_PASSPHRASE": "x" * 32}


class FakeCrypto:
    def __init__(self, *, decrypt_failure=False):
        self.commands = []
        self.decrypt_failure = decrypt_failure
        self.decrypts = 0

    @staticmethod
    def passphrase(env):
        return JOB.load_crypto().passphrase(env)

    @staticmethod
    def clean_pg_env(env):
        return {"PATH": env["PATH"], "HOME": env["HOME"]}

    @staticmethod
    def fresh_file(path, data):
        path.write_bytes(data)
        path.chmod(0o600)

    def run(self, argv, env, timeout):
        self.commands.append((argv, env))
        if argv[0] == "git":
            return (SOURCE + "\n").encode()
        if argv[0] == "gpg":
            return b"gpg (GnuPG) fixture\n"
        if argv[0] == "node":
            return json.dumps({"operation": "openai-model-list-metadata-only", "generationRequests": 0,
                "applicationChanges": 0, "elevenLabsVaultReads": 0, "elevenLabsProviderGets": 0,
                "openAI": {"status": "synthetic-not-live"}}).encode()
        raise AssertionError("unexpected command")

    def crypt(self, env, phrase, source, dest, decrypt=False):
        if decrypt:
            self.decrypts += 1
            if self.decrypt_failure and self.decrypts == 2:
                raise RuntimeError("synthetic private encryption failure")
        dest.write_bytes(source.read_bytes())
        dest.chmod(0o600)


class ProductionOpenAiMetadataBoundary(unittest.TestCase):
    def test_default_off_and_public_error_are_fixed(self):
        with mock.patch.object(JOB, "operate") as operation, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(JOB.main([]), 0)
            operation.assert_not_called()
            self.assertEqual(output.getvalue(), '{"enabled":false}\n')
        with mock.patch.object(JOB, "operate", side_effect=RuntimeError("synthetic-private-detail")), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(JOB.main(["--execute"]), 1)
            self.assertEqual(output.getvalue(), '{"ok":false,"error":"production_metadata_job_unqualified"}\n')

    def test_context_refuses_unapproved_or_changed_source_before_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            valid = environment(folder)
            self.assertEqual(JOB.validate_context(valid, SOURCE), SOURCE)
            for name, value in {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/topic",
                "GITHUB_REPOSITORY": "someone/fork", "KOVA_METADATA_CONFIRMATION": "",
                "KOVA_APPROVED_SOURCE_SHA": "b" * 40, "NODE_OPTIONS": "--inspect"}.items():
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    JOB.validate_context({**valid, name: value}, SOURCE)
            with self.assertRaises(RuntimeError):
                JOB.validate_context(valid, "b" * 40)

    def test_missing_invalid_encryption_secret_stops_before_cloud_or_provider(self):
        with tempfile.TemporaryDirectory() as folder:
            for phrase in ("", "x" * 31, "x" * 32 + "\n"):
                crypto = FakeCrypto()
                current = mock.Mock()
                with self.assertRaises(Exception):
                    JOB.operate("--check", {**environment(folder), "KOVA_PRODUCTION_BACKUP_PASSPHRASE": phrase}, crypto=crypto, current_main=current)
                self.assertEqual(crypto.commands, [])
                current.assert_not_called()

    def test_unavailable_gpg_stops_before_source_network_or_provider(self):
        with tempfile.TemporaryDirectory() as folder:
            crypto = FakeCrypto()
            original = crypto.run
            crypto.run = lambda argv, env, timeout: (_ for _ in ()).throw(RuntimeError("gpg unavailable")) if argv[0] == "gpg" else original(argv, env, timeout)
            current = mock.Mock()
            with self.assertRaises(RuntimeError):
                JOB.operate("--check", environment(folder), crypto=crypto, current_main=current)
            current.assert_not_called()
            self.assertFalse(any(argv[0] == "node" for argv, _ in crypto.commands))

    def test_only_ciphertext_survives_and_node_does_not_inherit_other_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            crypto = FakeCrypto()
            current = mock.Mock()
            JOB.operate("--execute", environment(folder), crypto=crypto, current_main=current)
            self.assertEqual([str(p.relative_to(folder)) for p in Path(folder).rglob("*") if p.is_file()], ["production-openai-private/receipt.json.gpg"])
            current.assert_called_once()
            argv, child = next((argv, env) for argv, env in crypto.commands if argv[0] == "node")
            self.assertNotIn("KOVA_PRODUCTION_BACKUP_PASSPHRASE", child)
            self.assertNotIn("GITHUB_TOKEN", child)
            self.assertIn("production-openai-only-metadata-preflight.mjs", argv[1])

    def test_failed_encryption_confirmation_removes_partial_output(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError):
                JOB.operate("--execute", environment(folder), crypto=FakeCrypto(decrypt_failure=True), current_main=mock.Mock())
            self.assertEqual([p for p in Path(folder).rglob("*") if p.is_file()], [])

    def test_workflow_is_main_only_protected_ciphertext_only_and_bounded(self):
        workflow = (ROOT / ".github/workflows/read-production-openai-metadata.yml").read_text()
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertIn("github.event_name == 'workflow_dispatch'", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("inputs.source_sha == github.sha", workflow)
        self.assertIn("name: production", workflow)
        self.assertIn("node-version: 24", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertLess(workflow.index("--check"), workflow.index("azure/login@"))
        for name in ("KOVAGPTPROD_AZURE_CLIENT_ID", "KOVAGPTPROD_AZURE_TENANT_ID", "KOVAGPTPROD_AZURE_SUBSCRIPTION_ID", "KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926"):
            self.assertIn("secrets." + name, workflow)
        self.assertIn("45s python3 scripts/azure/production-openai-metadata-job.py --execute", workflow)
        self.assertIn("path: ${{ runner.temp }}/production-openai-private/receipt.json.gpg", workflow)
        self.assertNotIn("if: always()", workflow)
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL", workflow)


if __name__ == "__main__":
    unittest.main()
