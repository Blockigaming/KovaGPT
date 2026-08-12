import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { gzipSync } from "node:zlib";
const dir = new URL("../../dist/client/assets/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".js"));
const rows = [];
for (const file of files) {
  const data = await readFile(new URL(file, dir));
  rows.push({ file, raw: data.length, gzip: gzipSync(data).length });
}
rows.sort((a, b) => b.raw - a.raw);
const find = (prefix) => rows.find((r) => r.file.startsWith(prefix));
const chart = find("ChatChart-");
const main = rows.filter((r) => r.file.startsWith("index-")).sort((a, b) => b.raw - a.raw)[0];
const initial = rows
  .filter((r) => r.file.startsWith("index-") && r.raw < 150000)
  .sort((a, b) => b.raw - a.raw)[0];
const omega = find("omega-");
const checks = {
  initial: { actual: initial?.raw, budget: 150000, gzip: initial?.gzip, gzipBudget: 60000 },
  main: { actual: main?.raw, budget: 650000, gzip: main?.gzip, gzipBudget: 190000 },
  omega: { actual: omega?.raw, budget: 35000 },
  chartLazy: { actual: chart?.raw, budget: 470000 },
};
const failures = Object.entries(checks).filter(
  ([, v]) => !v.actual || v.actual > v.budget || (v.gzipBudget && v.gzip > v.gzipBudget),
);
const report = { generatedAt: new Date().toISOString(), checks, largest: rows.slice(0, 10) };
await mkdir(new URL("../../artifacts/release/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../../artifacts/release/bundle-report.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
for (const [name, v] of Object.entries(checks))
  console.log(
    `${name}: ${v.actual ?? "missing"} / ${v.budget}${v.gzipBudget ? `; gzip ${v.gzip ?? "missing"} / ${v.gzipBudget}` : ""}`,
  );
if (
  !chart ||
  !omega ||
  statSync(new URL("../../vite.config.ts", import.meta.url)).size === 0 ||
  failures.length
)
  process.exitCode = 1;
