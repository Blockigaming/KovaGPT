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
VALIDATOR_SOURCE="scripts/azure/validate-supabase-root-2021-ca.sh"
EXPECTED_VALIDATOR_SHA256="c4d9f02e8846b73ef115c37791026f21b7be3672df3dd397e1aeeaa06f6e3b83"
PROBE_SOURCE="scripts/azure/auth-rehearsal-strict-db-probe.cjs"
EXPECTED_PROBE_SHA256="b6279417f589848069354af93b49866ab297a89fba8c9410dfb21590499a36ba"

DB_URL=""
CA_PEM=""
CA_COPY=""
STORED_CA_COPY=""
STAGE="initialization"
SECRET_CREATED=false

fail() {
  printf 'SAFETY STOP: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  unset DB_URL CA_PEM
  [ -z "$CA_COPY" ] || rm -f "$CA_COPY"
  [ -z "$STORED_CA_COPY" ] || rm -f "$STORED_CA_COPY"
  if [ "$status" -ne 0 ] && [ "$SECRET_CREATED" = "true" ]; then
    printf '%s\n' \
      "PARTIAL_SAFE_STATE=CA_SECRET_MAY_EXIST" \
      "FAILED_STAGE=$STAGE" \
      "DO_NOT_RETRY_BLINDLY" \
      "DO_NOT_DELETE_OR_OVERWRITE_THE_CA_SECRET_UNTIL_AZURE_STATE_IS_RECHECKED" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[ "$#" -eq 1 ] \
  || fail "usage: CONFIRMED_PROBE_CATEGORY=tls_trust CONFIRMED_PROBE_REVISION=$BASELINE_REVISION CONFIRMED_PROBE_CA_STATE=absent CONFIRMED_PROBE_DATABASE_STATE=0|0 $0 /path/to/prod-ca-2021.crt"
CERT="$1"

[ "${CONFIRMED_PROBE_CATEGORY:-}" = "tls_trust" ] \
  || fail "CONFIRMED_PROBE_CATEGORY must equal tls_trust"
[ "${CONFIRMED_PROBE_REVISION:-}" = "$BASELINE_REVISION" ] \
  || fail "CONFIRMED_PROBE_REVISION must equal the diagnosed baseline revision"
[ "${CONFIRMED_PROBE_CA_STATE:-}" = "absent" ] \
  || fail "CONFIRMED_PROBE_CA_STATE must equal absent"
[ "${CONFIRMED_PROBE_DATABASE_STATE:-}" = "0|0" ] \
  || fail "CONFIRMED_PROBE_DATABASE_STATE must equal 0|0"

for command in az jq node psql sha256sum openssl python3 mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done

[ "$APP" = "ca-kovagpt-auth-rehearsal" ] || fail "unexpected app target"
[ "$APP" != "$PRODUCTION_APP" ] || fail "target equals production app"
[ "$EXPECTED_DESTINATION" != "$FORBIDDEN_DESTINATION" ] \
  || fail "destination safety constants overlap"
[ -f "$VALIDATOR_SOURCE" ] || fail "run from the repository root; CA validator is missing"
[ -f "$PROBE_SOURCE" ] || fail "run from the repository root; strict DB probe source is missing"
[ "$(sha256sum "$VALIDATOR_SOURCE" | awk '{print $1}')" = "$EXPECTED_VALIDATOR_SHA256" ] \
  || fail "CA validator source does not match the reviewed SHA-256"
[ "$(sha256sum "$PROBE_SOURCE" | awk '{print $1}')" = "$EXPECTED_PROBE_SHA256" ] \
  || fail "strict DB probe source does not match the reviewed SHA-256"
[ -f "$CERT" ] || fail "certificate file does not exist"
[ ! -L "$CERT" ] || fail "certificate path must not be a symbolic link"

STAGE="certificate_validation"
CA_COPY="$(mktemp)"
chmod 600 "$CA_COPY"
cat "$CERT" >"$CA_COPY"
bash "$VALIDATOR_SOURCE" "$CA_COPY" >/dev/null

az account set --subscription "$SUBSCRIPTION_ID"
ACCOUNT_JSON="$(az account show --output json)"
[ "$(jq -r '.id // empty' <<<"$ACCOUNT_JSON")" = "$SUBSCRIPTION_ID" ] \
  || fail "unexpected Azure subscription"
[ "$(jq -r '.tenantId // empty' <<<"$ACCOUNT_JSON")" = "$TENANT_ID" ] \
  || fail "unexpected Azure tenant"

STAGE="baseline_app_preflight"
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
[ "$(jq -r '.properties.latestRevisionName // empty' <<<"$APP_JSON")" = "$BASELINE_REVISION" ] \
  || fail "latest revision is no longer the diagnosed baseline revision"
[ "$(jq -r '.properties.latestReadyRevisionName // empty' <<<"$APP_JSON")" = "$BASELINE_REVISION" ] \
  || fail "latest ready revision is no longer the diagnosed baseline revision"
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
  local json="$1"
  local name="$2"
  jq -r --arg name "$name" '
    .properties.template.containers[0].env[]?
    | select(.name == $name)
    | .value // empty
  ' <<<"$json"
}

