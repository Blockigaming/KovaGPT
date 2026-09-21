import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectMigrationSourceCommit } from "./migration-preflight.mjs";

export const TEMP_EXPORT_REMOTE_VERSION = "20260824085042";
export const TEMP_EXPORT_CANDIDATE_VERSION = "20260824090000";
export const TEMP_EXPORT_SYMBOL = "_kova_temp_export_day15";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FILENAME = /^(\d{14})_[A-Za-z0-9_.-]+\.sql$/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function readCommittedMigration(repositoryPath, sourceCommit, filename) {
  try {
    return execFileSync(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-C",
        resolve(repositoryPath),
        "show",
        `${sourceCommit}:supabase/migrations/${filename}`,
      ],
      {
        env: gitEnvironment(),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    throw new Error("temp_export_source_migration_unavailable");
  }
}

export function inspectTemporaryExportSource(
  sourceCommit,
  repositoryPath = process.cwd(),
  inspectCheckpoint = inspectMigrationSourceCommit,
  readMigration = readCommittedMigration,
) {
  const checkpoint = inspectCheckpoint(sourceCommit, repositoryPath);
  if (
    checkpoint.sourceCommit !== sourceCommit ||
    !SHA40.test(checkpoint.sourceTree ?? "") ||
    !Array.isArray(checkpoint.migrations) ||
    checkpoint.migrations.length === 0
  )
    throw new Error("temp_export_source_checkpoint_invalid");

  const needle = Buffer.from(TEMP_EXPORT_SYMBOL, "utf8");
  const matchingFiles = [];
  const migrations = checkpoint.migrations.map((migration, index) => {
    const match = FILENAME.exec(migration.filename ?? "");
    if (
      !match ||
      match[1] !== migration.version ||
      migration.version !== checkpoint.ledgerVersions[index] ||
      !SHA256.test(migration.sha256 ?? "")
    )
      throw new Error("temp_export_source_checkpoint_invalid");
    const bytes = readMigration(
      repositoryPath,
      sourceCommit,
      migration.filename,
    );
    if (!Buffer.isBuffer(bytes) || hash(bytes) !== migration.sha256)
      throw new Error("temp_export_source_content_mismatch");
    if (
      Buffer.from(bytes.toString("utf8").toLowerCase(), "utf8").includes(needle)
    )
      matchingFiles.push(migration.filename);
    return {
      order: index + 1,
      version: migration.version,
      filename: migration.filename,
      sha256: migration.sha256,
    };
  });

  return { ...checkpoint, migrations, matchingFiles };
}

export function buildTemporaryExportSourceProof(
  lineage,
  manifest,
  {
    repositoryPath = process.cwd(),
    inspectSource = inspectTemporaryExportSource,
  } = {},
) {
  const entry = lineage?.entries?.find(
    (candidate) => candidate.remoteVersion === TEMP_EXPORT_REMOTE_VERSION,
  );
  if (
    lineage?.observedSourceCommit === undefined ||
    entry?.status !== "requires_schema_proof" ||
    JSON.stringify(entry.candidateSourceVersions) !==
      JSON.stringify([TEMP_EXPORT_CANDIDATE_VERSION]) ||
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.migrations) ||
    manifest.count !== manifest.migrations.length
  )
    throw new Error("temp_export_source_inputs_invalid");

  const inspected = inspectSource(lineage.observedSourceCommit, repositoryPath);
  if (
    inspected.sourceCommit !== lineage.observedSourceCommit ||
    inspected.migrations.length !== lineage.observedSourceMigrationCount ||
    inspected.migrations.length !== manifest.count ||
    inspected.matchingFiles.length !== 0
  )
    throw new Error("temp_export_source_absence_unproven");

  for (let index = 0; index < manifest.migrations.length; index++) {
    const expected = manifest.migrations[index];
    const actual = inspected.migrations[index];
    if (
      expected.order !== index + 1 ||
      expected.timestamp !== actual.version ||
      expected.filename !== actual.filename ||
      expected.sha256 !== actual.sha256
    )
      throw new Error("temp_export_source_manifest_mismatch");
  }

  const candidate = inspected.migrations.find(
    (migration) => migration.version === TEMP_EXPORT_CANDIDATE_VERSION,
  );
  if (!candidate) throw new Error("temp_export_source_candidate_missing");

  const ledgerBytes = inspected.migrations
    .map((migration) => `${migration.filename}\0${migration.sha256}`)
    .join("\n");
  return {
    schemaVersion: 1,
    artifactKind: "temporary-export-full-source-proof",
    proofId: `proof-${TEMP_EXPORT_REMOTE_VERSION}`,
    remoteVersion: TEMP_EXPORT_REMOTE_VERSION,
    candidateSourceVersion: TEMP_EXPORT_CANDIDATE_VERSION,
    searchedSymbol: TEMP_EXPORT_SYMBOL,
    sourceCommit: inspected.sourceCommit,
    sourceTree: inspected.sourceTree,
    migrationCount: inspected.migrations.length,
    ledgerVersionsSha256: inspected.ledgerVersionsSha256,
    ledgerFilesSha256: hash(ledgerBytes),
    candidate,
    matchingFiles: [],
    fullLedgerScanned: true,
    schemaProofPromoted: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const lineage = JSON.parse(
    readFileSync("release-migration-lineage.json", "utf8"),
  );
  const manifest = JSON.parse(readFileSync("release-migrations.json", "utf8"));
  console.log(
    JSON.stringify(buildTemporaryExportSourceProof(lineage, manifest), null, 2),
  );
}
