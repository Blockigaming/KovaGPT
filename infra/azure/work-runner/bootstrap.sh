#!/usr/bin/env bash
# Run on the new, empty dedicated Ubuntu VM, through Azure RunCommand.
# Argument: qualified source commit.
# Never accepts a credential; never activates the service.
set -euo pipefail
umask 077
[[ ${EUID} == 0 && $# == 1 ]]
source_sha=$1
[[ $source_sha =~ ^[a-f0-9]{40}$ ]]
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]]
[[ ! -e /opt/kova-work/source && ! -e /etc/kova-work/ACTIVATED ]]
[[ -z $(swapon --show --noheadings) ]]
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl python3 docker.io docker-buildx bzip2 git
install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error --location --max-time 60 \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --batch --dearmor -o /etc/apt/keyrings/kova-nodesource.gpg
chmod 0644 /etc/apt/keyrings/kova-nodesource.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/etc/apt/keyrings/kova-nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' \
  > /etc/apt/sources.list.d/kova-nodesource.list
curl --fail --silent --show-error --location --max-time 60 \
  https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --batch --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --fail --silent --show-error --location --max-time 60 \
  https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
# Prevent the stock web server from opening a listener before configuration.
systemctl mask caddy.service
apt-get update -qq
node_version=$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}')
caddy_version=$(apt-cache policy caddy | awk '/Candidate:/ {print $2}')
[[ $node_version == 24.* && $caddy_version != '(none)' && -n $caddy_version ]]
apt-get install -y --no-install-recommends "nodejs=$node_version" "caddy=$caddy_version"
apt-mark hold docker.io docker-buildx nodejs caddy
systemctl enable --now docker
# Require the modern builder used by COPY --chmod; never fall back to legacy.
export DOCKER_BUILDKIT=1
docker buildx version >/dev/null

install -d -m 0755 /opt/kova-work /usr/local/lib/kova-work
install -d -m 0700 /etc/kova-work
scratch=$(mktemp -d /opt/kova-work/install.XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 120 \
  https://storage.googleapis.com/gvisor/releases/release/20260831.0/x86_64/gvisor.tar.bz2 \
  -o "$scratch/gvisor.tar.bz2"
printf '%s  %s\n' \
  c7b4f22c60be3ea5a0ace478ed390403255d818729aaccff82d5b60026f3060d2ea31ab6670249a34a98eef59726217018c91ec631f7d753459127d930658392 \
  "$scratch/gvisor.tar.bz2" | sha512sum --check --strict -
tar -xjf "$scratch/gvisor.tar.bz2" -C /usr/local/bin
/usr/local/bin/runsc install
systemctl reload docker
git init -q /opt/kova-work/source
git -C /opt/kova-work/source remote add origin https://github.com/Blockigaming/KovaGPT.git
git -C /opt/kova-work/source fetch --depth=1 origin "$source_sha"
git -C /opt/kova-work/source checkout --detach "$source_sha"
[[ $(git -C /opt/kova-work/source rev-parse HEAD) == "$source_sha" ]]
git -C /opt/kova-work/source fsck --no-reflogs
cd /opt/kova-work/source
# npm lifecycle scripts are intentionally disabled on the trusted host.
npm ci --ignore-scripts --no-audit --no-fund
node work-runner/build.mjs
docker build --iidfile "$scratch/python-image" work-runner/sandbox-image
docker build --iidfile "$scratch/browser-image" work-runner/browser-image
export KOVA_WORK_SANDBOX_IMAGE KOVA_WORK_BROWSER_IMAGE
KOVA_WORK_SANDBOX_IMAGE=$(cat "$scratch/python-image")
KOVA_WORK_BROWSER_IMAGE=$(cat "$scratch/browser-image")
[[ $KOVA_WORK_SANDBOX_IMAGE =~ ^sha256:[a-f0-9]{64}$ && $KOVA_WORK_BROWSER_IMAGE =~ ^sha256:[a-f0-9]{64}$ ]]
node work-runner/sandbox-image/acceptance.mjs --execute
node work-runner/browser-image/acceptance.mjs --execute
useradd --system --home-dir /var/lib/kova-work --shell /usr/sbin/nologin kova-work
usermod -aG docker kova-work
install -d -o kova-work -g kova-work -m 0700 /var/lib/kova-work /var/lib/kova-work/state
# The trusted broker is the only member added to Docker; sandboxes have no
# daemon socket or host-state mounts. Source and configuration remain root-owned.
chmod -R a+rX /opt/kova-work/source
printf '%s\n' "$source_sha" > /etc/kova-work/source-sha
printf '%s\n' "$KOVA_WORK_SANDBOX_IMAGE" > /etc/kova-work/python-image
printf '%s\n' "$KOVA_WORK_BROWSER_IMAGE" > /etc/kova-work/browser-image
dpkg-query -W -f='${Package}=${Version}\n' docker.io nodejs caddy > /etc/kova-work/package-versions
/usr/local/bin/runsc --version > /etc/kova-work/runsc-version
printf '%s\n' 'Native isolation accepted; runtime remains inactive pending TLS, host manifest, backend and release gates.'
