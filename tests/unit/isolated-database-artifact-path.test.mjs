import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = "scripts/release/isolated-database.mjs";

test("isolated database script creates the release artifact directory before database work", async () => {
  const source = await readFile(path, "utf8");
  const mkdir = source.indexOf("mkdirSync(artifactDirectory, { recursive: true })");
  const start = source.indexOf('run(["start"');
  const dump = source.indexOf('run(["db", "dump"');
  assert.ok(mkdir >= 0 && start > mkdir && dump > start);
  assert.match(
    source,
    /const isolatedSchemaPath = `\$\{artifactDirectory\}\/isolated-schema\.sql`/u,
  );
  assert.match(source, /-f", isolatedSchemaPath/u);
});

test("isolated database script keeps failures authoritative and always stops a started stack", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /if \(r\.status !== 0 && !allow\) process\.exit\(r\.status \?\? 1\)/u);
  assert.match(
    source,
    /finally \{\s*if \(started\) run\(\["stop", "--no-backup"\], true\);\s*\}/su,
  );
  assert.doesNotMatch(source, /db", "dump"[^\n]*, true/u);
});

test("dry-run describes local-only artifact creation without starting Supabase", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /create artifacts\/release/u);
  assert.match(source, /No remote database is used/u);
});
