// Promote reviewed developer workspace SQL into the canonical migration
// directory with the Supabase CLI, then regenerate the release inventories.
// Run locally in a clean checkout of the feature branch; never deploy here.
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "supabase/migrations");
const names = [
  "developer_workspace_v2",
  "developer_credit_lots_v2",
  "developer_credit_lot_integration_v2",
  "developer_vector_stores_v1",
  "developer_conversations_v1",
  "developer_agents_v1",
  "developer_skills_v1",
  "developer_webhooks_v1",
  "developer_batches_v1",
  "developer_mcp_connections_v1",
  "developer_prompts_v1",
  "developer_uploads_v1",
];
for (const name of names) {
  const source = await readFile(resolve(root, "supabase/pending", name + ".sql"), "utf8");
  const files = await readdir(dir);
  const existing = files.filter((file) => file.endsWith(`_${name}.sql`));
  if (existing.length) {
    if (existing.length !== 1 || (await readFile(resolve(dir, existing[0]), "utf8")) !== source)
      throw new Error(`Existing migration differs from staged source: ${name}`);
    continue;
  }
  // Ensure unique monotonic versions even if both CLI invocations occur
  // within the same second. Never assign an invented migration timestamp.
  if (name !== names[0]) await new Promise((done) => setTimeout(done, 1100));
  execFileSync(resolve(root, "node_modules/.bin/supabase"), ["migration", "new", name], {
    cwd: root,
    stdio: "inherit",
  });
  const generated = (await readdir(dir)).filter((file) => !files.includes(file));
  if (generated.length !== 1 || !new RegExp(`^\\d{14}_${name}\\.sql$`).test(generated[0])) {
    throw new Error("Expected exactly one CLI-generated migration.");
  }
  if (files.some((file) => file.slice(0, 14) >= generated[0].slice(0, 14)))
    throw new Error("Migration version is not later than the existing history.");
  await writeFile(resolve(dir, generated[0]), source);
}
for (const args of [
  ["run", "release:manifest"],
  ["run", "release:schema"],
  ["run", "release:migrations"],
]) {
  execFileSync("npm", args, { cwd: root, stdio: "inherit" });
}
console.log(
  "Review and commit the migration and regenerated inventories, then run isolated replay.",
);
