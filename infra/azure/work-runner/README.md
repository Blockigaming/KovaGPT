# Isolated Work host

This additive template creates a dedicated eastus D2as_v4 Ubuntu 24.04 host, a 32 GiB Premium OS disk, a static Standard IPv4 address, a private VNet, an HTTPS-only inbound rule, and a new host-specific vault and identity. It never declares the existing production app, vault, workers, registry or identities.

The template is infrastructure only. It does not install or activate the runner and does not establish browser readiness. Do not route production Work requests to this host until the exact source passes CI, the native gVisor acceptance passes on the host, the signed backend readiness probe succeeds, and authenticated browser navigation and takeover have been verified.

Use an explicit stable Canonical `ubuntu-24_04-lts:server` Gen2 image version. Azure CLI image listing filters are substring matches; verify the returned offer and SKU exactly and exclude daily and Gen1 images. Never supply `latest`. Public SSH is denied. Keep recovery on the Azure management plane.

Supply transport credentials and the provider credential as secure deployment parameters without terminal output, command-line literals, committed parameter files, or debug logging. The VM identity receives Secrets User on each of the three new secrets only. No role changes to the existing production vault are required. Deployment outputs contain only versioned secret URIs.

Deploy in Incremental mode only after inspecting the what-if and confirming all resources are new and in scope. If submission times out, reconcile the deployment before retrying. This template intentionally retains the disk and NIC on VM removal; stopped compute still incurs disk and public-IP charges. Vault purge protection also persists.

Expected initial cost was approved by the owner conditional on PR #540 CI passing: the dated 2026-10-31 estimate is $79.01/month at 730 compute hours, plus metered usage and tax. This is not a spending cap. Provisioning must wait for that CI condition.

Before activation, install pinned trusted dependencies and immutable local browser/Python images without using another release’s paid ACR allowance. Keep secrets and durable attempt state outside all sandbox mounts. Use a publicly trusted HTTPS listener on 443 and a verified private TLS connection to the runner; do not disable certificate verification. Preserve existing production release coordination holds when binding the app.

## Runtime staging

`bootstrap.sh <qualified-source-sha>` runs only as root on the new empty Ubuntu 24.04 x64 host. It verifies the fetched Git commit, installs signed Node24/Caddy/Docker packages, pins the exact installed package versions, verifies the same gVisor release checksum as native CI, builds local immutable images, and runs both native acceptance programs. It refuses existing source or activation markers and enabled swap. It does not activate Work. A partially failed installation must be reconciled before a retry; do not remove state blindly.

Copy the reviewed host tools to a root-owned directory, then run `configure-host.py <public-manifest.json>`. The manifest contains `hostname`, `build`, `runnerId`, `models`, `vault`, and `secrets` mapping the three KOVA_WORK credential variable names to their exact versioned secret URIs. It contains no credential values. Models must match the live app's reviewed role configuration. The script installs the inactive systemd services, generates private upstream TLS, and configures Caddy with TLS-ALPN on443 and no HTTP challenge/redirect listener. The internal leaf expires after365days and requires rotation before expiry. Public certificate renewal is managed by Caddy.

The root-only secret initializer requests only a managed identity token and the three exact versioned vault secrets. Redirects, oversized replies, control characters, unexpected destinations and secret names fail closed. It atomically writes a root-only environment file in `/run`, outside durable attempt state and sandbox mounts. A failed refresh preserves the previous file and fails the systemd dependency. To rotate credentials, update the reviewed versioned manifest and restart the secret initializer and runner together.

Do not create `/etc/kova-work/ACTIVATED`, enable the runner, or unmask/start Caddy until source gates, actual native acceptance, required production schema and backend identity configuration qualify. The default Caddy service stays masked during preparation. The runner itself additionally requires a successful signed backend/schema and native isolation probe before opening its listener. After configuration, use systemd unit verification on the actual host; a local executor without Docker or `/usr/bin/node` cannot establish that host's readiness.

Secret loader tests: `python3 -m unittest discover -s infra/azure/work-runner -p 'test_*.py'`. Syntax checks are supplementary; only actual host acceptance proves the installed isolation runtime.
