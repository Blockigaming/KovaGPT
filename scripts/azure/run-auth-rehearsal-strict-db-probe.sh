#!/usr/bin/env bash
set -euo pipefail

SUBSCRIPTION_ID="ab732127-11c3-46a7-a1cb-6ee8d86594f4"
TENANT_ID="18a67414-b56e-4b79-8dc8-435494fcc9be"
RESOURCE_GROUP="rg-kovagpt-dev"
APP="ca-kovagpt-auth-rehearsal"
PRODUCTION_APP="ca-kovagpt-dev"
BASELINE_REVISION="ca-kovagpt-auth-rehearsal--0000006"
EXPECTED_IMAGE="kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web-auth-rehearsal@sha256:1ed6f0d0f0e7e42d4747391e0bc54309760ea3c68b1612b371d31c80aef4d00b"
EXPECTED_DESTINATION="oztdrjtdglkizlewnulh"
FORBIDDEN_DESTINATION="mfbycmbjygcfkrsuepxf"
DB_SECRET_NAME="auth-migration-rehearsal-database-url"
BRIDGE_SECRET_NAME="auth-migration-bridge-secret"
CA_SECRET_NAME="auth-migration-rehearsal-database-ca"
CA_ENV_NAME="AUTH_MIGRATION_REHEARSAL_DATABASE_CA"
EXPECTED_CA_FINGERPRINT="807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA"
EXPECTED_CA_SERIAL="6CBC4CA1DEB63F692D0A2024C67289C2D13D54F6"
PROBE_SOURCE="scripts/azure/auth-rehearsal-strict-db-probe.cjs"
EXPECTED_PROBE_SHA256="b6279417f589848069354af93b49866ab297a89fba8c9410dfb21590499a36ba"

fail() {
  printf 'SAFETY STOP: %s\n' "$*" >&2
  exit 1
}

[ "$#" -le 2 ] || fail "usage: $0 [expected-revision] [absent|present]"
EXPECTED_REVISION="${1:-$BASELINE_REVISION}"
EXPECTED_CA_STATE="${2:-absent}"

[[ "$EXPECTED_REVISION" =~ ^ca-kovagpt-auth-rehearsal--[a-z0-9]+$ ]] \
  || fail "expected revision has an invalid format"
case "$EXPECTED_CA_STATE" in
  absent)
    [ "$EXPECTED_REVISION" = "$BASELINE_REVISION" ] \
      || fail "CA-absent mode is authorized only for the diagnosed baseline revision"
    ;;
  present)
    [ "$EXPECTED_REVISION" != "$BASELINE_REVISION" ] \
      || fail "CA-present mode requires the explicitly supplied post-CA revision"
    ;;
  *)
    fail "CA state must be absent or present"
    ;;
esac

for command in az jq node psql sha256sum openssl mktemp script; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done

[ "$APP" = "ca-kovagpt-auth-rehearsal" ] || fail "unexpected app target"
[ "$APP" != "$PRODUCTION_APP" ] || fail "target equals production app"
[ -f "$PROBE_SOURCE" ] || fail "run from the repository root; probe source is missing"
[ "$(sha256sum "$PROBE_SOURCE" | awk '{print $1}')" = "$EXPECTED_PROBE_SHA256" ] \
  || fail "local probe source does not match the reviewed SHA-256"

az account set --subscription "$SUBSCRIPTION_ID"
ACCOUNT_JSON="$(az account show --output json)"
[ "$(jq -r '.id // empty' <<<"$ACCOUNT_JSON")" = "$SUBSCRIPTION_ID" ] \
  || fail "unexpected Azure subscription"
[ "$(jq -r '.tenantId // empty' <<<"$ACCOUNT_JSON")" = "$TENANT_ID" ] \
  || fail "unexpected Azure tenant"

APP_JSON="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --output json
)"

[ "$(jq -r '.name // empty' <<<"$APP_JSON")" = "$APP" ] || fail "wrong Container App"
[ "$(jq -r '.resourceGroup // empty' <<<"$APP_JSON")" = "$RESOURCE_GROUP" ] \
  || fail "wrong resource group"
[ "$(jq -r '.properties.provisioningState // empty' <<<"$APP_JSON")" = "Succeeded" ] \
  || fail "app provisioning state is not Succeeded"
[ "$(jq -r '.properties.runningStatus // empty' <<<"$APP_JSON")" = "Running" ] \
  || fail "app is not Running"
