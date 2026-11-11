#!/usr/bin/env bash
# Install the pinned Playwright browsers and the usual signed OS dependencies.
# If the Ubuntu APT network is unavailable, run the real browser tests using
# already-present runner libraries; do not skip tests or mask browser failures.
set -euo pipefail
if [[ "$#" -eq 0 ]]; then
  echo "::error::At least one Playwright browser is required"
  exit 64
fi
# Official, version-matched CI image includes native libraries and pinned browsers.
# Verify each requested browser is present; Playwright will fail if it is not.
if [[ "${PLAYWRIGHT_BROWSERS_PATH:-}" == "/ms-playwright" ]]; then
  npx --no-install playwright install "$@"
  exit 0
fi
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  printf 'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\n' |
    sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi
if timeout 8 getent ahostsv4 archive.ubuntu.com >/dev/null ||
   timeout 8 getent ahostsv4 security.ubuntu.com >/dev/null; then
  if timeout --signal=TERM --kill-after=10s 240s npx --no-install playwright install --with-deps "$@"; then
    exit 0
  fi
  echo "::warning::Ubuntu package installation failed; exercising the browsers against installed runner libraries instead."
else
  echo "::warning::Ubuntu package mirrors are not resolving; attempting pinned browsers with runner-provided libraries."
fi
# Browser launch and the full Playwright tests are the acceptance gates. A
# missing library/browser produces a genuine failing test, never a skipped job.
npx --no-install playwright install "$@"
