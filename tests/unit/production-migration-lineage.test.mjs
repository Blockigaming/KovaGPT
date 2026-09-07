import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeMigrationManifest,
  classifyRemoteMigrationLineage,
  validateMigrationLineage,
} from "../../scripts/release/migration-preflight.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test("the observed production migration drift is fully inventoried and conservative", () => {
  const manifest = readJson("release-migrations.json");
  const lineage = readJson("release-migration-lineage.json");
  const analysis = validateMigrationLineage(lineage, manifest);

  assert.equal(lineage.targetProjectRef, "mfbycmbjygcfkrsuepxf");
  assert.equal(lineage.observedRemoteMigrationCount, 98);
  assert.equal(lineage.observedSourceMigrationCount, 93);
  assert.equal(analysis.remoteVersions.length, 24);
  assert.equal(analysis.equivalent, 5);
  assert.equal(analysis.schemaProven, 0);
  assert.equal(analysis.requiresSchemaProof, 19);

  const classified = classifyRemoteMigrationLineage(analysis.remoteVersions, lineage);
  assert.deepEqual(classified.unknownRemote, []);
  assert.equal(classified.equivalent.length, 5);
  assert.equal(classified.schemaProven.length, 0);
  assert.equal(classified.requiresSchemaProof.length, 19);

  const manifestAnalysis = analyzeMigrationManifest(manifest);
  for (const entry of lineage.entries.filter((entry) => entry.status === "equivalent")) {
    assert.ok(manifestAnalysis.versions.includes(entry.sourceVersion));
  }
});
