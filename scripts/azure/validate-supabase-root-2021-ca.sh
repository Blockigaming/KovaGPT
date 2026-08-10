#!/usr/bin/env bash
set -euo pipefail

EXPECTED_FINGERPRINT="807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA"
EXPECTED_SERIAL="6CBC4CA1DEB63F692D0A2024C67289C2D13D54F6"
EXPECTED_COMMON_NAME="Supabase Root 2021 CA"
EXPECTED_ORGANIZATION="Supabase Inc"
MAX_CERT_BYTES=16384

fail() {
  printf 'CA_VALIDATION=FAIL\nREASON=%s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: $0 /path/to/prod-ca-2021.crt"
CERT="$1"

for command in openssl python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done

[ -f "$CERT" ] || fail "certificate file does not exist"
[ ! -L "$CERT" ] || fail "certificate path must not be a symbolic link"
[ -s "$CERT" ] || fail "certificate file is empty"
CERT_BYTES="$(wc -c <"$CERT" | tr -d '[:space:]')"
[[ "$CERT_BYTES" =~ ^[0-9]+$ ]] || fail "certificate size could not be read"
[ "$CERT_BYTES" -le "$MAX_CERT_BYTES" ] || fail "certificate file is unexpectedly large"

python3 - "$CERT" <<'PY' || fail "certificate file must contain exactly one PEM certificate and only surrounding whitespace"
import re
import sys
from pathlib import Path

raw = Path(sys.argv[1]).read_bytes()
try:
    text = raw.decode("ascii")
except UnicodeDecodeError:
    raise SystemExit(1)
pattern = re.compile(
    r"\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*",
    re.ASCII,
)
if pattern.fullmatch(text) is None:
    raise SystemExit(1)
PY

TMP_DER="$(mktemp)"
cleanup() {
  rm -f "$TMP_DER"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

openssl x509 -in "$CERT" -outform DER -out "$TMP_DER" 2>/dev/null \
  || fail "file is not a valid X.509 certificate"

FINGERPRINT="$(
  openssl x509 -in "$CERT" -noout -fingerprint -sha256 \
    | cut -d= -f2 \
    | tr -d ':[:space:]' \
    | tr '[:lower:]' '[:upper:]'
)"
[ "$FINGERPRINT" = "$EXPECTED_FINGERPRINT" ] \
  || fail "SHA-256 fingerprint is not the reviewed Supabase root"

SERIAL="$(
  openssl x509 -in "$CERT" -noout -serial \
    | cut -d= -f2 \
    | tr -d '[:space:]' \
    | tr '[:lower:]' '[:upper:]'
)"
[ "$SERIAL" = "$EXPECTED_SERIAL" ] || fail "certificate serial is unexpected"

SUBJECT="$(openssl x509 -in "$CERT" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
ISSUER="$(openssl x509 -in "$CERT" -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//')"
[ "$SUBJECT" = "$ISSUER" ] || fail "certificate is not self-issued"
[[ "$SUBJECT" == *"CN=${EXPECTED_COMMON_NAME}"* ]] \
  || fail "certificate common name is unexpected"
[[ "$SUBJECT" == *"O=${EXPECTED_ORGANIZATION}"* ]] \
  || fail "certificate organization is unexpected"

TEXT="$(openssl x509 -in "$CERT" -noout -text)"
grep -q 'X509v3 Basic Constraints: critical' <<<"$TEXT" \
  || fail "basic constraints are not critical"
grep -q 'CA:TRUE' <<<"$TEXT" || fail "certificate does not assert CA:TRUE"
grep -q 'Certificate Sign' <<<"$TEXT" || fail "certificate lacks Certificate Sign key usage"
grep -q 'CRL Sign' <<<"$TEXT" || fail "certificate lacks CRL Sign key usage"

openssl x509 -in "$CERT" -noout -checkend 86400 >/dev/null \
  || fail "certificate is expired or expires within 24 hours"
openssl verify -CAfile "$CERT" "$CERT" >/dev/null 2>&1 \
  || fail "certificate self-signature verification failed"

NOT_BEFORE="$(openssl x509 -in "$CERT" -noout -startdate | cut -d= -f2-)"
NOT_AFTER="$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2-)"
PEM_FILE_SHA256="$(sha256sum "$CERT" | awk '{print $1}')"

cat <<OUT
CA_VALIDATION=PASS
certificate_common_name=$EXPECTED_COMMON_NAME
certificate_serial=$SERIAL
certificate_sha256_fingerprint=$FINGERPRINT
certificate_not_before=$NOT_BEFORE
certificate_not_after=$NOT_AFTER
pem_file_sha256=$PEM_FILE_SHA256
OUT
