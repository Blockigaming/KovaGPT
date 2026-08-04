import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const seen = new Set(),
  inventory = [];
let failed = false;
for (const [order, filename] of files.entries()) {
  const timestamp = filename.slice(0, 14),
    sql = await readFile(new URL(filename, dir), "utf8");
  if (!/^\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(filename) || seen.has(timestamp)) {
    console.error(`invalid or duplicate migration: ${filename}`);
    failed = true;
  }
  seen.add(timestamp);
  const securityDefiners = [...sql.matchAll(/security\s+definer/gi)].length;
  const safePaths = [...sql.matchAll(/set\s+search_path\s*=\s*(?:public|'')/gi)].length;
  if (
    securityDefiners > safePaths &&
    !files.some((f) => f.includes("release_security_hardening"))
  ) {
    console.error(`unmitigated SECURITY DEFINER search_path: ${filename}`);
    failed = true;
  }
  if (/service_role\s*(?:key|secret)\s*[:=]/i.test(sql)) {
    console.error(`possible secret: ${filename}`);
    failed = true;
  }
  const tables = [
    ...sql.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([\w"]+)/gi),
  ].map((m) => m[1].replaceAll('"', ""));
  const functions = [
    ...sql.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?([\w"]+)/gi),
  ].map((m) => m[1].replaceAll('"', ""));
  inventory.push({
    order: order + 1,
    filename,
    timestamp,
    sha256: createHash("sha256").update(sql).digest("hex"),
    tables,
    functions,
    destructive: /\b(drop|truncate)\s+(table|function)|\bdelete\s+from\b/i.test(sql),
    dataBackfill: /\bupdate\s+\w+\s+set\b|\binsert\s+into\b/i.test(sql),
    reversible: false,
    rls: [
      ...sql.matchAll(/alter\s+table\s+(?:public\.)?([\w"]+)\s+enable\s+row\s+level\s+security/gi),
    ].map((m) => m[1].replaceAll('"', "")),
    policies: [...sql.matchAll(/create\s+policy\s+"?([^"\n]+?)"?\s+on/gi)].map((m) => m[1].trim()),
    indexes: [
      ...sql.matchAll(/create\s+(?:unique\s+)?index(?:\s+if\s+not\s+exists)?\s+([\w"]+)/gi),
    ].map((m) => m[1].replaceAll('"', "")),
  });
}
const manifest = {
  schemaVersion: 1,
  generatedFrom: "supabase/migrations",
  count: inventory.length,
  latest: files.at(-1),
  migrations: inventory,
};
if (process.argv.includes("--write"))
  await writeFile(
    new URL("../../release-migrations.json", import.meta.url),
    await format(JSON.stringify(manifest), { parser: "json", printWidth: 100 }),
  );
console.log(`Validated ${files.length} migrations through ${files.at(-1)}`);
if (failed) process.exitCode = 1;
