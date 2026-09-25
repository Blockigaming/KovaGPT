import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateObservation,
  validateTargetConfig,
} from "../../scripts/release/verify-isolated-restore-target.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kova-restore-preflight-"));
  const passfile = join(dir, "pgpass");
  writeFileSync(passfile, "isolated.internal:5432:postgres:restore:placeholder\n", {
    mode: 0o600,
  });
  const env = {
    APPROVED_ISOLATED_PG17_DATABASE_URL: "postgresql://restore@isolated.internal:5432/postgres",
    APPROVED_ISOLATED_HOST: "isolated.internal",
    APPROVED_ISOLATED_DBNAME: "postgres",
    APPROVED_ISOLATED_PORT: "5432",
    APPROVED_ISOLATED_SERVER_IP: "10.0.0.42",
    APPROVED_ISOLATED_SYSTEM_IDENTIFIER: "9999999999999999999",
    PGPASSFILE: passfile,
  };
  return { env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("preflight rejects production endpoints, tunnels, embedded credentials, and connection overrides", () => {
  const { env, cleanup } = fixture();
  try {
    const valid = validateTargetConfig(env);
    assert.equal(valid.expectedSystemId, env.APPROVED_ISOLATED_SYSTEM_IDENTIFIER);
    for (const uri of [
      "postgresql://restore@db.mfbycmbjygcfkrsuepxf.supabase.co:5432/postgres",
      "postgresql://restore@localhost:5432/postgres",
      "postgresql://restore:secret@isolated.internal:5432/postgres",
      "postgresql://restore@isolated.internal:5432/postgres?hostaddr=127.0.0.1",
    ]) {
      assert.throws(() =>
        validateTargetConfig({ ...env, APPROVED_ISOLATED_PG17_DATABASE_URL: uri }),
      );
    }
    assert.throws(() => validateTargetConfig({ ...env, PGPASSWORD: "secret" }));
  } finally {
    cleanup();
  }
});

test("preflight rejects a changed cluster, occupied target, or extension drift", () => {
  const { env, cleanup } = fixture();
  try {
    const approved = validateTargetConfig(env);
    const extensions = [{ name: "plpgsql", version: "1.0", schema: "pg_catalog" }];
    const observed = {
      database: approved.database,
      serverAddress: approved.expectedIp,
      serverPort: approved.port,
      serverVersionNum: 170006,
      systemIdentifier: approved.expectedSystemId,
      authUsers: 0,
      authIdentities: 0,
      authSessions: 0,
      storageBuckets: 0,
      storageObjects: 0,
      applicationRelations: 0,
      extensions,
    };
    assert.equal(validateObservation(observed, approved, extensions), observed);
    assert.throws(() =>
      validateObservation({ ...observed, systemIdentifier: "1" }, approved, extensions),
    );
    assert.throws(() => validateObservation({ ...observed, authUsers: 1 }, approved, extensions));
    assert.throws(() =>
      validateObservation({ ...observed, serverVersionNum: 180000 }, approved, extensions),
    );
    assert.throws(() => validateObservation({ ...observed, extensions: [] }, approved, extensions));
  } finally {
    cleanup();
  }
});

test("preflight runs read-only SQL and records a private target fingerprint", () => {
  const { env, cleanup } = fixture();
  try {
    const dir = dirname(env.PGPASSFILE);
    const output = join(dir, "fingerprint.json");
    const sqlOutput = join(dir, "read-only.sql");
    const mockPsql = join(dir, "psql");
    writeFileSync(
      mockPsql,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "psql (PostgreSQL) 17.6"; exit 0; fi\ncat > "$KOVA_TEST_SQL_OUTPUT"\nprintf "%s\\n" "$KOVA_TEST_OBSERVATION_JSON"\n',
      { mode: 0o700 },
    );
    const source = JSON.parse(
      readFileSync(
        new URL(
          "../../docs/release-reconciliation/managed-schema-recovery-catalog-20260923.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const observed = {
      database: "postgres",
      serverAddress: env.APPROVED_ISOLATED_SERVER_IP,
      serverPort: 5432,
      serverVersionNum: 170006,
      systemIdentifier: env.APPROVED_ISOLATED_SYSTEM_IDENTIFIER,
      authUsers: 0,
      authIdentities: 0,
      authSessions: 0,
      storageBuckets: 0,
      storageObjects: 0,
      applicationRelations: 0,
      extensions: source.extensions,
    };
    const childEnv = {
      ...process.env,
      ...env,
      PATH: `${dir}:${process.env.PATH}`,
      APPROVED_ISOLATED_PREFLIGHT_OUTPUT: output,
      KOVA_TEST_SQL_OUTPUT: sqlOutput,
      KOVA_TEST_OBSERVATION_JSON: JSON.stringify(observed),
    };
    delete childEnv.PGPASSWORD;
    const script = fileURLToPath(
      new URL("../../scripts/release/verify-isolated-restore-target.mjs", import.meta.url),
    );
    const run = spawnSync(process.execPath, [script], { env: childEnv, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /preflight passed/);
    assert.match(
      readFileSync(sqlOutput, "utf8"),
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(receipt.systemIdentifier, env.APPROVED_ISOLATED_SYSTEM_IDENTIFIER);
    assert.equal(receipt.authUsers, 0);
    assert.equal(receipt.requestedHost, env.APPROVED_ISOLATED_HOST);
  } finally {
    cleanup();
  }
});
