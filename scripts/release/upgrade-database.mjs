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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST = "tests/fixtures/production-migration-history-20260904/manifest.json";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function planUpgrade(root = ROOT) {
  const manifestBytes = readFileSync(join(root, MANIFEST));
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
    const content = readFileSync(join(root, migration.path));
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
  const sourceNames = readdirSync(join(root, "supabase/migrations")).filter((name) =>
    /^\d{14}_.+\.sql$/u.test(name),
  );
  if (new Set(sourceNames.map((name) => name.slice(0, 14))).size !== sourceNames.length)
    throw new Error("upgrade_duplicate_source_version");
  const pending = sourceNames
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name) && !seen.has(name.slice(0, 14)))
    .sort();
  if (!pending.length) throw new Error("upgrade_forward_migrations_missing");
  const forward = pending.map((name) => {
    const content = readFileSync(join(root, "supabase/migrations", name));
    return { name, version: name.slice(0, 14), sha256: sha256(content), content };
  });
  return { manifest, baseline, forward, baselineSha256: sha256(manifestBytes), pending };
}

export function rehearseUpgrade({ root = ROOT, dryRun = false, execute = spawnSync } = {}) {
  const plan = planUpgrade(root);
  if (dryRun)
    return {
      baselineVersions: 97,
      pendingVersions: plan.pending.map((name) => name.slice(0, 14)),
      baselineSha256: plan.baselineSha256,
      executed: false,
    };
  const outputDir = join(root, "artifacts/release");
  mkdirSync(outputDir, { recursive: true });
  for (const file of ["upgrade-database.json", "upgrade-failure.log"])
    rmSync(join(outputDir, file), { force: true });
  const assertions = readFileSync(
    join(root, "scripts/release/upgrade-database-assertions.sql"),
    "utf8",
  );
  const seed = readFileSync(join(root, "scripts/release/upgrade-database-seed.sql"), "utf8");
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
    writeFileSync(join(migrationsDir, basename(migration.path)), migration.content);
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
      /^(?:SUPABASE_(?!NON_INTERACTIVE)|VITE_SUPABASE_|DATABASE_URL|PG[A-Z_]+|DOCKER_CONTEXT|DOCKER_TLS|DOCKER_CERT)/u.test(
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
  const sql = (text) =>
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
      ],
      { input: text },
    );
  let failure;
  let result;
  try {
    supabase(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
    supabase(["db", "reset", "--local", "--no-seed"]);
    sql(
      historyAssertion(
        plan.baseline.map((row) => row.version),
        "baseline",
      ),
    );
    sql(seed);
    for (const migration of plan.forward)
      writeFileSync(join(migrationsDir, migration.name), migration.content);
    supabase(["migration", "up", "--local", "--include-all"]);
    sql(assertions);
    sql(
      historyAssertion(
        [...plan.baseline, ...plan.forward].map((row) => row.version),
        "final",
      ),
    );
    const sourceCommit = run("git", ["-C", root, "rev-parse", "HEAD"]).trim();
    result = {
      schemaVersion: 1,
      passed: true,
      executed: true,
      sourceCommit,
      baselineSha256: plan.baselineSha256,
      baselineVersions: 97,
      pendingVersions: plan.pending.map((name) => name.slice(0, 14)),
      forwardMigrations: plan.forward.map(({ version, sha256 }) => ({ version, sha256 })),
      seedSha256: sha256(seed),
      assertionsSha256: sha256(assertions),
      completedAt: new Date().toISOString(),
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
      JSON.stringify(rehearseUpgrade({ dryRun: process.argv.includes("--dry-run") }), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
