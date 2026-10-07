#!/usr/bin/env bash
set -euo pipefail

# Hosted CI only. Never run this installer in the owner's capture environment.
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" ]]; then
  echo "Browser installation is restricted to GitHub-hosted Linux CI." >&2
  exit 1
fi
if [[ "$#" -eq 0 ]]; then
  echo "At least one browser is required." >&2
  exit 1
fi
for browser in "$@"; do
  case "$browser" in chromium|firefox|webkit) ;; *) echo "Unsupported browser: $browser" >&2; exit 1 ;; esac
done

# The runner's Azure HTTP mirror repeatedly stalled package-index downloads.
# Keep the existing official Ubuntu HTTPS fallbacks and all signature/TLS checks.
# Upstream layout: actions/runner-images images/ubuntu/scripts/build/configure-apt-sources.sh
mirror_file=/etc/apt/apt-mirrors.txt
if [[ ! -f "$mirror_file" ]] || ! grep -Eq '^https://archive[.]ubuntu[.]com/ubuntu/?([[:space:]]|$)' "$mirror_file"; then
  echo "Expected hosted-runner Ubuntu HTTPS mirror is absent; refusing to rewrite sources." >&2
  exit 1
fi
sudo -n sed -i '\|^http://azure[.]archive[.]ubuntu[.]com/ubuntu/|d' "$mirror_file"
printf '%s\n' \
  'Acquire::Retries "1";' \
  'Acquire::http::Timeout "20";' \
  'Acquire::https::Timeout "20";' \
  | sudo -n tee /etc/apt/apt.conf.d/99-kova-ci-download-timeouts >/dev/null

timeout --signal=TERM --kill-after=10s 360s npx --no-install playwright install --with-deps "$@"
