import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { inspectMigrationSourceCommit } from "./migration-preflight.mjs";
import { TEMP_EXPORT_CATALOG_SQL } from "./upgrade-database-temp-export-proof.mjs";

const root = resolve(import.meta.dirname, "../..");
const lineage = JSON.parse(readFileSync(join(root, "release-migration-lineage.json"), "utf8"));
const checkpoint = inspectMigrationSourceCommit(lineage.observedSourceCommit, root);
if (checkpoint.ledgerVersions.length !== lineage.observedSourceMigrationCount)
  throw new Error("observed_source_checkpoint_count_mismatch");

// The complete Git object, rather than the current working tree, supplies the
// migration bodies. A unique local project prevents overlap with other CI jobs.
const project = mkdtempSync(join(tmpdir(), "kova-observed-source-"));
const projectId = `kova_observed_${randomUUID().slice(0, 12).replaceAll("-", "")}`;
const migrationsDir = join(project, "supabase/migrations");
const output = resolve(process.argv[2] ?? "artifacts/release/observed-source-temp-export.json");
const cli = join(root, "node_modules/.bin/supabase");
const env = {
  ...process.env,
  SUPABASE_NON_INTERACTIVE: "1",
  DOCKER_HOST: "unix:///var/run/docker.sock",
};
for (const key of Object.keys(env))
  if (
    /^(?:KOVA_PRODUCTION_|SUPABASE_(?!NON_INTERACTIVE)|VITE_SUPABASE_|DATABASE_URL|PG[A-Z_]+|DOCKER_CONTEXT|DOCKER_TLS|DOCKER_CERT|GIT_)/u.test(
      key,
    )
  )
    delete env[key];
mkdirSync(migrationsDir, { recursive: true });
writeFileSync(
  join(project, "supabase/config.toml"),
  `project_id = "${projectId}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`,
);
for (const migration of checkpoint.migrations) {
  const body = execFileSync(
    "git",
    ["-C", root, "show", `${checkpoint.sourceCommit}:supabase/migrations/${migration.filename}`],
    { env, maxBuffer: 64 * 1024 * 1024 },
  );
  if (createHash("sha256").update(body).digest("hex") !== migration.sha256)
    throw new Error("observed_source_migration_body_mismatch");
  writeFileSync(join(migrationsDir, migration.filename), body);
}
const run = (command, args, input, allowFailure = false) => {
  const result = spawnSync(command, args, {
    cwd: project,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 12 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return false;
    if (command === "docker")
      console.error(`Local catalog query error: ${(result.stderr ?? result.error?.message ?? "unknown").slice(-1200)}`);
    throw new Error(`observed_source_local_command_failed:${basename(command)}:${args[0]}`);
  }
  return result.stdout;
};
const supabase = (args, allowFailure = false) =>
  run(cli, [...args, "--workdir", project], undefined, allowFailure);
let started = false;
try {
  supabase(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
  started = true;
  supabase(["db", "reset", "--local", "--no-seed"]);
  const raw = run(
    "docker",
    [
      "--host",
      "unix:///var/run/docker.sock",
      "exec",
      "-i",
      `supabase_db_${projectId}`,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-q",
    ],
    TEMP_EXPORT_CATALOG_SQL,
  );
  const capture = JSON.parse(raw);
  if (
    JSON.stringify(capture.ledgerVersions) !== JSON.stringify(checkpoint.ledgerVersions) ||
    capture.ledgerVersionCount !== checkpoint.ledgerVersions.length ||
    capture.readOnly !== true ||
    capture.isolation !== "repeatable read" ||
    capture.postgresVersionNum < 170000 ||
    capture.postgresVersionNum >= 180000 ||
    capture.databaseName !== "postgres" ||
    capture.publicSchemaPresent !== true ||
    capture.catalogSentinelPresent !== true ||
    capture.exactSignaturePresent !== false ||
    capture.routineFamilyCount !== 0 ||
    capture.inboundDependencyCount !== 0 ||
    capture.storedReferenceCount !== 0
  )
    throw new Error("observed_source_capture_invalid");
  // The existing snapshot validator targets the remote 98-version ledger;
  // this source-only record has its own strict 157-version ledger binding.
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        artifactKind: "observed-source-temporary-export-candidate",
        sourceCommit: checkpoint.sourceCommit,
        sourceTree: checkpoint.sourceTree,
        ledgerVersionsSha256: checkpoint.ledgerVersionsSha256,
        querySha256: createHash("sha256").update(TEMP_EXPORT_CATALOG_SQL).digest("hex"),
        capture,
        schemaProofPromoted: false,
        productionReleaseReady: false,
      },
      null,
      2,
    )}\n`,
  );
  console.log("Observed source checkpoint replayed locally; bounded capture saved for review.");
} finally {
  if (started) supabase(["stop", "--no-backup"], true);
  rmSync(project, { recursive: true, force: true });
}
