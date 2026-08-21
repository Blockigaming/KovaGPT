import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateRlsMatrix } from "../../scripts/release/rls-two-user.mjs";

const matrix = JSON.parse(readFileSync("release-rls-matrix.json", "utf8"));
const databaseContract = JSON.parse(readFileSync("database-contract.json", "utf8"));

test("committed two-user matrix is execution-ready for every protected table", () => {
  const result = validateRlsMatrix(matrix, databaseContract);
  assert.equal(result.protectedTableCount, 14);
  assert.equal(result.fixtureCount, 14);
  assert.ok(result.bindings.includes("PROJECT_A"));
  assert.equal(new Set(matrix.protectedTables.map((entry) => entry.table)).size, 14);
  for (const entry of matrix.protectedTables) {
    assert.deepEqual(entry.operations, ["select", "update", "delete"]);
    assert.ok(entry.fixture.idColumn);
    assert.ok(Object.keys(entry.fixture.row).length > 0);
    assert.ok(Object.keys(entry.fixture.updatePatch).length > 0);
  }
});

test("project fixtures are ordered before their dependent rows", () => {
  const names = matrix.protectedTables.map((entry) => entry.table);
  const projectIndex = names.indexOf("projects");
  for (const child of ["project_chats", "project_files", "project_memory"])
    assert.ok(
      projectIndex >= 0 && names.indexOf(child) > projectIndex,
      `${child} must follow projects`,
    );
});
