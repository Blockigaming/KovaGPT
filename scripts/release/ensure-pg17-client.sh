#!/usr/bin/env bash
# Secret-free prerequisite for the protected Google migration transport.
set -euo pipefail

pg17_bin=/usr/lib/postgresql/17/bin
if [[ ! -x "$pg17_bin/psql" ]]; then
  # This workflow intentionally uses the supported Ubuntu 24.04 amd64 runner.
  . /etc/os-release
  [[ "$ID:$VERSION_CODENAME" == ubuntu:noble ]]
  [[ "$(dpkg --print-architecture)" == amd64 ]]
  pgdg_key=$(mktemp)
  trap 'rm -f "$pgdg_key"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 30 \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc --output "$pgdg_key"
  fingerprint=$(gpg --batch --show-keys --with-colons "$pgdg_key" | awk -F: '
    $1 == "pub" {keys++; primary = 1}
    $1 == "fpr" && primary {print $10; primary = 0}
    END {if (keys != 1) exit 1}')
  [[ "$fingerprint" == B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]]
  sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
  sudo install -m 0644 "$pgdg_key" /usr/share/postgresql-common/pgdg/kova-pgdg.asc
  printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/postgresql-common/pgdg/kova-pgdg.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' \
    | sudo tee /etc/apt/sources.list.d/kova-pgdg17.list >/dev/null
  # Refresh only this signed vendor index; retain existing Ubuntu indexes for
  # dependencies without contacting the runner's unrelated package mirrors.
  sudo apt-get -o Acquire::Retries=0 -o Acquire::https::Timeout=30 \
    -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/kova-pgdg17.list \
    -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get \
    -o Acquire::Retries=0 -o Acquire::https::Timeout=30 \
    install --yes --no-install-recommends postgresql-client-17
fi

"$pg17_bin/psql" --version | grep -E '^psql \(PostgreSQL\) 17\.'
# Only trusted, package-owned binaries precede the existing runner PATH.
printf '%s\n' "$pg17_bin" >> "$GITHUB_PATH"