[ "$(jq -r '.properties.latestRevisionName // empty' <<<"$APP_JSON")" = "$EXPECTED_REVISION" ] \
  || fail "latest revision changed"
[ "$(jq -r '.properties.latestReadyRevisionName // empty' <<<"$APP_JSON")" = "$EXPECTED_REVISION" ] \
  || fail "latest ready revision changed"
[ "$(jq -r '.properties.template.containers | length' <<<"$APP_JSON")" = "1" ] \
  || fail "template does not contain exactly one container"
[ "$(jq -r '.properties.template.containers[0].image // empty' <<<"$APP_JSON")" = "$EXPECTED_IMAGE" ] \
  || fail "immutable image changed"
[ "$(jq -r '.properties.template.scale.minReplicas // empty' <<<"$APP_JSON")" = "1" ] \
  || fail "minReplicas changed"
[ "$(jq -r '.properties.template.scale.maxReplicas // empty' <<<"$APP_JSON")" = "1" ] \
  || fail "maxReplicas changed"

INGRESS_JSON="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query 'properties.configuration.ingress' \
    --output json
)"
[ -z "$INGRESS_JSON" ] || [ "$INGRESS_JSON" = "null" ] \
  || fail "ingress is not disabled"

read_env_value() {
  local name="$1"
  jq -r --arg name "$name" '
    .properties.template.containers[0].env[]?
    | select(.name == $name)
    | .value // empty
  ' <<<"$APP_JSON"
}

[ "$(read_env_value AUTH_MIGRATION_REHEARSAL_ENABLED)" = "true" ] \
  || fail "rehearsal receiver is disabled"
[ "$(read_env_value AUTH_MIGRATION_SOURCE_ID)" = "legacy-auth-rehearsal-source" ] \
  || fail "migration source changed"
[ "$(read_env_value AUTH_MIGRATION_DESTINATION_PROJECT_REF)" = "$EXPECTED_DESTINATION" ] \
  || fail "destination project changed"
[ "$(read_env_value AUTH_MIGRATION_DESTINATION_PROJECT_REF)" != "$FORBIDDEN_DESTINATION" ] \
  || fail "prohibited real project selected"
[ "$(read_env_value AI_GENERATION_ENABLED)" = "false" ] \
  || fail "AI_GENERATION_ENABLED is not false"
[ "$(read_env_value KOVA_GENERATION_DISABLED)" = "true" ] \
  || fail "KOVA_GENERATION_DISABLED is not true"

DB_ENV_JSON="$(
  jq -c '[
    .properties.template.containers[0].env[]?
    | select(.name == "AUTH_MIGRATION_REHEARSAL_DATABASE_URL")
  ]' <<<"$APP_JSON"
)"
[ "$(jq 'length' <<<"$DB_ENV_JSON")" = "1" ] \
  || fail "database URL environment entry is not unique"
[ "$(jq -r '.[0].secretRef // empty' <<<"$DB_ENV_JSON")" = "$DB_SECRET_NAME" ] \
  || fail "database secret reference changed"
[ -z "$(jq -r '.[0].value // empty' <<<"$DB_ENV_JSON")" ] \
  || fail "database URL must not be stored as a literal environment value"

BRIDGE_ENV_JSON="$(
  jq -c '[
    .properties.template.containers[0].env[]?
    | select(.name == "AUTH_MIGRATION_BRIDGE_SECRET")
  ]' <<<"$APP_JSON"
)"
[ "$(jq 'length' <<<"$BRIDGE_ENV_JSON")" = "1" ] \
  || fail "bridge-secret environment entry is not unique"
[ "$(jq -r '.[0].secretRef // empty' <<<"$BRIDGE_ENV_JSON")" = "$BRIDGE_SECRET_NAME" ] \
  || fail "bridge-secret reference changed"
[ -z "$(jq -r '.[0].value // empty' <<<"$BRIDGE_ENV_JSON")" ] \
  || fail "bridge secret must not be stored as a literal environment value"

