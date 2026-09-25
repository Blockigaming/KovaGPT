import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import { activePolicyNames, directTableSelectDecisions } from "./schema-contract-source.mjs";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const sql = (await Promise.all(files.map((f) => readFile(new URL(f, dir), "utf8")))).join("\n");
const collect = (regex, index = 1) =>
  [...sql.matchAll(regex)]
    .map((m) => m[index].replaceAll('"', "").trim())
    .filter(Boolean)
    .sort();
const indexes = [];
for (const match of sql.matchAll(
  /\b(?:create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+(?:[\w"]+\.)?([\w"]+)|drop\s+index(?:\s+concurrently)?(?:\s+if\s+exists)?\s+(?:[\w"]+\.)?([\w"]+))/gi,
)) {
  const created = match[1]?.replaceAll('"', "").trim();
  const dropped = match[2]?.replaceAll('"', "").trim();
  if (created) indexes.push(created);
  if (dropped) {
    for (let index = indexes.length - 1; index >= 0; index -= 1) {
      if (indexes[index] === dropped) indexes.splice(index, 1);
    }
  }
}
const contract = {
  schemaVersion: 1,
  marker: "20260803120000-v1",
  migrationCount: files.length,
  sourceInventoryLimitations:
    "Literal policy and direct table SELECT/ALL statement order only; verify effective grants, conditional SQL, inherited privileges and RLS against the replayed database catalog.",
  tables: collect(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([\w"]+)/gi),
  views: collect(/create\s+(?:or\s+replace\s+)?view\s+public\.([\w"]+)/gi),
  functions: collect(/create\s+(?:or\s+replace\s+)?function\s+(?:[\w"]+\.)?([\w"]+)/gi),
  indexes: indexes.sort(),
  policies: activePolicyNames(sql),
  triggers: collect(/create\s+trigger\s+([\w"]+)/gi),
  enums: collect(/create\s+type\s+(?:public\.)?([\w"]+)\s+as\s+enum/gi),
  extensions: collect(/create\s+extension(?:\s+if\s+not\s+exists)?\s+([\w"]+)/gi),
  rlsTables: collect(/alter\s+table\s+(?:public\.)?([\w"]+)\s+enable\s+row\s+level\s+security/gi),
  // These are historical source statements. The replay catalog is the
  // authority for effective access after conditional SQL and inheritance.
  historicalGrantStatements: collect(/grant\s+([^;]+);/gi),
  historicalRevocationStatements: collect(/revoke\s+([^;]+);/gi),
  directTableSelectDecisions: directTableSelectDecisions(sql),
};
const canonical = JSON.stringify(contract);
const output = { ...contract, sha256: createHash("sha256").update(canonical).digest("hex") };
await writeFile(
  new URL("../../database-contract.json", import.meta.url),
  await format(JSON.stringify(output), { parser: "json", printWidth: 100 }),
);
console.log(
  `Schema contract ${output.sha256}: ${output.tables.length} tables, ${output.functions.length} functions, ${output.policies.length} policies`,
);
