# Isolated Work host

This additive template creates a dedicated eastus D2as_v4 Ubuntu 24.04 host, a 32 GiB Premium OS disk, a static Standard IPv4 address, a private VNet, an HTTPS-only inbound rule, and a new host-specific vault and identity. It never declares the existing production app, vault, workers, registry or identities.

The template is infrastructure only. It does not install or activate the runner and does not establish browser readiness. Do not route production Work requests to this host until the exact source passes CI, the native gVisor acceptance passes on the host, the signed backend readiness probe succeeds, and authenticated browser navigation and takeover have been verified.

Use an explicit stable Canonical `ubuntu-24_04-lts:server` Gen2 image version. Azure CLI image listing filters are substring matches; verify the returned offer and SKU exactly and exclude daily and Gen1 images. Never supply `latest`. Public SSH is denied. Keep recovery on the Azure management plane.

Supply transport credentials and the provider credential as secure deployment parameters without terminal output, command-line literals, committed parameter files, or debug logging. The VM identity receives Secrets User on each of the three new secrets only. No role changes to the existing production vault are required. Deployment outputs contain only versioned secret URIs.

Deploy in Incremental mode only after inspecting the what-if and confirming all resources are new and in scope. If submission times out, reconcile the deployment before retrying. This template intentionally retains the disk and NIC on VM removal; stopped compute still incurs disk and public-IP charges. Vault purge protection also persists.

Expected initial cost was approved by the owner conditional on PR #540 CI passing: the dated 2026-10-31 estimate is $79.01/month at 730 compute hours, plus metered usage and tax. This is not a spending cap. Provisioning must wait for that CI condition.

Before activation, install pinned trusted dependencies and immutable local browser/Python images without using another release’s paid ACR allowance. Keep secrets and durable attempt state outside all sandbox mounts. Use a publicly trusted HTTPS listener on 443 and a verified private TLS connection to the runner; do not disable certificate verification. Preserve existing production release coordination holds when binding the app.