assert_ca_environment_state() {
  local json="$1"
  local entries
  entries="$(
    jq -c --arg name "$CA_ENV_NAME" '[
      .properties.template.containers[0].env[]?
      | select(.name == $name)
    ]' <<<"$json"
  )"

  case "$EXPECTED_CA_STATE" in
    absent)
      [ "$(jq 'length' <<<"$entries")" = "0" ] \
        || fail "unexpected database CA environment entry on the baseline revision"
      ;;
    present)
      [ "$(jq 'length' <<<"$entries")" = "1" ] \
        || fail "database CA environment entry is not unique"
      [ "$(jq -r '.[0].secretRef // empty' <<<"$entries")" = "$CA_SECRET_NAME" ] \
        || fail "database CA does not reference the expected secret"
      [ -z "$(jq -r '.[0].value // empty' <<<"$entries")" ] \
        || fail "database CA must not be stored as a literal environment value"
      ;;
  esac
}

assert_ca_environment_state "$APP_JSON"

PROHIBITED_RUNTIME_ENV_COUNT="$(
  jq '[
    .properties.template.containers[0].env[]?.name
    | select(
        . == "NODE_TLS_REJECT_UNAUTHORIZED"
        or . == "NODE_OPTIONS"
        or . == "NODE_EXTRA_CA_CERTS"
        or . == "SSL_CERT_FILE"
        or . == "SSL_CERT_DIR"
        or . == "PGSSLMODE"
      )
  ] | length' <<<"$APP_JSON"
)"
[ "$PROHIBITED_RUNTIME_ENV_COUNT" = "0" ] \
  || fail "a prohibited TLS/runtime override is configured"

MODEL_PROVIDER_ENV_COUNT="$(
  jq '[
    .properties.template.containers[0].env[]?.name
    | select(
        . == "OPENAI_API_KEY"
        or . == "AZURE_OPENAI_API_KEY"
        or . == "AZURE_OPENAI_ENDPOINT"
        or . == "ANTHROPIC_API_KEY"
        or . == "GEMINI_API_KEY"
        or . == "GOOGLE_GENERATIVE_AI_API_KEY"
        or . == "OPENROUTER_API_KEY"
        or . == "LOVABLE_API_KEY"
      )
  ] | length' <<<"$APP_JSON"
)"
[ "$MODEL_PROVIDER_ENV_COUNT" = "0" ] \
  || fail "a model-provider credential is configured on the rehearsal app"

if jq -e --arg forbidden "$FORBIDDEN_DESTINATION" '
  [
    .properties.template.containers[0].env[]?
    | select(.value != null)
    | .value
  ]
  | any(contains($forbidden))
' <<<"$APP_JSON" >/dev/null; then
  fail "a non-secret environment value references the prohibited real project"
fi

DB_URL="$(
  az containerapp secret show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --secret-name "$DB_SECRET_NAME" \
    --query value \
    --output tsv
)"
[ -n "$DB_URL" ] || fail "database URL secret is missing"

CA_PEM=""
CA_FILE=""
cleanup() {
  unset DB_URL CA_PEM PROBE_GZIP_B64 PROBE_STDIN_COMMAND AZ_EXEC_COMMAND
  if [ -n "$CA_FILE" ]; then
    rm -f "$CA_FILE"
  fi
}
trap cleanup EXIT INT TERM HUP

if [ "$EXPECTED_CA_STATE" = "present" ]; then
  CA_PEM="$(
    az containerapp secret show \
      --name "$APP" \
      --resource-group "$RESOURCE_GROUP" \
      --secret-name "$CA_SECRET_NAME" \
      --query value \
      --output tsv
  )"
  [ -n "$CA_PEM" ] || fail "database CA secret is missing"
  CA_FILE="$(mktemp)"
  chmod 600 "$CA_FILE"
  printf '%s\n' "$CA_PEM" >"$CA_FILE"
  [ "$(grep -c '^-----BEGIN CERTIFICATE-----$' "$CA_FILE" || true)" = "1" ] \
    || fail "database CA secret must contain exactly one PEM certificate"
  [ "$(grep -c '^-----END CERTIFICATE-----$' "$CA_FILE" || true)" = "1" ] \
    || fail "database CA secret must contain exactly one PEM certificate"
  openssl x509 -in "$CA_FILE" -noout >/dev/null 2>&1 \
    || fail "database CA secret is not a valid X.509 certificate"
  CA_FINGERPRINT="$(
    openssl x509 -in "$CA_FILE" -noout -fingerprint -sha256 \
      | cut -d= -f2 \
      | tr -d ':[:space:]' \
      | tr '[:lower:]' '[:upper:]'
  )"
  [ "$CA_FINGERPRINT" = "$EXPECTED_CA_FINGERPRINT" ] \
    || fail "database CA secret fingerprint is unexpected"
  CA_SERIAL="$(
    openssl x509 -in "$CA_FILE" -noout -serial \
      | cut -d= -f2 \
      | tr -d '[:space:]' \
      | tr '[:lower:]' '[:upper:]'
  )"
  [ "$CA_SERIAL" = "$EXPECTED_CA_SERIAL" ] \
    || fail "database CA secret serial is unexpected"
  openssl verify -CAfile "$CA_FILE" "$CA_FILE" >/dev/null 2>&1 \
    || fail "database CA secret self-signature verification failed"
  openssl x509 -in "$CA_FILE" -noout -checkend 86400 >/dev/null \
    || fail "database CA secret is expired or expires within 24 hours"
