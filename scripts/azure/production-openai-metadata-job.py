#!/usr/bin/env python3
"""One metadata operation; public stdout is fixed, uploaded output is ciphertext."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[a-f0-9]{40}\Z")
UNSAFE_NODE = ("NODE_OPTIONS", "NODE_DEBUG", "NODE_DEBUG_NATIVE", "NODE_V8_COVERAGE", "SSLKEYLOGFILE", "NODE_EXTRA_CA_CERTS")


def require(ok):
    if not ok:
        raise RuntimeError("production_metadata_job_unqualified")


def validate_context(env, head):
    source = env.get("GITHUB_SHA", "")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_REPOSITORY") == "Blockigaming/KovaGPT"
            and env.get("KOVA_METADATA_CONFIRMATION") == "READ_OPENAI_METADATA_ONLY"
            and SHA.fullmatch(source) and env.get("KOVA_APPROVED_SOURCE_SHA") == source
            and re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", env.get("KOVA_METADATA_SUBSCRIPTION_ID", ""))
            and env.get("KOVA_METADATA_RESOURCE_GROUP") == "rg-kovagpt-prod"
            and env.get("KOVA_METADATA_CONTAINER_APP") == "kovagpt-prod-web"
            and head == source and not any(env.get(name) for name in UNSAFE_NODE)
            and env.get("NODE_TLS_REJECT_UNAUTHORIZED", "1") == "1")
    return source


def load_crypto():
    spec = importlib.util.spec_from_file_location("kova_existing_recovery_crypto", ROOT / "scripts/release/managed-auth-recovery.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError("production_metadata_job_unqualified")


def require_current_main(env, source):
    token = env.get("GITHUB_TOKEN", "")
    require(bool(token))
    url = "https://api.github.com/repos/Blockigaming/KovaGPT/git/ref/heads/main"
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
        require(response.status == 200 and response.url == url)
        body = response.read(8193)
        require(len(body) <= 8192)
        value = json.loads(body)
        require(value.get("ref") == "refs/heads/main" and value.get("object", {}).get("sha") == source)


def encryption_ready(crypto, env, phrase):
    # Reuse exact existing passphrase validation and AES256 GPG/FD-0 pattern.
    crypto.run(["gpg", "--version"], crypto.clean_pg_env(env), timeout=5)
    with tempfile.TemporaryDirectory(prefix="kova-envelope-check-", dir=env["RUNNER_TEMP"]) as folder:
        work = Path(folder)
        os.chmod(work, 0o700)
        source, cipher, check = work / "fixed.txt", work / "fixed.gpg", work / "check.txt"
        crypto.fresh_file(source, b"kova private metadata envelope\n")
        crypto.crypt(env, phrase, source, cipher)
        crypto.crypt(env, phrase, cipher, check, decrypt=True)
        require(check.read_bytes() == source.read_bytes())


def operate(mode, env, *, crypto=None, current_main=require_current_main):
    require(mode in ("--check", "--execute"))
    crypto = crypto or load_crypto()
    crypto.DEADLINE = time.monotonic() + (18 if mode == "--check" else 42)
    phrase = crypto.passphrase(env)
    require(Path(env.get("RUNNER_TEMP", "")).is_dir())
    head = crypto.run(["git", "rev-parse", "HEAD"], crypto.clean_pg_env(env), timeout=3).decode().strip()
    source = validate_context(env, head)
    encryption_ready(crypto, env, phrase)
    # Recheck after OIDC in --execute; an advanced main never authorizes old code.
    current_main(env, source)
    if mode == "--check":
        return
    output = Path(env["RUNNER_TEMP"]) / "production-openai-private"
    require(not output.exists())
    output.mkdir(mode=0o700)
    ciphertext = output / "receipt.json.gpg"
    success = False
    try:
        with tempfile.TemporaryDirectory(prefix="kova-openai-metadata-", dir=env["RUNNER_TEMP"]) as folder:
            work = Path(folder)
            os.chmod(work, 0o700)
            # Neither backup passphrase nor GitHub token is inherited by Node/az.
            child = {name: value for name, value in env.items() if name in {
                "PATH", "HOME", "AZURE_CONFIG_DIR", "ACC_CLOUD", "MSI_ENDPOINT", "AZUREPS_HOST_ENVIRONMENT",
                "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "KOVA_METADATA_SUBSCRIPTION_ID",
                "KOVA_METADATA_RESOURCE_GROUP", "KOVA_METADATA_CONTAINER_APP"}}
            raw = crypto.run(["node", str(ROOT / "scripts/azure/production-openai-only-metadata-preflight.mjs"),
                "--execute"], child, timeout=28)
            require(len(raw) <= 16384)
            report = json.loads(raw)
            require(report.get("operation") == "openai-model-list-metadata-only"
                and report.get("generationRequests") == 0 and report.get("applicationChanges") == 0
                and report.get("elevenLabsVaultReads") == 0 and report.get("elevenLabsProviderGets") == 0)
            report["workflowSourceSha"] = source
            plain = work / "receipt.json"
            crypto.fresh_file(plain, json.dumps(report, sort_keys=True, separators=(",", ":")).encode())
            crypto.crypt(env, phrase, plain, ciphertext)
            check = work / "receipt-check.json"
            crypto.crypt(env, phrase, ciphertext, check, decrypt=True)
            require(check.read_bytes() == plain.read_bytes())
            success = True
    finally:
        if not success:
            ciphertext.unlink(missing_ok=True)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print('{"enabled":false}')
        return 0
    try:
        require(len(argv) == 1)
        os.umask(0o077)
        operate(argv[0], dict(os.environ))
        print('{"ok":true}')
        return 0
    except Exception:
        print('{"ok":false,"error":"production_metadata_job_unqualified"}')
        return 1


if __name__ == "__main__":
    def interrupted(*_args):
        raise RuntimeError("production_metadata_job_unqualified")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    raise SystemExit(main())
