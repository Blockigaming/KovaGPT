#!/usr/bin/python3
"""Install public host configuration and private TLS, without activating Work."""
import grp
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import uuid


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main(manifest_path):
    if os.geteuid() != 0:
        raise ValueError("root_required")
    root = pathlib.Path("/etc/kova-work")
    if (root / "ACTIVATED").exists() or (root / "host.json").exists():
        raise ValueError("already_configured")
    manifest = json.loads(pathlib.Path(manifest_path).read_text())
    hostname = manifest["hostname"]
    if not re.fullmatch(r"kovagpt-work-540-[a-z0-9-]+\.eastus\.cloudapp\.azure\.com", hostname):
        raise ValueError("invalid_host")
    build = (root / "source-sha").read_text().strip()
    if manifest["build"] != build or not re.fullmatch(r"[a-f0-9]{40}", build):
        raise ValueError("source_mismatch")
    runner_id = str(uuid.UUID(manifest["runnerId"]))
    models = manifest["models"]
    if not isinstance(models, list) or not 1 <= len(models) <= 20 or len(set(models)) != len(models):
        raise ValueError("invalid_models")
    if any(not re.fullmatch(r"[a-zA-Z0-9._:-]{1,100}", model) for model in models):
        raise ValueError("invalid_models")
    images = {}
    for kind in ["python", "browser"]:
        images[kind] = (root / (kind + "-image")).read_text().strip()
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", images[kind]):
            raise ValueError("invalid_image")
    # This is the reviewed provider URL; never accept an arbitrary manifest URL.
    config = {
        "vault": manifest["vault"],
        "secrets": manifest["secrets"],
        "environment": {
            "KOVA_WORK_RUNNER_ENABLED": "true",
            "KOVA_WORK_RUNNER_ORIGIN": "https://" + hostname,
            "KOVA_WORK_RUNNER_ID": runner_id,
            "KOVA_WORK_RUNNER_BUILD": build,
            "KOVA_WORK_BACKEND_ORIGIN": "https://kovagpt.com",
            "KOVA_WORK_RESPONSES_URL": "https://api.openai.com/v1/responses",
            "KOVA_WORK_MODELS": ",".join(models),
            "KOVA_WORK_SANDBOX_IMAGE": images["python"],
            "KOVA_WORK_BROWSER_IMAGE": images["browser"],
            "KOVA_WORK_BROWSER_ENABLED": "true",
            "KOVA_WORK_BROWSER_PUBLIC_WEB": "true",
            "KOVA_WORK_BROWSER_ORIGINS_JSON": "[]",
            "KOVA_WORK_STATE_DIR": "/var/lib/kova-work/state",
            "KOVA_WORK_TLS_KEY_FILE": "/etc/kova-work/tls/server.key",
            "KOVA_WORK_TLS_CERT_FILE": "/etc/kova-work/tls/server.crt",
            "KOVA_WORK_LISTEN_PORT": "8443",
        },
    }
    tools = pathlib.Path(__file__).resolve().parent
    os.chown(root, 0, grp.getgrnam("kova-work").gr_gid)
    root.chmod(0o750)
    tls = root / "tls"
    tls.mkdir(mode=0o750)
    os.chown(tls, 0, grp.getgrnam("kova-work").gr_gid)
    run("openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "3650",
        "-subj", "/CN=Kova Work upstream CA", "-keyout", str(tls / "ca.key"), "-out", str(tls / "ca.crt"),
        "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    run("openssl", "req", "-newkey", "rsa:3072", "-nodes", "-subj", "/CN=localhost",
        "-keyout", str(tls / "server.key"), "-out", str(tls / "server.csr"))
    extensions = tls / "server.ext"
    extensions.write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
    run("openssl", "x509", "-req", "-days", "365", "-in", str(tls / "server.csr"),
        "-CA", str(tls / "ca.crt"), "-CAkey", str(tls / "ca.key"), "-CAcreateserial",
        "-out", str(tls / "server.crt"), "-extfile", str(extensions))
    for name in ["server.key", "server.crt"]:
        os.chown(tls / name, 0, grp.getgrnam("kova-work").gr_gid)
        (tls / name).chmod(0o640)
    (tls / "ca.key").chmod(0o600)
    shutil.copyfile(tls / "ca.crt", "/etc/caddy/kova-upstream-ca.crt")
    pathlib.Path("/etc/caddy/kova-upstream-ca.crt").chmod(0o644)
    caddy = """{
    admin off
    auto_https disable_redirects
}
https://HOSTNAME {
    tls {
        issuer acme {
            dir https://acme-v02.api.letsencrypt.org/directory
            disable_http_challenge
        }
    }
    reverse_proxy https://127.0.0.1:8443 {
        transport http {
            tls_trust_pool file /etc/caddy/kova-upstream-ca.crt
            tls_server_name localhost
        }
    }
}
""".replace("HOSTNAME", hostname)
    pathlib.Path("/etc/caddy/Caddyfile").write_text(caddy)
    pathlib.Path("/etc/caddy/Caddyfile").chmod(0o644)
    # Adapt checks syntax without obtaining a certificate or accepting traffic.
    run("caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
    for name in ["kova-work.service", "kova-work-secrets.service"]:
        shutil.copyfile(tools / name, pathlib.Path("/etc/systemd/system") / name)
    shutil.copyfile(tools / "load-secrets.py", "/usr/local/lib/kova-work/load-secrets.py")
    pathlib.Path("/usr/local/lib/kova-work/load-secrets.py").chmod(0o644)
    (root / "host.json").write_text(json.dumps(config, indent=2) + "\n")
    (root / "host.json").chmod(0o600)
    run("systemctl", "daemon-reload")
    print("Host configured; services remain inactive. Internal TLS leaf expires in 365 days.")


if __name__ == "__main__":
    try:
        os.umask(0o077)
        if len(sys.argv) != 2:
            raise ValueError("manifest_required")
        main(sys.argv[1])
    except Exception:
        sys.stderr.write("Host configuration failed; inspect the public manifest and installation state.\n")
        sys.exit(1)
