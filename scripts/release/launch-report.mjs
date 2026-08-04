import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const statuses = new Set(["passed", "failed", "unavailable", "skipped", "not-run"]);
const categories = [
  "repository",
  "isolatedDatabase",
  "localBrowser",
  "deployedEdge",
  "unauthenticatedSmoke",
  "authenticatedCrud",
  "ownerIsolation",
  "administratorDiagnostics",
  "stripe",
  "connectors",
  "agentRunner",
  "providers",
  "scheduledTasks",
  "storage",
  "stagingE2e",
  "production",
];
const required = new Set([
  "repository",
  "isolatedDatabase",
  "deployedEdge",
  "unauthenticatedSmoke",
  "authenticatedCrud",
  "ownerIsolation",
  "administratorDiagnostics",
  "stagingE2e",
]);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const correlationId = process.env.KOVA_RELEASE_CORRELATION_ID ?? randomUUID();
const entries = Object.fromEntries(
  categories.map((name) => {
    const raw =
      process.env[`KOVA_GATE_${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`] ?? "not-run";
    if (!statuses.has(raw)) throw new Error(`Invalid launch status for ${name}`);
    return [
      name,
      {
        status: raw,
        timestamp: new Date().toISOString(),
        commit,
        target: process.env.KOVA_RELEASE_TARGET ?? "unassigned",
        correlationId,
        credentialsAvailable: process.env.KOVA_STAGING_CREDENTIALS === "1",
        paidCapacityConsumed: false,
        cleanup:
          name === "authenticatedCrud"
            ? (process.env.KOVA_SMOKE_CLEANUP ?? "not-run")
            : "not-applicable",
        productionValidated: name === "production" && raw === "passed",
      },
    ];
  }),
);
const launchReady =
  [...required].every((name) => entries[name].status === "passed") &&
  entries.production.status !== "passed";
const report = {
  schemaVersion: 1,
  commit,
  generatedAt: new Date().toISOString(),
  correlationId,
  launchReady,
  entries,
};
await mkdir("artifacts/release", { recursive: true });
const json = JSON.stringify(report, null, 2) + "\n";
await writeFile("artifacts/release/launch-report.json", json);
await writeFile(
  "artifacts/release/launch-report.md",
  `# KovaGPT launch report\n\nCommit: \`${commit}\`\n\n${categories.map((name) => `- **${name}**: ${entries[name].status}`).join("\n")}\n\nProduction validated: **no**\n`,
);
await writeFile(
  "artifacts/release/launch-report.sha256",
  `${createHash("sha256").update(json).digest("hex")}  launch-report.json\n`,
);
console.log(
  `Launch report written; mandatory staging gates ${launchReady ? "passed" : "not satisfied"}.`,
);
