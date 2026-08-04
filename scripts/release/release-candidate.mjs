import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const hash = async (p) =>
  createHash("sha256")
    .update(await readFile(new URL(`../../${p}`, import.meta.url)))
    .digest("hex");
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const manifest = {
  schemaVersion: 1,
  application: "KovaGPT",
  commit: git("rev-parse", "HEAD"),
  treeClean: git("status", "--porcelain") === "",
  builtAt: new Date().toISOString(),
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  lockfileSha256: await hash("package-lock.json"),
  migrationManifestSha256: await hash("release-migrations.json"),
  schemaContractSha256: await hash("database-contract.json"),
  bundleReportSha256: await hash("artifacts/release/bundle-report.json"),
  routeTreeSha256: await hash("src/routeTree.gen.ts"),
  validation: {
    repository: process.env.KOVA_REPOSITORY_VALIDATED === "1",
    e2e: process.env.KOVA_E2E_VALIDATED === "1",
    staging: process.env.KOVA_STAGING_VALIDATED === "1",
    production: false,
  },
  target: process.env.KOVA_RELEASE_TARGET ?? "unassigned",
};
await mkdir(new URL("../../artifacts/release/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../../artifacts/release/release-candidate.json", import.meta.url),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Release candidate ${manifest.commit}; production unverified.`);
