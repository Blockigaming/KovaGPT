#!/usr/bin/env bash
# Install the exact Playwright browsers and native dependencies, using only
# Ubuntu's existing signed archive mirrors. Do not waive tests on network errors.
set -euo pipefail

if (( $# == 0 )); then
  echo "At least one Playwright browser is required" >&2
  exit 64
fi

# GitHub runners can have a different apt layout. Preserve that layout when
# the reviewed apt-mirrors file is absent.
if [[ ! -f /etc/apt/apt-mirrors.txt ]]; then
  exec npx --no-install playwright install --with-deps "$@"
fi

source /etc/os-release
if [[ -z "${VERSION_CODENAME:-}" ]]; then
  echo "::error::Cannot determine the Ubuntu release for a signed mirror check" >&2
  exit 1
fi

# The default Ubuntu archive has repeatedly failed DNS on hosted runners.
# The runner's original mirror configuration is the first signed APT source;
# an alternate official mirror is attempted only when that real install fails.
# Avoid curl HEAD probes: they can reject valid APT endpoints on cloud runners.
original_mirrors="$(cat /etc/apt/apt-mirrors.txt)"
if timeout --signal=TERM --kill-after=10s 360s \
    npx --no-install playwright install --with-deps "$@"; then
  exit 0
fi
echo "::warning::Runner's signed Ubuntu mirror could not install browser dependencies" >&2

if [[ "$original_mirrors" == *"azure.archive.ubuntu.com"* ]]; then
  fallback="https://archive.ubuntu.com/ubuntu/"
else
  fallback="https://azure.archive.ubuntu.com/ubuntu/"
fi
printf '%s\tpriority:1\n%s\tpriority:2\n' \
  "$fallback" "https://security.ubuntu.com/ubuntu/" \
  | sudo tee /etc/apt/apt-mirrors.txt >/dev/null

if timeout --signal=TERM --kill-after=10s 360s \
    npx --no-install playwright install --with-deps "$@"; then
  exit 0
fi

# Leave this ephemeral runner with its original approved signed sources.
printf '%s\n' "$original_mirrors" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
echo "::error::Both runner-default and alternate signed Ubuntu mirrors failed browser installation" >&2
exit 1
