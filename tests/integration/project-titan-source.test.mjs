import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Titan exposes three truthful workspace systems on the existing dashboard", async () => {
  const [dashboard, titan, evolution] = await Promise.all([
    read("src/components/WorkspaceIntelligence.tsx"),
    read("src/components/TitanWorkspaceSystems.tsx"),
    read("src/lib/workspace-evolution.ts"),
  ]);
  assert.match(dashboard, /TitanWorkspaceSystems/);
  assert.match(titan, /Workspace Health|Health index/);
  assert.match(titan, /Workspace DNA|DNA baseline/);
  assert.match(titan, /Time Machine/);
  assert.match(evolution, /workspaceHealth/);
  assert.match(evolution, /workspaceDna/);
});

test("Time Machine checkpoints are bounded, account scoped, and content free", async () => {
  const [evolution, titan] = await Promise.all([
    read("src/lib/workspace-evolution.ts"),
    read("src/components/TitanWorkspaceSystems.tsx"),
  ]);
  assert.match(evolution, /MAX_SNAPSHOTS = 12/);
  assert.match(evolution, /MAX_ENTRIES = 250/);
  assert.match(evolution, /snapshotKey\(scope\)/);
  assert.doesNotMatch(evolution, /title: item\.title|content:/);
  assert.match(titan, /currently authorized|still access/);
});

test("snapshot lifecycle publishes reusable platform events", async () => {
  const titan = await read("src/components/TitanWorkspaceSystems.tsx");
  assert.match(titan, /platformEvents\.publish\("intelligence", "snapshot\.captured"/);
  assert.match(titan, /platformEvents\.publish\("intelligence", "snapshot\.deleted"/);
});
