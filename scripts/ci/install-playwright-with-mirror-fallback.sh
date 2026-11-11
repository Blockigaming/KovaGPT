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

# The default Ubuntu archive repeatedly failed DNS on hosted runners. Probe
# bounded connectivity to official Ubuntu Release metadata before APT runs.
# The Azure archive is the existing runner mirror fallback. APT continues to
# verify the original signed repository metadata and packages.
for mirror in \
  "https://archive.ubuntu.com/ubuntu/" \
  "https://azure.archive.ubuntu.com/ubuntu/"; do
  if ! curl --fail --silent --location --head \
      --connect-timeout 5 --max-time 12 \
      "${mirror}dists/${VERSION_CODENAME}/InRelease" >/dev/null 2>&1; then
    echo "Ubuntu mirror is unreachable; testing next reviewed mirror: ${mirror}" >&2
    continue
  fi

  printf '%s\tpriority:1\n%s\tpriority:2\n' \
    "${mirror}" "https://security.ubuntu.com/ubuntu/" \
    | sudo tee /etc/apt/apt-mirrors.txt >/dev/null

  # Bound upstream stalls. If installation fails, attempt the second reviewed
  # mirror. Do not skip missing browser/native dependencies or CI tests.
  if timeout --signal=TERM --kill-after=10s 420s \
      npx --no-install playwright install --with-deps "$@"; then
    exit 0
  fi
  echo "Browser dependency installation failed on ${mirror}; trying fallback" >&2
done

echo "::error::Both reviewed signed Ubuntu mirrors failed browser installation" >&2
exit 1
