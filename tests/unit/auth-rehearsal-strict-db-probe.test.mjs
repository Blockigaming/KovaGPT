import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  BUNDLED_PG_MODULE,
  classifyConnectionError,
  resolveClientExport,
  runProbe,
  safeCode,
  validateDatabaseAffinity,
} = require("../../scripts/azure/auth-rehearsal-strict-db-probe.cjs");

const directUrl = "postgresql://postgres:secret@db.oztdrjtdglkizlewnulh.supabase.co:5432/postgres";
const poolerUrl =
  "postgresql://postgres.oztdrjtdglkizlewnulh:secret@aws-0-us-west-1.pooler.supabase.com:5432/postgres";
const baselineRevision = "ca-kovagpt-auth-rehearsal--0000006";

test("database affinity accepts only the disposable direct or session-pooler shapes", () => {
  assert.deepEqual(validateDatabaseAffinity(directUrl), {
    kind: "direct",
    hostname: "db.oztdrjtdglkizlewnulh.supabase.co",
    port: 5432,
  });
  assert.deepEqual(validateDatabaseAffinity(poolerUrl), {
    kind: "session_pooler",
    hostname: "aws-0-us-west-1.pooler.supabase.com",
    port: 5432,
  });

  for (const rejected of [
    "postgresql://postgres:secret@db.mfbycmbjygcfkrsuepxf.supabase.co:5432/postgres",
    "postgresql://postgres:secret@db.oztdrjtdglkizlewnulh.supabase.co:6543/postgres",
    `${directUrl}?sslmode=disable`,
    "https://db.oztdrjtdglkizlewnulh.supabase.co/postgres",
    "postgresql://postgres.oztdrjtdglkizlewnulh:secret@evil.example:5432/postgres",
  ]) {
    assert.throws(() => validateDatabaseAffinity(rejected));
  }
});

test("error classification emits fixed safe categories and sanitized codes", () => {
  assert.deepEqual(classifyConnectionError({ code: "SELF_SIGNED_CERT_IN_CHAIN" }), {
    category: "tls_trust",
    code: "SELF_SIGNED_CERT_IN_CHAIN",
  });
  assert.equal(classifyConnectionError({ code: "ENOTFOUND" }).category, "dns");
  assert.equal(classifyConnectionError({ code: "ETIMEDOUT" }).category, "network");
  assert.equal(classifyConnectionError({ code: "28P01" }).category, "authentication");
  assert.equal(classifyConnectionError({ code: "08006" }).category, "postgres_connection");
  assert.equal(classifyConnectionError({ code: "53300" }).category, "capacity");
  assert.equal(classifyConnectionError({ code: "57P03" }).category, "database_not_ready");
  assert.equal(
    classifyConnectionError({ message: "The origin network is temporarily blocked" }).category,
    "network_ban",
  );
  assert.equal(
    classifyConnectionError({ message: "Supavisor circuit breaker open" }).category,
    "pooler_circuit_breaker",
  );
  assert.equal(safeCode({ code: "../../secret" }), "redacted");
});

test("Client export resolution handles named and nested default ESM shapes", () => {
  class FakeClient {
    async connect() {}
    async query() {}
    async end() {}
  }
  assert.equal(resolveClientExport({ Client: FakeClient }), FakeClient);
  assert.equal(resolveClientExport({ default: { Client: FakeClient } }), FakeClient);
  assert.equal(resolveClientExport({ default: { default: { Client: FakeClient } } }), FakeClient);
  assert.equal(resolveClientExport({ unrelated: true }), undefined);
});

test("successful probe uses strict pg options and only SELECT 1", async () => {
  const lines = [];
  const calls = [];
  class FakeClient {
    constructor(options) {
      calls.push({ type: "construct", options });
      this.connection = {
        stream: {
          authorized: true,
          getProtocol: () => "TLSv1.3",
        },
      };
    }
    async connect() {
      calls.push({ type: "connect" });
    }
    async query(sql) {
      calls.push({ type: "query", sql });
      return { rows: [{ ok: 1 }] };
    }
    async end() {
      calls.push({ type: "end" });
    }
  }

  const result = await runProbe({
    env: {
      AUTH_MIGRATION_REHEARSAL_DATABASE_URL: directUrl,
      AUTH_MIGRATION_REHEARSAL_DATABASE_CA: "test-ca",
    },
    moduleImporter: async (specifier) => {
      assert.equal(specifier, new URL(`file://${BUNDLED_PG_MODULE}`).href);
      return { default: { Client: FakeClient } };
    },
    output: (line) => lines.push(line),
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].options.connectionTimeoutMillis, 10_000);
  assert.equal(calls[0].options.ssl.rejectUnauthorized, true);
  assert.equal(calls[0].options.ssl.ca, "test-ca");
  assert.deepEqual(
    calls.filter(({ type }) => type === "query").map(({ sql }) => sql),
    ["SELECT 1 AS ok"],
  );
  assert.match(lines.join("\n"), /PG_MODULE_RESOLUTION=bundled_module/u);
  assert.match(lines.join("\n"), /QUERY_OK=true/u);
});

test("failed pg connection is classified without printing its raw message", async () => {
  const lines = [];
  class FakeClient {
    async connect() {
      const error = new Error("private password and hostname must never be printed");
      error.code = "SELF_SIGNED_CERT_IN_CHAIN";
      throw error;
    }
    async query() {
      throw new Error("query must not run");
    }
    async end() {}
  }

  const result = await runProbe({
    env: { AUTH_MIGRATION_REHEARSAL_DATABASE_URL: poolerUrl },
    moduleImporter: async () => ({ Client: FakeClient }),
    output: (line) => lines.push(line),
  });

  const output = lines.join("\n");
  assert.equal(result.category, "tls_trust");
  assert.match(output, /CATEGORY=tls_trust/u);
  assert.match(output, /ERROR_CODE=SELF_SIGNED_CERT_IN_CHAIN/u);
  assert.doesNotMatch(output, /private password|hostname/u);
  assert.doesNotMatch(output, /secret@/u);
});

