import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("loader", pathlib.Path(__file__).with_name("load-secrets.py"))
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class SecretLoadingTests(unittest.TestCase):
    def config(self):
        return {
            "vault": "kv-kova-test",
            "environment": {"KOVA_WORK_RUNNER_ENABLED": "true"},
            "secrets": {
                key: "https://kv-kova-test.vault.azure.net/secrets/" + name + "/" + "a" * 32
                for key, name in {
                    "KOVA_WORK_RUNNER_TOKEN": "runner-token",
                    "KOVA_WORK_RUNNER_SIGNING_KEY": "runner-signing-key",
                    "KOVA_WORK_PROVIDER_KEY": "provider-key",
                }.items()
            },
        }

    def test_untrusted_destination_rejected_before_identity_request(self):
        for uri in ["https://other.vault.azure.net/secrets/provider-key/" + "a" * 32,
                    "https://kv-kova-test.vault.azure.net/secrets/provider-key/latest",
                    "http://127.0.0.1/secret"]:
            cfg = self.config()
            cfg["secrets"]["KOVA_WORK_PROVIDER_KEY"] = uri
            with patch.object(loader.os, "geteuid", return_value=0), patch.object(loader, "fetch_json") as fetch:
                with self.assertRaises(ValueError):
                    loader.load(cfg, pathlib.Path("/must-not-be-written"))
                fetch.assert_not_called()

    def test_atomic_private_environment_and_failed_refresh_preserves_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "runner.env"
            def fetch(url, headers, **kwargs):
                return {"access_token": "test-only-token"} if kwargs.get("metadata") else {"value": "test-only-value-" * 5}
            with patch.object(loader.os, "geteuid", return_value=0), patch.object(loader, "fetch_json", side_effect=fetch):
                loader.load(self.config(), target)
            previous = target.read_bytes()
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertIn(b'KOVA_WORK_RUNNER_ENABLED="true"', previous)
            with patch.object(loader.os, "geteuid", return_value=0), patch.object(loader, "fetch_json", side_effect=RuntimeError("unavailable")):
                with self.assertRaises(RuntimeError):
                    loader.load(self.config(), target)
            self.assertEqual(target.read_bytes(), previous)

    def test_redirects_and_environment_injection_fail_closed(self):
        with self.assertRaises(ValueError):
            loader.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.invalid")
        for value in ["a\nOTHER=value", "a\x00b", "", "a" * 4097]:
            with self.assertRaises(ValueError):
                loader.quote(value)
        self.assertEqual(loader.quote('a"b\\c'), '"a\\"b\\\\c"')


if __name__ == "__main__":
    unittest.main()
