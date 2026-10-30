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
RUN printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-release-read'; \
    . /etc/os-release; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-release-guard'; \
    [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && "$VERSION_CODENAME" == noble ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-architecture-guard'; \
    [[ "$(dpkg --print-architecture)" == amd64 ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-sources-present-guard'; \
    [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-legacy-sources-empty-guard'; \
    [[ ! -s /etc/apt/sources.list ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-source-glob'; \
    sources=(/etc/apt/sources.list.d/*); \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-source-count-guard'; \
    [[ "${#sources[@]}" == 1 && "${sources[0]}" == /etc/apt/sources.list.d/ubuntu.sources ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-insecure-source-guard'; \
    if grep -Eiq '^(Trusted|Allow-Insecure):[[:space:]]*yes' /etc/apt/sources.list.d/ubuntu.sources; then exit 1; fi; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-official-uris-guard'; \
    [[ "$(grep -c '^URIs:' /etc/apt/sources.list.d/ubuntu.sources)" == "$(grep -Ec '^URIs: https?://(archive|security)\.ubuntu\.com/ubuntu/?$' /etc/apt/sources.list.d/ubuntu.sources)" ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-signed-by-guard'; \
    grep -q '^Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg$' /etc/apt/sources.list.d/ubuntu.sources; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-scope-signing-key'; \
    sed -i 's|^Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg$|Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg F6ECB3762474EDA9D21B7022871920D1991BC93C|' /etc/apt/sources.list.d/ubuntu.sources; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-index-refresh'; \
    apt-get update -qq; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-package-list'; \
    selected=(); \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-package-loop'; \
    for package in bash ca-certificates coreutils curl gnupg nodejs python3; do \
      case "$package" in \
        bash) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-bash';; \
        ca-certificates) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-ca-certificates';; \
        coreutils) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-coreutils';; \
        curl) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-curl';; \
        gnupg) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-gnupg';; \
        nodejs) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-nodejs';; \
        python3) printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-candidate-python3';; \
      esac; \
      printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-package-candidate-query'; \
      version="$(apt-cache policy "$package" | awk '/Candidate:/ {print $2; exit}')"; \
      printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-package-version-guard'; \
      [[ -n "$version" && "$version" != '(none)' ]]; \
      printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-package-select'; \
      selected+=("$package=$version"); \
    done; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-packages-install'; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${selected[@]}"; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=ubuntu-enable-https'; \
    sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pgdg-key-directory'; \
    install -d -m0755 /usr/share/postgresql-common/pgdg; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pgdg-key-download'; \
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/kova-pgdg.asc; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pgdg-key-read'; \
    gpg --batch --show-keys --with-colons /usr/share/postgresql-common/pgdg/kova-pgdg.asc \
      | python3 -c 'import sys;rows=[x.split(":") for x in sys.stdin.read().splitlines()];print("KOVA_OPERATOR_STAGE=pgdg-key-count-guard",flush=True);assert sum(x[0]=="pub" for x in rows)==1;print("KOVA_OPERATOR_STAGE=pgdg-key-fingerprint-guard",flush=True);assert next(x[9] for x in rows if x[0]=="fpr")=="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"'; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pgdg-source-write'; \
    printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' \
      'Suites: noble-pgdg' 'Architectures: amd64' \
      'Signed-By: /usr/share/postgresql-common/pgdg/kova-pgdg.asc' \
      > /etc/apt/sources.list.d/kova-pgdg.sources; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pgdg-index-refresh'; \
    apt-get update -qq; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pg17-candidate-query'; \
    version="$(apt-cache policy postgresql-client-17 | awk '/Candidate:/ {print $2; exit}')"; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pg17-version-guard'; \
    [[ "$version" =~ ^17\.[0-9A-Za-z.+:~_-]+$ ]]; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=pg17-client-install'; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "postgresql-client-17=$version"; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=sbom-directory'; \
    install -d -m0755 /opt/kova-build/apt-inrelease; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=sbom-release-copy'; \
    cp /var/lib/apt/lists/*_InRelease /opt/kova-build/apt-inrelease/; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=sbom-package-query'; \
    dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort > /opt/kova-build/packages.tsv; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=apt-cache-clean'; \
    apt-get clean; \
    printf '%s\n' 'KOVA_OPERATOR_STAGE=build-temporary-clean'; \
    rm -rf /var/lib/apt/lists/* /root/.gnupg /var/log/apt/*
COPY source/ /opt/kova/scripts/release/
ENV PATH="/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    LANG="C.UTF-8" LC_ALL="C.UTF-8" TZ="UTC" PYTHONDONTWRITEBYTECODE="1"
USER 65532:65532
WORKDIR /tmp
HEALTHCHECK NONE
ENTRYPOINT ["python3", "/opt/kova/scripts/release/recovery-operator-client-smoke.py"]
