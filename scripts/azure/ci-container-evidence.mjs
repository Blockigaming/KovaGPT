import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";

export function verifyContainerProvenance(image, sourceSha, sourceTree) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha) || !/^[a-f0-9]{40}$/u.test(sourceTree)) {
    throw new Error("A complete Git source SHA and tree are required");
  }
  const labels = image?.Config?.Labels;
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(image?.Id ?? "") ||
    labels?.["org.opencontainers.image.revision"] !== sourceSha ||
    labels?.["com.kovagpt.source.tree"] !== sourceTree ||
    image?.Config?.User !== "kova"
  ) {
    throw new Error("Container source or runtime identity does not match the checkout");
  }
  return {
    schemaVersion: 1,
    purpose: "CI review candidate; not a production deployment artifact",
    sourceSha,
    sourceTree,
    imageConfigDigest: image.Id,
    registryManifestDigest: null,
    productionApproved: false,
  };
}

export async function recordCiContainerEvidence(directory = "artifacts/ci-container") {
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const sourceSha = git(["rev-parse", "HEAD"]);
  const sourceTree = git(["rev-parse", "HEAD^{tree}"]);
  const [image] = JSON.parse(
    execFileSync("docker", ["image", "inspect", "kovagpt-web:azure-dev"], { encoding: "utf8" }),
  );
  const evidence = verifyContainerProvenance(image, sourceSha, sourceTree);
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const archive = resolve(output, "kovagpt-ci-image.tar");
  const compressed = `${archive}.gz`;
  execFileSync("docker", ["image", "save", "--output", archive, "kovagpt-web:azure-dev"], {
    stdio: "inherit",
  });
  await pipeline(
    createReadStream(archive),
    createGzip({ level: 1 }),
    createWriteStream(compressed),
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(compressed)) hash.update(chunk);
  const report = {
    ...evidence,
    archive: "kovagpt-ci-image.tar.gz",
    archiveSha256: hash.digest("hex"),
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    recordedAt: new Date().toISOString(),
  };
  await writeFile(resolve(output, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await recordCiContainerEvidence();
  console.log(JSON.stringify(report));
}
