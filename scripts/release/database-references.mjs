import { readdir, readFile } from "node:fs/promises";
const contract = JSON.parse(
  await readFile(new URL("../../database-contract.json", import.meta.url)),
);
const sources = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) sources.push(await readFile(p, "utf8"));
  }
}
await walk("src");
const source = sources.join("\n"),
  tables = new Set([...source.matchAll(/\.from\(["']([a-zA-Z0-9_]+)["']\)/g)].map((m) => m[1])),
  rpcs = new Set([...source.matchAll(/\.rpc\(["']([a-zA-Z0-9_]+)["']/g)].map((m) => m[1]));
const allowedTables = new Set(["objects"]);
const missingTables = [...tables].filter(
  (x) => !contract.tables.includes(x) && !contract.views?.includes(x) && !allowedTables.has(x),
);
const missingRpcs = [...rpcs].filter((x) => !contract.functions.includes(x));
if (missingTables.length || missingRpcs.length) {
  console.error({ missingTables, missingRpcs });
  process.exit(1);
}
console.log(`Database references verified: ${tables.size} tables, ${rpcs.size} RPCs.`);
