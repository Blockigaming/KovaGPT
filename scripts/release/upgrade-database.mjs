import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "./upgrade-database-current-history.mjs";

import {
  TEMP_EXPORT_CATALOG_SQL,
  TEMP_EXPORT_PROOF_FILE,
  TEMP_EXPORT_QUERY_SHA256,
  buildTemporaryExportProof,
  parseTemporaryExportCapture,
} from "./upgrade-database-temp-export-proof.mjs";

import {
  SCHEDULED_CATALOG_FILE,
  SCHEDULED_CATALOG_SQL,
  SCHEDULED_CATALOG_QUERY_SHA256,
  buildScheduledCatalogEvidence,
  parseScheduledCatalogCapture,
} from "./upgrade-database-scheduled-catalog.mjs";

import {
  captureCleanUpgradeSource,
  assertUpgradeSourceUnchanged,
} from "./upgrade-source-provenance.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST = "tests/fixtures/production-migration-history-20260904/manifest.json";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function planUpgrade(root = ROOT, readSource = readFileSync, readDirectory = readdirSync) {
  const manifestBytes = readSource(join(root, MANIFEST));
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.productionVersionCount !== 97 ||
    !Array.isArray(manifest.migrations) ||
    manifest.migrations.length !== 97
  )
    throw new Error("upgrade_baseline_manifest_invalid");
  const seen = new Set();
  const origins = { matched_source: 0, reviewed_structural_fixture: 0 };
  const baseline = [];
  let previous = "";
  for (const migration of manifest.migrations) {
    if (
      !/^\d{14}$/u.test(migration.version) ||
      migration.version <= previous ||
      seen.has(migration.version) ||
      !/^(?:supabase\/migrations|tests\/fixtures\/production-migration-history-20260904)\/\d{14}_[a-zA-Z0-9_-]+\.sql$/u.test(
        migration.path,
      ) ||
      !basename(migration.path).startsWith(`${migration.version}_`) ||
      !/^[a-f0-9]{64}$/u.test(migration.capturedStatementsSha256) ||
      !/^[a-f0-9]{32}$/u.test(migration.capturedStatementsMd5) ||
      !Number.isInteger(migration.statementCount) ||
      migration.statementCount < 1 ||
      !(migration.origin in origins) ||
      (migration.origin === "matched_source") !== migration.path.startsWith("supabase/")
    )
      throw new Error(`upgrade_baseline_changed:${migration.version}`);
    const content = readSource(join(root, migration.path));
    if (sha256(content) !== migration.sha256)
      throw new Error(`upgrade_baseline_changed:${migration.version}`);
    seen.add(migration.version);
    previous = migration.version;
    origins[migration.origin]++;
    baseline.push({ ...migration, content });
  }
  if (origins.matched_source !== 74 || origins.reviewed_structural_fixture !== 23)
    throw new Error("upgrade_baseline_origins_invalid");
  if (baseline.reduce((sum, row) => sum + row.statementCount, 0) !== 1042)
    throw new Error("upgrade_baseline_statement_count_invalid");
  const sourceNames = readDirectory(join(root, "supabase/migrations")).filter((name) =>
    /^\d{14}_.+\.sql$/u.test(name),
  );
  if (new Set(sourceNames.map((name) => name.slice(0, 14))).size !== sourceNames.length)
    throw new Error("upgrade_duplicate_source_version");
  const pending = sourceNames
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name) && !seen.has(name.slice(0, 14)))
    .sort();
  if (!pending.length) throw new Error("upgrade_forward_migrations_missing");
  const forward = pending.map((name) => {
    const content = readSource(join(root, "supabase/migrations", name));
    return { name, version: name.slice(0, 14), sha256: sha256(content), content };
  });
  return { manifest, baseline, forward, baselineSha256: sha256(manifestBytes), pending };
}