test("missing bundled Client falls back to one injected strict TLS preflight", async () => {
  const lines = [];
  let calls = 0;
  const result = await runProbe({
    env: { AUTH_MIGRATION_REHEARSAL_DATABASE_URL: directUrl },
    moduleImporter: async () => ({}),
    tlsPreflight: async ({ hostname, port, ca }) => {
      calls += 1;
      assert.equal(hostname, "db.oztdrjtdglkizlewnulh.supabase.co");
      assert.equal(port, 5432);
      assert.equal(ca, undefined);
      return { protocol: "TLSv1.3", authorized: true };
    },
    output: (line) => lines.push(line),
  });

  assert.equal(calls, 1);
  assert.equal(result.category, "tls_preflight_success_pg_module_unavailable");
  assert.match(lines.join("\n"), /RESULT=partial_success/u);
  assert.match(lines.join("\n"), /QUERY_OK=false/u);
});

test("wrapper rejects invalid revision and CA-state combinations before Azure access", () => {
  const script = "scripts/azure/run-auth-rehearsal-strict-db-probe.sh";
  const cases = [
    [baselineRevision, "present", /CA-present mode requires/u],
    ["ca-kovagpt-auth-rehearsal--0000007", "absent", /CA-absent mode is authorized only/u],
    [baselineRevision, "invalid", /CA state must be absent or present/u],
    ["ca-kovagpt-auth-rehearsal;rm", "absent", /invalid format/u],
  ];

  for (const [revision, state, expected] of cases) {
    const result = spawnSync("bash", [script, revision, state], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stderr, /az: command not found/u);
  }
});

test("operator wrapper remains read-only and contains exactly one container exec", async () => {
  const wrapper = await readFile("scripts/azure/run-auth-rehearsal-strict-db-probe.sh", "utf8");
  const probe = await readFile("scripts/azure/auth-rehearsal-strict-db-probe.cjs", "utf8");

  assert.equal((wrapper.match(/az containerapp exec/gu) ?? []).length, 1);
  assert.equal((wrapper.match(/\brunProbe\(\)/gu) ?? []).length, 1);
  assert.doesNotMatch(probe, /require\.main\s*===\s*module/u);
  assert.doesNotMatch(wrapper, /containerapp ingress enable|containerapp update|secret set/iu);
  assert.doesNotMatch(wrapper, /mfbycmbjygcfkrsuepxf.*(?:secret show|psql)/iu);
  assert.doesNotMatch(wrapper, /psql\s+"\$DB_URL"/u);
  assert.doesNotMatch(wrapper, /--show-values/u);
  assert.doesNotMatch(wrapper, /childEnv\s*=\s*\{\s*\.\.\.process\.env/u);
  assert.match(wrapper, /EXPECTED_PROBE_SHA256="b6279417f5898480/u);
  assert.match(wrapper, /sha256sum "\$PROBE_SOURCE"/u);
  assert.match(wrapper, /BRIDGE_SECRET_NAME="auth-migration-bridge-secret"/u);
  assert.match(wrapper, /CA_SECRET_NAME="auth-migration-rehearsal-database-ca"/u);
  assert.match(wrapper, /EXPECTED_CA_STATE="\$\{2:-absent\}"/u);
  assert.match(wrapper, /assert_ca_environment_state/u);
  assert.match(wrapper, /EXPECTED_CA_FINGERPRINT="807025AD50D4ED21/u);
  assert.match(wrapper, /PROHIBITED_RUNTIME_ENV_COUNT/u);
  assert.match(wrapper, /MODEL_PROVIDER_ENV_COUNT/u);
  assert.match(wrapper, /PGSSLMODE: "require"/u);
  assert.match(wrapper, /"\\\\conninfo"/u);
  assert.match(wrapper, /\\bSSL connection\\b/u);
  assert.match(wrapper, /destination count query lacked client TLS evidence/u);
  assert.doesNotMatch(wrapper, /pg_catalog\\.pg_stat_ssl/u);
  assert.doesNotMatch(wrapper, /ssl !== "true"/u);
  assert.match(wrapper, /for command in az jq node psql sha256sum openssl mktemp script/u);
  assert.match(wrapper, /PROBE_TRANSPORT=pty_stdin/u);
  assert.match(wrapper, /PROBE_STDIN_COMMAND=/u);
  assert.match(wrapper, /printf -v AZ_EXEC_COMMAND/u);
  assert.match(wrapper, /--command sh/u);
  assert.match(wrapper, /script -qefc "\$AZ_EXEC_COMMAND" \/dev\/null/u);
  assert.match(wrapper, /stty -echo/u);
  assert.doesNotMatch(wrapper, /REMOTE_COMMAND=/u);
  assert.doesNotMatch(wrapper, /--command "\$REMOTE_COMMAND"/u);
  assert.match(wrapper, /POST_PROBE_DATABASE_STATE=0\|0/u);
  assert.match(wrapper, /POST_PROBE_CA_STATE=\$EXPECTED_CA_STATE/u);
  assert.match(wrapper, /POST_PROBE_INGRESS=disabled/u);

  assert.match(probe, /rejectUnauthorized:\s*true/u);
  assert.doesNotMatch(probe, /rejectUnauthorized:\s*false/u);
  assert.doesNotMatch(probe, /NODE_TLS_REJECT_UNAUTHORIZED/u);
  assert.equal((probe.match(/SELECT 1 AS ok/gu) ?? []).length, 1);
  assert.doesNotMatch(probe, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/u);
});