assert_fixed_environment() {
  local json="$1"
  [ "$(read_env_value "$json" AUTH_MIGRATION_REHEARSAL_ENABLED)" = "true" ] \
    || fail "rehearsal receiver is disabled"
  [ "$(read_env_value "$json" AUTH_MIGRATION_SOURCE_ID)" = "legacy-auth-rehearsal-source" ] \
    || fail "migration source changed"
  [ "$(read_env_value "$json" AUTH_MIGRATION_DESTINATION_PROJECT_REF)" = "$EXPECTED_DESTINATION" ] \
    || fail "destination project changed"
  [ "$(read_env_value "$json" AI_GENERATION_ENABLED)" = "false" ] \
    || fail "AI_GENERATION_ENABLED is not false"
  [ "$(read_env_value "$json" KOVA_GENERATION_DISABLED)" = "true" ] \
    || fail "KOVA_GENERATION_DISABLED is not true"

  local db_entries bridge_entries
  db_entries="$(
    jq -c '[
      .properties.template.containers[0].env[]?
      | select(.name == "AUTH_MIGRATION_REHEARSAL_DATABASE_URL")
    ]' <<<"$json"
  )"
  bridge_entries="$(
    jq -c '[
      .properties.template.containers[0].env[]?
      | select(.name == "AUTH_MIGRATION_BRIDGE_SECRET")
    ]' <<<"$json"
  )"
  [ "$(jq 'length' <<<"$db_entries")" = "1" ] \
    || fail "database URL environment entry is not unique"
  [ "$(jq -r '.[0].secretRef // empty' <<<"$db_entries")" = "$DB_SECRET_NAME" ] \
    || fail "database URL secret reference changed"
  [ -z "$(jq -r '.[0].value // empty' <<<"$db_entries")" ] \
    || fail "database URL must not be stored as a literal value"
  [ "$(jq 'length' <<<"$bridge_entries")" = "1" ] \
    || fail "bridge-secret environment entry is not unique"
  [ "$(jq -r '.[0].secretRef // empty' <<<"$bridge_entries")" = "$BRIDGE_SECRET_NAME" ] \
    || fail "bridge-secret reference changed"
  [ -z "$(jq -r '.[0].value // empty' <<<"$bridge_entries")" ] \
    || fail "bridge secret must not be stored as a literal value"

  local prohibited_tls provider_credentials
  prohibited_tls="$(
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
    ] | length' <<<"$json"
  )"
  [ "$prohibited_tls" = "0" ] || fail "a prohibited TLS/runtime override is configured"

  provider_credentials="$(
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
    ] | length' <<<"$json"
  )"
  [ "$provider_credentials" = "0" ] \
    || fail "a model-provider credential is configured on the rehearsal app"

  if jq -e --arg forbidden "$FORBIDDEN_DESTINATION" '
    [
      .properties.template.containers[0].env[]?
      | select(.value != null)
      | .value
    ]
    | any(contains($forbidden))
  ' <<<"$json" >/dev/null; then
    fail "a non-secret environment value references the prohibited real project"
  fi
}

assert_fixed_environment "$APP_JSON"

CA_ENV_ENTRIES="$(
  jq -c --arg name "$CA_ENV_NAME" '[
    .properties.template.containers[0].env[]?
    | select(.name == $name)
  ]' <<<"$APP_JSON"
)"
[ "$(jq 'length' <<<"$CA_ENV_ENTRIES")" = "0" ] \
  || fail "database CA environment entry is already configured"

