// Promote reviewed developer workspace SQL into the canonical migration
// directory with the Supabase CLI, then regenerate the release inventories.
// Run locally in a clean checkout of the feature branch; never deploy here.
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "supabase/migrations");
const name = "developer_workspace_v2";
const source = await readFile(resolve(root, "supabase/pending/developer_workspace_v2.sql"), "utf8");
const files = await readdir(dir);
if (files.some((file) => file.endsWith(`_${name}.sql`))) {
  throw new Error("Workspace migration already exists; review the existing file.");
}
execFileSync("supabase", ["migration", "new", name], { cwd: root, stdio: "inherit" });
const generated = (await readdir(dir)).filter((file) => !files.includes(file));
if (generated.length !== 1 || !new RegExp(`^\\d{14}_${name}\\.sql$`).test(generated[0])) {
  throw new Error("Expected exactly one CLI-generated migration.");
}
await writeFile(resolve(dir, generated[0]), source);
for (const args of [
  ["run", "release:manifest"],
  ["run", "release:schema"],
  ["run", "release:migrations"],
]) {
  execFileSync("npm", args, { cwd: root, stdio: "inherit" });
}
console.log("Review and commit the migration and regenerated inventories, then run isolated replay.");
