import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const validator = resolve("scripts/azure/validate-supabase-root-2021-ca.sh");
const applyScript = resolve("scripts/azure/apply-auth-rehearsal-database-ca.sh");
const fixture = resolve("tests/fixtures/supabase-root-2021-ca.crt");
const baselineRevision = "ca-kovagpt-auth-rehearsal--0000006";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

test("reviewed Supabase root certificate passes exact validation", () => {
  const result = run("bash", [validator, fixture]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^CA_VALIDATION=PASS$/mu);
  assert.match(
    result.stdout,
    /certificate_sha256_fingerprint=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA/u,
  );
  assert.match(result.stdout, /certificate_common_name=Supabase Root 2021 CA/u);
  assert.doesNotMatch(result.stdout, /BEGIN CERTIFICATE/u);
});

test("validator rejects appended payloads and altered certificates", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-ca-validator-"));
  try {
    const appended = join(root, "appended.crt");
    writeFileSync(appended, `${readFileSync(fixture, "utf8")}unexpected`, "utf8");
    const appendedResult = run("bash", [validator, appended]);
    assert.notEqual(appendedResult.status, 0);
    assert.match(appendedResult.stderr, /CA_VALIDATION=FAIL/u);

    const altered = join(root, "altered.crt");
    const source = readFileSync(fixture, "utf8");
    writeFileSync(altered, source.replace(/A/, "B"), "utf8");
    const alteredResult = run("bash", [validator, altered]);
    assert.notEqual(alteredResult.status, 0);
    assert.match(alteredResult.stderr, /CA_VALIDATION=FAIL/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CA deployment refuses to start without exact prior probe evidence", () => {
  const result = run("bash", [applyScript, fixture], { env: { ...process.env } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONFIRMED_PROBE_CATEGORY must equal tls_trust/u);
  assert.doesNotMatch(result.stderr, /az: command not found/u);
});

test("CA deployment source contains fail-closed safety and no migration request", () => {
  const source = readFileSync(applyScript, "utf8");
  assert.match(source, /CONFIRMED_PROBE_CATEGORY:-.*tls_trust/su);
  assert.match(source, /BASELINE_REVISION="ca-kovagpt-auth-rehearsal--0000006"/u);
  assert.match(source, /EXPECTED_IMAGE=.*sha256:1ed6f0d0/u);
  assert.match(source, /EXPECTED_VALIDATOR_SHA256="c4d9f02e8846b73e/u);
  assert.match(source, /EXPECTED_PROBE_SHA256="b6279417f5898480/u);
  assert.match(source, /bash "\$VALIDATOR_SOURCE" "\$CA_COPY"/u);
  assert.match(source, /FINAL_CA_SECRET_COUNT/u);
  assert.match(source, /bash "\$VALIDATOR_SOURCE" "\$STORED_CA_COPY"/u);
  assert.match(source, /CA_SECRET_COUNT.*= "0"/su);
  assert.match(source, /PARTIAL_SAFE_STATE=CA_SECRET_MAY_EXIST/u);
  assert.match(source, /MIGRATION_REQUEST_AUTHORIZED=false/u);
  assert.match(source, /PGSSLMODE: "require"/u);
  assert.match(source, /pg_catalog\.pg_stat_ssl/u);
  assert.doesNotMatch(source, /containerapp ingress enable/iu);
  assert.doesNotMatch(source, /auth-migration\/rehearsal/iu);
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/u);
  assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/u);
  assert.doesNotMatch(source, /--show-values/u);
  assert.doesNotMatch(source, /psql\s+"\$DB_URL"/u);
});

function writeMockAzure(mockRoot, stateRoot) {
  const az = join(mockRoot, "az");
  const content = `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${MOCK_AZ_STATE:?}"
EXPECTED_IMAGE='kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web-auth-rehearsal@sha256:1ed6f0d0f0e7e42d4747391e0bc54309760ea3c68b1612b371d31c80aef4d00b'
BASE='ca-kovagpt-auth-rehearsal--0000006'
NEW='ca-kovagpt-auth-rehearsal--0000007'
cmd1="\${1:-}"; cmd2="\${2:-}"; cmd3="\${3:-}"
if [ "$cmd1 $cmd2" = 'account set' ]; then exit 0; fi
if [ "$cmd1 $cmd2" = 'account show' ]; then
  printf '%s\\n' '{"id":"ab732127-11c3-46a7-a1cb-6ee8d86594f4","tenantId":"18a67414-b56e-4b79-8dc8-435494fcc9be"}'
  exit 0
fi
if [ "$cmd1 $cmd2 $cmd3" = 'containerapp secret list' ]; then
  if [ -f "$STATE_DIR/ca-secret.crt" ]; then echo 1; else echo 0; fi
  exit 0
fi
if [ "$cmd1 $cmd2 $cmd3" = 'containerapp secret show' ]; then
  secret=''; prev=''
  for arg in "$@"; do
    if [ "$prev" = '--secret-name' ]; then secret="$arg"; fi
    prev="$arg"
  done
  case "$secret" in
    auth-migration-rehearsal-database-url)
      printf '%s\\n' 'postgresql://postgres:MockPass123@db.oztdrjtdglkizlewnulh.supabase.co:5432/postgres'
      ;;
    auth-migration-rehearsal-database-ca)
      cat "$STATE_DIR/ca-secret.crt"
      ;;
    *) exit 3 ;;
  esac
  exit 0
fi
if [ "$cmd1 $cmd2 $cmd3" = 'containerapp secret set' ]; then
  value=''; prev=''
  for arg in "$@"; do
    if [ "$prev" = '--secrets' ]; then value="$arg"; fi
    prev="$arg"
  done
  case "$value" in
    auth-migration-rehearsal-database-ca=*)
      printf '%s\\n' "\${value#auth-migration-rehearsal-database-ca=}" > "$STATE_DIR/ca-secret.crt"
      ;;
    *) exit 4 ;;
  esac
  exit 0
fi
if [ "$cmd1 $cmd2" = 'containerapp update' ]; then
  if [ "\${MOCK_UPDATE_FAILURE:-false}" = true ]; then exit 17; fi
  echo updated > "$STATE_DIR/mode"
  exit 0
fi
if [ "$cmd1 $cmd2" = 'containerapp replica' ] && [ "$cmd3" = 'list' ]; then
  echo 1
  exit 0
fi
if [ "$cmd1 $cmd2" = 'containerapp show' ]; then
  query=''; prev=''
  for arg in "$@"; do
    if [ "$prev" = '--query' ]; then query="$arg"; fi
    prev="$arg"
  done
  if [ "$query" = 'properties.configuration.ingress' ]; then
    echo null
    exit 0
  fi
  mode=$(cat "$STATE_DIR/mode")
  if [ "$mode" = updated ]; then
    rev="$NEW"
    ca=',{"name":"AUTH_MIGRATION_REHEARSAL_DATABASE_CA","secretRef":"auth-migration-rehearsal-database-ca"}'
  else
    rev="$BASE"
    ca=''
  fi
  cat <<JSON
{
  "name": "ca-kovagpt-auth-rehearsal",
  "resourceGroup": "rg-kovagpt-dev",
  "properties": {
    "provisioningState": "Succeeded",
    "runningStatus": "Running",
    "latestRevisionName": "$rev",
    "latestReadyRevisionName": "$rev",
    "configuration": {"ingress": null},
    "template": {
      "scale": {"minReplicas": 1, "maxReplicas": 1},
      "containers": [{
        "image": "$EXPECTED_IMAGE",
        "env": [
          {"name":"AUTH_MIGRATION_REHEARSAL_ENABLED","value":"true"},
          {"name":"AUTH_MIGRATION_SOURCE_ID","value":"legacy-auth-rehearsal-source"},
          {"name":"AUTH_MIGRATION_DESTINATION_PROJECT_REF","value":"oztdrjtdglkizlewnulh"},
          {"name":"AI_GENERATION_ENABLED","value":"false"},
          {"name":"KOVA_GENERATION_DISABLED","value":"true"},
          {"name":"AUTH_MIGRATION_REHEARSAL_DATABASE_URL","secretRef":"auth-migration-rehearsal-database-url"},
          {"name":"AUTH_MIGRATION_BRIDGE_SECRET","secretRef":"auth-migration-bridge-secret"}
          $ca
        ]
      }]
    }
  }
}
JSON
  exit 0
fi
exit 9
`;
  writeFileSync(az, content, "utf8");
  chmodSync(az, 0o755);

  const psql = join(mockRoot, "psql");
  writeFileSync(psql, "#!/usr/bin/env bash\nset -euo pipefail\nprintf '0|0|true\\n'\n", "utf8");
  chmodSync(psql, 0o755);
  writeFileSync(join(stateRoot, "mode"), "baseline\n", "utf8");
}

function runMockDeployment({ failUpdate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "auth-ca-apply-"));
  const mockRoot = join(root, "bin");
  const stateRoot = join(root, "state");
  mkdirSync(mockRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  copyFileSync(fixture, join(stateRoot, "source-ca.crt"));
  writeMockAzure(mockRoot, stateRoot);

  const env = {
    ...process.env,
    PATH: `${mockRoot}:${process.env.PATH}`,
    MOCK_AZ_STATE: stateRoot,
    MOCK_UPDATE_FAILURE: failUpdate ? "true" : "false",
    CONFIRMED_PROBE_CATEGORY: "tls_trust",
    CONFIRMED_PROBE_REVISION: baselineRevision,
    CONFIRMED_PROBE_CA_STATE: "absent",
    CONFIRMED_PROBE_DATABASE_STATE: "0|0",
  };
  const result = run("bash", [applyScript, fixture], { env });
  return { result, root, stateRoot };
}

test("mocked full CA deployment keeps ingress disabled and database empty", () => {
  const { result, root, stateRoot } = runMockDeployment();
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^CA_DEPLOYMENT=SUCCESS$/mu);
    assert.match(result.stdout, /^new_ready_revision=ca-kovagpt-auth-rehearsal--0000007$/mu);
    assert.match(result.stdout, /^users=0$/mu);
    assert.match(result.stdout, /^identities=0$/mu);
    assert.match(result.stdout, /^ingress=disabled$/mu);
    assert.match(result.stdout, /^MIGRATION_REQUEST_AUTHORIZED=false$/mu);
    assert.match(result.stdout, /run-auth-rehearsal-strict-db-probe\.sh .* present/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MockPass123|BEGIN CERTIFICATE/u);
    assert.equal(
      readFileSync(join(stateRoot, "source-ca.crt"), "utf8"),
      readFileSync(join(stateRoot, "ca-secret.crt"), "utf8"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failure after secret creation reports a safe partial state and never retries", () => {
  const { result, root } = runMockDeployment({ failUpdate: true });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PARTIAL_SAFE_STATE=CA_SECRET_MAY_EXIST/u);
    assert.match(result.stderr, /FAILED_STAGE=ca_revision_update/u);
    assert.match(result.stderr, /DO_NOT_RETRY_BLINDLY/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MockPass123|BEGIN CERTIFICATE/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
