# Build only in the credential-free preparation workflow. BASE_IMAGE must be
# the actually measured official ubuntu@sha256 digest, never a mutable tag.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG SOURCE_SHA
LABEL org.opencontainers.image.title="Kova isolated recovery operator client" \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      org.kova.recovery.scope="generic-data-free-tooling"
SHELL ["/bin/bash", "-o", "pipefail", "-ceu"]
# Bootstrap CA/GPG from signed Ubuntu indices before switching to HTTPS:
# the minimal base may not yet have TLS roots. The full archive key is scoped.
RUN . /etc/os-release; \
    [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && "$VERSION_CODENAME" == noble ]]; \
    [[ "$(dpkg --print-architecture)" == amd64 ]]; \
    [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; \
    [[ ! -s /etc/apt/sources.list ]]; \
    sources=(/etc/apt/sources.list.d/*); [[ "${#sources[@]}" == 1 && "${sources[0]}" == /etc/apt/sources.list.d/ubuntu.sources ]]; \
    ! grep -Eiq '^(Trusted|Allow-Insecure):[[:space:]]*yes' /etc/apt/sources.list.d/ubuntu.sources; \
    [[ "$(grep -c '^URIs:' /etc/apt/sources.list.d/ubuntu.sources)" == "$(grep -Ec '^URIs: https?://(archive|security)\.ubuntu\.com/ubuntu/?$' /etc/apt/sources.list.d/ubuntu.sources)" ]]; \
    grep -q '^Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg$' /etc/apt/sources.list.d/ubuntu.sources; \
    sed -i 's|^Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg$|Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg F6ECB3762474EDA9D21B7022871920D1991BC93C|' /etc/apt/sources.list.d/ubuntu.sources; \
    apt-get update -qq; \
    selected=(); \
    for package in bash ca-certificates coreutils curl gnupg nodejs python3; do \
      version="$(apt-cache policy "$package" | awk '/Candidate:/ {print $2; exit}')"; \
      [[ -n "$version" && "$version" != '(none)' ]]; \
      selected+=("$package=$version"); \
    done; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${selected[@]}"; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources; \
    install -d -m0755 /usr/share/postgresql-common/pgdg; \
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/kova-pgdg.asc; \
    gpg --batch --show-keys --with-colons /usr/share/postgresql-common/pgdg/kova-pgdg.asc \
      | python3 -c 'import sys;rows=[x.split(":") for x in sys.stdin.read().splitlines()];assert sum(x[0]=="pub" for x in rows)==1;assert next(x[9] for x in rows if x[0]=="fpr")=="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"'; \
    printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' \
      'Suites: noble-pgdg' 'Architectures: amd64' \
      'Signed-By: /usr/share/postgresql-common/pgdg/kova-pgdg.asc' \
      > /etc/apt/sources.list.d/kova-pgdg.sources; \
    apt-get update -qq; \
    version="$(apt-cache policy postgresql-client-17 | awk '/Candidate:/ {print $2; exit}')"; \
    [[ "$version" =~ ^17\.[0-9A-Za-z.+:~_-]+$ ]]; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "postgresql-client-17=$version"; \
    install -d -m0755 /opt/kova-build/apt-inrelease; \
    cp /var/lib/apt/lists/*_InRelease /opt/kova-build/apt-inrelease/; \
    dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort > /opt/kova-build/packages.tsv; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /root/.gnupg /var/log/apt/*
COPY source/ /opt/kova/scripts/release/
ENV PATH="/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    LANG="C.UTF-8" LC_ALL="C.UTF-8" TZ="UTC" PYTHONDONTWRITEBYTECODE="1"
USER 65532:65532
WORKDIR /tmp
HEALTHCHECK NONE
ENTRYPOINT ["python3", "/opt/kova/scripts/release/recovery-operator-client-smoke.py"]
