import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const sql = (await Promise.all(files.map((f) => readFile(new URL(f, dir), "utf8")))).join("\n");
const collect = (regex, index = 1) =>
  [...sql.matchAll(regex)]
    .map((m) => m[index].replaceAll('"', "").trim())
    .filter(Boolean)
    .sort();
const contract = {
  schemaVersion: 1,
  marker: "20260803120000-v1",
  migrationCount: files.length,
  tables: collect(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([\w"]+)/gi),
  views: collect(/create\s+(?:or\s+replace\s+)?view\s+public\.([\w"]+)/gi),
  functions: collect(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([\w"]+)/gi),
  indexes: collect(/create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+([\w"]+)/gi),
  policies: collect(/create\s+policy\s+"?([^"\n]+?)"?\s+on/gi),
  triggers: collect(/create\s+trigger\s+([\w"]+)/gi),
  enums: collect(/create\s+type\s+(?:public\.)?([\w"]+)\s+as\s+enum/gi),
  extensions: collect(/create\s+extension(?:\s+if\s+not\s+exists)?\s+([\w"]+)/gi),
  rlsTables: collect(/alter\s+table\s+(?:public\.)?([\w"]+)\s+enable\s+row\s+level\s+security/gi),
  grants: collect(/grant\s+([^;]+);/gi),
  revocations: collect(/revoke\s+([^;]+);/gi),
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