fi

DB_KIND="$(
  AUTH_MIGRATION_REHEARSAL_DATABASE_URL="$DB_URL" \
    node -e '
      const probe = require("./scripts/azure/auth-rehearsal-strict-db-probe.cjs");
      process.stdout.write(probe.validateDatabaseAffinity(process.env.AUTH_MIGRATION_REHEARSAL_DATABASE_URL).kind);
    '
)"
[ "$DB_KIND" = "direct" ] || [ "$DB_KIND" = "session_pooler" ] \
  || fail "database URL affinity could not be verified"

read_counts() {
  DB_URL_FOR_COUNTS="$DB_URL" node - <<'NODE'
const { spawnSync } = require("node:child_process");

let parsed;
let username;
let password;
try {
  parsed = new URL(process.env.DB_URL_FOR_COUNTS);
  username = decodeURIComponent(parsed.username);
  password = decodeURIComponent(parsed.password);
} catch {
  process.stderr.write("SAFETY STOP: database URL parsing failed for count check\n");
  process.exit(1);
}

const childEnv = {
  PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: process.env.HOME || "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PGHOST: parsed.hostname,
  PGPORT: parsed.port || "5432",
  PGDATABASE: parsed.pathname.replace(/^\//u, ""),
  PGUSER: username,
  PGPASSWORD: password,
  PGAPPNAME: "auth-rehearsal-strict-db-probe-precheck",
  PGCONNECT_TIMEOUT: "10",
  PGSSLMODE: "require",
};

const sql = `
  SELECT
    (SELECT count(*) FROM auth.users)::text
    || '|'
    || (SELECT count(*) FROM auth.identities)::text;
`;

const result = spawnSync(
  "psql",
  [
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--command",
    "\\conninfo",
    "--command",
    sql,
  ],
  {
    env: childEnv,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  },
);

if (result.error || result.status !== 0) {
  process.stderr.write("SAFETY STOP: read-only destination count query failed\n");
  process.exit(1);
}

const stdout = result.stdout.replace(/\r/gu, "");

const clientTls =
  /\bSSL connection\b/iu.test(stdout) ||
  /\bSSL protocol\b/iu.test(stdout);

if (!clientTls) {
  process.stderr.write(
    "SAFETY STOP: destination count query lacked client TLS evidence\n",
  );
  process.exit(1);
}

const countLines = stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^\d+\|\d+$/u.test(line));

if (countLines.length !== 1) {
  process.stderr.write(
    "SAFETY STOP: destination count query lacked exact count evidence\n",
  );
  process.exit(1);
}

process.stdout.write(countLines[0]);
NODE
}

[ "$(read_counts)" = "0|0" ] || fail "destination is not empty before probe"

REPLICA_JSON="$(
  az containerapp replica list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --revision "$EXPECTED_REVISION" \
    --output json
)"
[ "$(jq 'length' <<<"$REPLICA_JSON")" = "1" ] || fail "expected exactly one replica"
[ "$(jq '.[0].properties.containers | length' <<<"$REPLICA_JSON")" = "1" ] \
  || fail "expected exactly one container"

REPLICA="$(jq -r '.[0].name // empty' <<<"$REPLICA_JSON")"
CONTAINER="$(jq -r '.[0].properties.containers[0].name // empty' <<<"$REPLICA_JSON")"
[ -n "$REPLICA" ] || fail "replica name is missing"
[ -n "$CONTAINER" ] || fail "container name is missing"

PROBE_GZIP_B64="$(
  node - "$PROBE_SOURCE" <<'NODE'