CA_SECRET_COUNT="$(
  az containerapp secret list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='${CA_SECRET_NAME}'] | length(@)" \
    --output tsv
)"
[ "$CA_SECRET_COUNT" = "0" ] || fail "database CA secret name already exists"

DB_URL="$(
  az containerapp secret show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --secret-name "$DB_SECRET_NAME" \
    --query value \
    --output tsv
)"
[ -n "$DB_URL" ] || fail "database URL secret is missing"

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
  PGAPPNAME: "auth-rehearsal-ca-deployment-precheck",
  PGCONNECT_TIMEOUT: "10",
  PGSSLMODE: "require",
};

const sql = `
  SELECT
    (SELECT count(*) FROM auth.users)::text
    || '|'
    || (SELECT count(*) FROM auth.identities)::text
    || '|'
    || COALESCE(
      (SELECT ssl::text FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()),
      'false'
    );
`;

const result = spawnSync(
  "psql",
  ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql],
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

const evidence = result.stdout.replace(/\s+/gu, "");
const [users, identities, ssl] = evidence.split("|");
if (!/^\d+$/u.test(users ?? "") || !/^\d+$/u.test(identities ?? "") || ssl !== "true") {
  process.stderr.write("SAFETY STOP: destination count query lacked exact SSL evidence\n");
  process.exit(1);
}
process.stdout.write(`${users}|${identities}`);
NODE
}

[ "$(read_counts)" = "0|0" ] || fail "destination is not 0|0 before CA deployment"

BASELINE_REPLICAS="$(
  az containerapp replica list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --revision "$BASELINE_REVISION" \
    --query 'length(@)' \
    --output tsv
)"
[ "$BASELINE_REPLICAS" = "1" ] || fail "baseline revision does not have exactly one replica"

printf '%s\n' \
  "CA_DEPLOYMENT_PRECHECK=PASS" \
  "CONFIRMED_PROBE_CATEGORY=tls_trust" \
  "DATABASE_STATE=0|0" \
  "DB_AFFINITY=$DB_KIND" \
  "INGRESS=disabled" \
  "BASELINE_REVISION=$BASELINE_REVISION"

STAGE="ca_secret_creation"
CA_PEM="$(cat "$CA_COPY")"
az containerapp secret set \
  --name "$APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets "${CA_SECRET_NAME}=${CA_PEM}" \
  --output none
SECRET_CREATED=true

CA_SECRET_COUNT="$(
  az containerapp secret list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='${CA_SECRET_NAME}'] | length(@)" \
    --output tsv
)"
[ "$CA_SECRET_COUNT" = "1" ] || fail "database CA secret was not uniquely created"

STORED_CA_COPY="$(mktemp)"
chmod 600 "$STORED_CA_COPY"
az containerapp secret show \
  --name "$APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secret-name "$CA_SECRET_NAME" \
  --query value \
  --output tsv >"$STORED_CA_COPY"
bash "$VALIDATOR_SOURCE" "$STORED_CA_COPY" >/dev/null

STAGE="ca_revision_update"
az containerapp update \
  --name "$APP" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$EXPECTED_IMAGE" \
  --min-replicas 1 \
  --max-replicas 1 \
  --set-env-vars "${CA_ENV_NAME}=secretref:${CA_SECRET_NAME}" \
  --output none

STAGE="new_revision_readiness"
READY=false
NEW_REVISION=""
for _ in $(seq 1 90); do
  STATE_JSON="$(
    az containerapp show \
      --name "$APP" \
      --resource-group "$RESOURCE_GROUP" \
      --output json
  )"
  NEW_REVISION="$(jq -r '.properties.latestRevisionName // empty' <<<"$STATE_JSON")"
  READY_REVISION="$(jq -r '.properties.latestReadyRevisionName // empty' <<<"$STATE_JSON")"
  if [ "$(jq -r '.properties.provisioningState // empty' <<<"$STATE_JSON")" = "Succeeded" ] \
    && [ "$(jq -r '.properties.runningStatus // empty' <<<"$STATE_JSON")" = "Running" ] \
    && [ -n "$NEW_REVISION" ] \
    && [ "$NEW_REVISION" != "$BASELINE_REVISION" ] \
    && [ "$READY_REVISION" = "$NEW_REVISION" ]; then
    READY=true
    break
  fi
  sleep 5
