#!/usr/bin/python3
"""Root-only oneshot: managed identity to versioned host secrets, never stdout."""
import json
import os
import pathlib
import re
import sys
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise ValueError("redirect_denied")


def fetch_json(url, headers, *, metadata=False):
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}) if metadata else urllib.request.ProxyHandler(),
        NoRedirect(),
    )
    request = urllib.request.Request(url, headers=headers)
    with opener.open(request, timeout=20) as response:
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("oversized_response")
        return json.loads(raw)


def quote(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ValueError("invalid_environment_value")
    if any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise ValueError("invalid_environment_value")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def load(config, output):
    if os.geteuid() != 0:
        raise ValueError("root_required")
    vault = config["vault"]
    if not re.fullmatch(r"[a-zA-Z0-9-]{3,24}", vault):
        raise ValueError("invalid_vault")
    expected = {
        "KOVA_WORK_RUNNER_TOKEN": "runner-token",
        "KOVA_WORK_RUNNER_SIGNING_KEY": "runner-signing-key",
        "KOVA_WORK_PROVIDER_KEY": "provider-key",
    }
    if set(config["secrets"]) != set(expected):
        raise ValueError("invalid_secret_set")
    for key, name in expected.items():
        if not re.fullmatch(
            rf"https://{re.escape(vault)}\.vault\.azure\.net/secrets/{name}/[a-f0-9]{{32}}",
            config["secrets"][key],
        ):
            raise ValueError("invalid_versioned_reference")
    env = config["environment"].copy()
    if any(not re.fullmatch(r"KOVA_WORK_[A-Z0-9_]+", k) for k in env):
        raise ValueError("invalid_environment_key")
    if set(env).intersection(expected):
        raise ValueError("credential_in_public_environment")
    for value in env.values():
        quote(value)
    token = fetch_json(
        "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource="
        + urllib.parse.quote("https://vault.azure.net", safe=""),
        {"Metadata": "true"},
        metadata=True,
    )["access_token"]
    for key in expected:
        secret = fetch_json(
            config["secrets"][key] + "?api-version=7.4",
            {"Authorization": "Bearer " + token},
        )["value"]
        quote(secret)
        if len(secret) < (64 if key != "KOVA_WORK_PROVIDER_KEY" else 16):
            raise ValueError("invalid_secret")
        env[key] = secret
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Never follow a pre-existing staging symlink, and publish atomically.
    temporary = output.with_suffix(".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write("".join(key + "=" + quote(value) + "\n" for key, value in env.items()))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        path = pathlib.Path("/etc/kova-work/host.json")
        if path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
            raise ValueError("untrusted_configuration")
        load(json.loads(path.read_text()), pathlib.Path("/run/kova-work/runner.env"))
    except Exception:
        # No exception bodies, response bodies, tokens, URLs or credentials.
        sys.stderr.write("Work secret initialization failed.\n")
        sys.exit(1)