const fs = require("node:fs");
const zlib = require("node:zlib");
const sourcePath = process.argv[2];
const source = fs.readFileSync(sourcePath, "utf8");
const invocation = `
runProbe()
  .then(({ exitCode }) => { process.exitCode = exitCode; })
  .catch(() => {
    console.log("RESULT=failure");
    console.log("CATEGORY=probe_internal");
    console.log("ERROR_CODE=redacted");
    console.log("QUERY_OK=false");
    process.exitCode = 6;
  });
`;
process.stdout.write(zlib.gzipSync(source + invocation, { level: 9 }).toString("base64"));
NODE
)"
[ -n "$PROBE_GZIP_B64" ] || fail "probe payload generation failed"
[ "${#PROBE_GZIP_B64}" -lt 7000 ] || fail "probe payload exceeds guarded size limit"

PROBE_STDIN_CHUNK_SIZE=256

PROBE_STDIN_COMMAND=$'node - <<\'NODE\'\nconst zlib = require("node:zlib");\nconst b64 = [\n'

for ((offset = 0; offset < ${#PROBE_GZIP_B64}; offset += PROBE_STDIN_CHUNK_SIZE)); do
  chunk="${PROBE_GZIP_B64:offset:PROBE_STDIN_CHUNK_SIZE}"
  PROBE_STDIN_COMMAND+="  \"$chunk\","$'\n'
done

PROBE_STDIN_COMMAND+=$'].join("");\neval(zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));\nNODE\nexit\n'

MAX_PROBE_STDIN_LINE="$(
  printf '%s\n' "$PROBE_STDIN_COMMAND" |
    awk '{ if (length($0) > max) max = length($0) } END { print max + 0 }'
)"

[ "$MAX_PROBE_STDIN_LINE" -le 512 ] \
  || fail "PTY probe transport contains an oversized input line"

echo "PROBE_STDIN_CHUNK_SIZE=$PROBE_STDIN_CHUNK_SIZE"
echo "PROBE_STDIN_MAX_LINE=$MAX_PROBE_STDIN_LINE"

printf -v AZ_EXEC_COMMAND '%q ' \
  az containerapp exec \
  --name "$APP" \
  --resource-group "$RESOURCE_GROUP" \
  --revision "$EXPECTED_REVISION" \
  --replica "$REPLICA" \
  --container "$CONTAINER" \
  --command "sh -c 'stty -echo; exec sh'"

printf '%s\n' \
  "FINAL_PRECHECK=PASS" \
  "DATABASE_STATE=0|0" \
  "DB_AFFINITY=$DB_KIND" \
  "CA_STATE=$EXPECTED_CA_STATE" \
  "INGRESS=disabled" \
  "REVISION=$EXPECTED_REVISION" \
  "PROBE_TRANSPORT=pty_stdin" \
  "STARTING_ONE_READ_ONLY_IN_CONTAINER_PROBE"

set +e
{
  printf '%s\n' 'stty -echo'
  printf '%s\n' "$PROBE_STDIN_COMMAND"
  printf '%s\n' 'exit'
} | script -qefc "$AZ_EXEC_COMMAND" /dev/null
PIPE_STATUSES=("${PIPESTATUS[@]}")
AZ_EXEC_STATUS="${PIPE_STATUSES[1]}"
set -e

POST_APP_JSON="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --output json
)"
[ "$(jq -r '.properties.latestRevisionName // empty' <<<"$POST_APP_JSON")" = "$EXPECTED_REVISION" ] \
  || fail "revision changed during probe"
[ "$(jq -r '.properties.latestReadyRevisionName // empty' <<<"$POST_APP_JSON")" = "$EXPECTED_REVISION" ] \
  || fail "latest ready revision changed during probe"
[ "$(jq -r '.properties.template.containers[0].image // empty' <<<"$POST_APP_JSON")" = "$EXPECTED_IMAGE" ] \
  || fail "image changed during probe"
assert_ca_environment_state "$POST_APP_JSON"

POST_INGRESS="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query 'properties.configuration.ingress' \
    --output json
)"
[ -z "$POST_INGRESS" ] || [ "$POST_INGRESS" = "null" ] \
  || fail "ingress changed during probe"
[ "$(read_counts)" = "0|0" ] || fail "destination changed during read-only probe"

printf '%s\n' \
  "AZURE_EXEC_CLI_STATUS=$AZ_EXEC_STATUS" \
  "POST_PROBE_DATABASE_STATE=0|0" \
  "POST_PROBE_CA_STATE=$EXPECTED_CA_STATE" \
  "POST_PROBE_INGRESS=disabled" \
  "DO_NOT_RERUN_UNTIL_OUTPUT_IS_CLASSIFIED"