done
[ "$READY" = "true" ] || fail "CA-configured revision did not become ready in time"

STAGE="final_verification"
FINAL_JSON="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --output json
)"
[ "$(jq -r '.properties.latestRevisionName // empty' <<<"$FINAL_JSON")" = "$NEW_REVISION" ] \
  || fail "latest revision changed during final verification"
[ "$(jq -r '.properties.latestReadyRevisionName // empty' <<<"$FINAL_JSON")" = "$NEW_REVISION" ] \
  || fail "new revision is not ready"
[ "$(jq -r '.properties.template.containers | length' <<<"$FINAL_JSON")" = "1" ] \
  || fail "final template does not contain exactly one container"
[ "$(jq -r '.properties.template.containers[0].image // empty' <<<"$FINAL_JSON")" = "$EXPECTED_IMAGE" ] \
  || fail "image changed during CA deployment"
[ "$(jq -r '.properties.template.scale.minReplicas // empty' <<<"$FINAL_JSON")" = "1" ] \
  || fail "post-deployment minReplicas is not 1"
[ "$(jq -r '.properties.template.scale.maxReplicas // empty' <<<"$FINAL_JSON")" = "1" ] \
  || fail "post-deployment maxReplicas is not 1"
assert_fixed_environment "$FINAL_JSON"

FINAL_CA_ENTRIES="$(
  jq -c --arg name "$CA_ENV_NAME" '[
    .properties.template.containers[0].env[]?
    | select(.name == $name)
  ]' <<<"$FINAL_JSON"
)"
[ "$(jq 'length' <<<"$FINAL_CA_ENTRIES")" = "1" ] \
  || fail "final database CA environment entry is not unique"
[ "$(jq -r '.[0].secretRef // empty' <<<"$FINAL_CA_ENTRIES")" = "$CA_SECRET_NAME" ] \
  || fail "final database CA does not reference the expected secret"
[ -z "$(jq -r '.[0].value // empty' <<<"$FINAL_CA_ENTRIES")" ] \
  || fail "final database CA is stored as a literal environment value"

FINAL_CA_SECRET_COUNT="$(
  az containerapp secret list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='${CA_SECRET_NAME}'] | length(@)" \
    --output tsv
)"
[ "$FINAL_CA_SECRET_COUNT" = "1" ] \
  || fail "final database CA secret is not unique"
az containerapp secret show \
  --name "$APP" \
  --resource-group "$RESOURCE_GROUP" \
  --secret-name "$CA_SECRET_NAME" \
  --query value \
  --output tsv >"$STORED_CA_COPY"
bash "$VALIDATOR_SOURCE" "$STORED_CA_COPY" >/dev/null

FINAL_INGRESS="$(
  az containerapp show \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --query 'properties.configuration.ingress' \
    --output json
)"
[ -z "$FINAL_INGRESS" ] || [ "$FINAL_INGRESS" = "null" ] \
  || fail "ingress became enabled during CA deployment"

FINAL_REPLICA_COUNT="$(
  az containerapp replica list \
    --name "$APP" \
    --resource-group "$RESOURCE_GROUP" \
    --revision "$NEW_REVISION" \
    --query 'length(@)' \
    --output tsv
)"
[ "$FINAL_REPLICA_COUNT" = "1" ] || fail "new ready revision does not have exactly one replica"
[ "$(read_counts)" = "0|0" ] || fail "destination changed during CA deployment"

STAGE="complete"
cat <<OUT
CA_DEPLOYMENT=SUCCESS
new_ready_revision=$NEW_REVISION
image=$EXPECTED_IMAGE
ca_secret_ref=$CA_SECRET_NAME
users=0
identities=0
ingress=disabled
MIGRATION_REQUEST_AUTHORIZED=false
NEXT_REQUIRED_ACTION=run_the_strict_in_container_select_1_probe_again
NEXT_COMMAND=bash scripts/azure/run-auth-rehearsal-strict-db-probe.sh $NEW_REVISION present
OUT
