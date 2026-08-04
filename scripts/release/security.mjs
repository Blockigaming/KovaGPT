import { readdir, readFile } from "node:fs/promises";
const roots = ["src", "scripts", "worker"];
const bad = [];
const secret =
  /(sk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|service_role_key\s*[:=]\s*['"][^'"]+)/i;
async function walk(path) {
  for (const e of await readdir(path, { withFileTypes: true })) {
    const p = `${path}/${e.name}`;
    if (e.isDirectory()) await walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && secret.test(await readFile(p, "utf8")))
      bad.push(p);
  }
}
for (const root of roots) await walk(root);
if (bad.length) {
  console.error("Potential embedded secrets:", bad);
  process.exitCode = 1;
} else console.log("Release secret-pattern scan passed.");