export function rehearseUpgrade({
  root = ROOT,
  dryRun = false,
  currentHistory = false,
  captureTemporaryExport = false,
  captureScheduledCatalog = false,
  execute = spawnSync,
  inspectSource = captureCleanUpgradeSource,
} = {}) {
  const outputDir = join(root, "artifacts/release");
  // A failed full-run preflight must not leave an earlier success artifact.
  // Dry runs remain observational, including when their input is invalid.
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    for (const file of [
      "upgrade-database.json",
      "upgrade-failure.log",
      TEMP_EXPORT_PROOF_FILE,
      SCHEDULED_CATALOG_FILE,
    ])
      rmSync(join(outputDir, file), { force: true });
  }
  let plan;
  let sourceBefore;
  let readSource = readFileSync;
  let readDirectory = readdirSync;
  try {
    if (captureScheduledCatalog && !currentHistory)
      throw new Error("upgrade_scheduled_catalog_current_history_required");
    if (captureTemporaryExport && !currentHistory)
      throw new Error("upgrade_temp_export_current_history_required");
    if (!dryRun) {
      sourceBefore = inspectSource(root);
      assertUpgradeSourceUnchanged(sourceBefore, sourceBefore);
      readSource = sourceBefore.readFile;
      readDirectory = sourceBefore.readDirectory;
    }
    const historical = planUpgrade(root, readSource, readDirectory);
    plan = currentHistory
      ? extendCurrentHistory(historical, readSource(join(root, CURRENT_HISTORY_SNAPSHOT)))
      : historical;
  } catch (error) {
    if (!dryRun) {
      // Parser and filesystem errors may contain input bytes or local paths.
      // Persist only a bounded validation code, never arbitrary error text.
      const code = /^upgrade_[a-z0-9_]{1,120}$/u.test(error?.message ?? "")
        ? error.message
        : "invalid_input";
      writeFileSync(join(outputDir, "upgrade-failure.log"), `upgrade_preflight_failed:${code}\n`);
    }
    throw error;
  }
  const executionForward = plan.executionForward ?? plan.forward;
  const baselineVersions = plan.baseline.map((row) => row.version);
  const finalVersions = [...plan.baseline, ...executionForward].map((row) => row.version);
  const currentHistoryEvidence = plan.currentHistory
    ? {
        currentHistory: plan.currentHistory,
        replayPendingVersions: executionForward.map((row) => row.version),
      }
    : {};
  if (dryRun)
    return {
      baselineVersions: plan.baseline.length,
      pendingVersions: plan.pending.map((name) => name.slice(0, 14)),
      baselineSha256: plan.baselineSha256,
      executed: false,
      ...(captureTemporaryExport
        ? {
            temporaryExportProofPlanned: true,
            temporaryExportQuerySha256: TEMP_EXPORT_QUERY_SHA256,
          }
        : {}),
      ...(captureScheduledCatalog
        ? {
            scheduledCatalogPlanned: true,
            scheduledCatalogQuerySha256: SCHEDULED_CATALOG_QUERY_SHA256,
          }
        : {}),
      ...currentHistoryEvidence,
    };
  let assertions, seed;
  try {
    assertions = readSource(join(root, "scripts/release/upgrade-database-assertions.sql")).toString(
      "utf8",
    );
    seed = readSource(join(root, "scripts/release/upgrade-database-seed.sql")).toString("utf8");
  } catch (error) {
    writeFileSync(join(outputDir, "upgrade-failure.log"), "upgrade_source_input_check_failed\n");
    throw error;
  }
  const project = mkdtempSync(join(tmpdir(), "kova-upgrade-"));
  const projectId = `kova_upgrade_${basename(project)
    .replace(/[^a-zA-Z0-9_]/gu, "_")
    .toLowerCase()}`;
  const supabaseDir = join(project, "supabase");
  const migrationsDir = join(supabaseDir, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(
    join(supabaseDir, "config.toml"),
    `project_id = "${projectId}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`,
  );
  for (const migration of plan.baseline)
    writeFileSync(
      join(migrationsDir, migration.replayName ?? basename(migration.path)),
      migration.content,
    );
  const cli = join(root, "node_modules/.bin/supabase");
  if (!existsSync(cli)) {
    rmSync(project, { recursive: true, force: true });
    throw new Error("upgrade_pinned_local_cli_missing");
  }
  // Commands are pinned to a unique local project and local Docker socket.
  // Never inherit a cloud token or alternate Docker endpoint from a release job.
  const env = {
    ...process.env,
    SUPABASE_NON_INTERACTIVE: "1",
    DOCKER_HOST: "unix:///var/run/docker.sock",
  };
  for (const key of Object.keys(env))
    if (
      /^(?:KOVA_PRODUCTION_|SUPABASE_(?!NON_INTERACTIVE)|VITE_SUPABASE_|DATABASE_URL|PG[A-Z_]+|DOCKER_CONTEXT|DOCKER_TLS|DOCKER_CERT)/u.test(
        key,
      )
    )
      delete env[key];
  const run = (command, args, { input, allowFailure = false } = {}) => {
    let result;
    try {
      result = execute(command, args, {
        cwd: project,
        env,
        input,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 12 * 60 * 1000,
      });
    } catch (error) {
      result = { error, stderr: error.message };
    }
    if (result.error || result.status !== 0) {
      if (allowFailure) return false;
      // Local SQL may include historical function bodies; keep the full log in
      // the local artifact only and emit a bounded generic command failure.
      writeFileSync(
        join(outputDir, "upgrade-failure.log"),
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      );
      throw new Error(
        `upgrade_local_command_failed:${basename(command)}:${args[0]}:${result.status ?? "spawn"}`,
      );
    }
    return result.stdout ?? "";
  };
  const supabase = (args, options) => run(cli, [...args, "--workdir", project], options);
  const sql = (text, tuplesOnly = false) =>
    run(
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
        ...(tuplesOnly ? ["-A", "-t", "-q"] : []),
      ],
      { input: text },
    );
  let failure;
  let result;
  let baselineCapture;
  let proofBytes;
  let scheduledBaseline;
  let scheduledBytes;
  try {
    supabase(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
    supabase(["db", "reset", "--local", "--no-seed"]);
    sql(
      historyAssertion(
        plan.baseline.map((row) => row.version),
        "baseline",
      ),
    );
    if (captureTemporaryExport)
      baselineCapture = parseTemporaryExportCapture(
        sql(TEMP_EXPORT_CATALOG_SQL, true),
        baselineVersions,
      );
    if (captureScheduledCatalog)
      scheduledBaseline = parseScheduledCatalogCapture(
        sql(SCHEDULED_CATALOG_SQL, true),
        baselineVersions,
      );
    sql(seed);
    for (const migration of executionForward)
      writeFileSync(join(migrationsDir, migration.name), migration.content);
    supabase(["migration", "up", "--local", "--include-all"]);
    sql(assertions);
    sql(
      historyAssertion(
        [...plan.baseline, ...executionForward].map((row) => row.version),
        "final",
      ),
    );
    const upgradedCapture = captureTemporaryExport
      ? parseTemporaryExportCapture(sql(TEMP_EXPORT_CATALOG_SQL, true), finalVersions)
      : null;
    const scheduledUpgraded = captureScheduledCatalog
      ? parseScheduledCatalogCapture(sql(SCHEDULED_CATALOG_SQL, true), finalVersions)
      : null;

    const sourceCommit = run("git", ["-C", root, "rev-parse", "HEAD"]).trim();
    const sourceTree =
      captureTemporaryExport || captureScheduledCatalog
        ? run("git", ["-C", root, "rev-parse", "HEAD^{tree}"]).trim()
        : null;
    if (
      sourceCommit !== sourceBefore.commit ||
      (sourceTree !== null && sourceTree !== sourceBefore.tree)
    )
      throw new Error("upgrade_source_changed_during_rehearsal");
    if (captureScheduledCatalog)
      scheduledBytes =
        JSON.stringify(
          buildScheduledCatalogEvidence({
            baseline: scheduledBaseline,
            upgraded: scheduledUpgraded,
            baselineVersions,
            finalVersions,
            sourceCommit,
            sourceTree,
          }),
          null,
          2,
        ) + "\n";
    if (captureTemporaryExport) {
      proofBytes =
        JSON.stringify(
          buildTemporaryExportProof({
            baseline: baselineCapture,
            upgraded: upgradedCapture,
            baselineVersions,
            finalVersions,
            sourceCommit,
            sourceTree,
          }),
          null,
          2,
        ) + "\n";
    }
    result = {
      schemaVersion: 1,
      passed: true,
      executed: true,
      sourceCommit,
      baselineSha256: plan.baselineSha256,
      baselineVersions: plan.baseline.length,
      pendingVersions: plan.pending.map((name) => name.slice(0, 14)),
      forwardMigrations: executionForward.map(({ version, sha256 }) => ({ version, sha256 })),
      seedSha256: sha256(seed),
      assertionsSha256: sha256(assertions),
      completedAt: new Date().toISOString(),
      ...(proofBytes
        ? {
            temporaryExportProof: {
              file: TEMP_EXPORT_PROOF_FILE,
              sha256: sha256(proofBytes),
              querySha256: TEMP_EXPORT_QUERY_SHA256,
            },
          }
        : {}),
      ...(scheduledBytes
        ? {
            scheduledCatalog: {
              file: SCHEDULED_CATALOG_FILE,
              sha256: sha256(scheduledBytes),
              querySha256: SCHEDULED_CATALOG_QUERY_SHA256,
            },
          }
        : {}),
      ...currentHistoryEvidence,
    };
  } catch (error) {
    failure = error;
  } finally {
    // A failed start may still have created local containers. The generated
    // project ID ensures cleanup cannot target another project.
    const stopped = supabase(["stop", "--no-backup"], { allowFailure: true });
    rmSync(project, { recursive: true, force: true });
    if (stopped === false) {
      appendFileSync(
        join(outputDir, "upgrade-failure.log"),
        `\nLocal cleanup failed for ${projectId}.\n`,
      );
      if (!failure) failure = new Error("upgrade_local_cleanup_failed");
    }
  }
  if (failure) throw failure;
  try {
    assertUpgradeSourceUnchanged(sourceBefore, inspectSource(root));
  } catch (error) {
    writeFileSync(join(outputDir, "upgrade-failure.log"), "upgrade_source_final_check_failed\n");
    throw error;
  }
  if (proofBytes) writeFileSync(join(outputDir, TEMP_EXPORT_PROOF_FILE), proofBytes);
  if (scheduledBytes) writeFileSync(join(outputDir, SCHEDULED_CATALOG_FILE), scheduledBytes);
  writeFileSync(join(outputDir, "upgrade-database.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

function historyAssertion(versions, phase) {
  // Every value came from the strict numeric filename validator, never user SQL.
  return `do $$ begin if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations) is distinct from array[${versions
    .sort()
    .map((version) => `'${version}'`)
    .join(",")}]::text[] then raise exception 'upgrade_${phase}_history_mismatch'; end if; end $$;`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        rehearseUpgrade({
          dryRun: process.argv.includes("--dry-run"),
          currentHistory: !process.argv.includes("--historical-baseline"),
          captureTemporaryExport: !process.argv.includes("--historical-baseline"),
          captureScheduledCatalog: !process.argv.includes("--historical-baseline"),
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
