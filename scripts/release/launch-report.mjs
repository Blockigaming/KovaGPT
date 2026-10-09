import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { LAUNCH_PLUGIN_IDS } from "../../src/lib/core-launch-policy.mjs";
import {
  CORE_LAUNCH_SCOPE,
  CORE_LAUNCH_REQUIRED_GATES,
  PLUGIN_OPERATIONS,
  coreLaunchBlockers,
} from "./core-launch-gates.mjs";

const statuses = new Set(["passed", "failed", "unavailable", "skipped", "not-run"]);
const categories = [
  ...CORE_LAUNCH_REQUIRED_GATES,
  "localBrowser",
  "stripe",
  "agentRunner",
  "production",
  "accessLimits",
  "images",
  "imageCostControls",
];
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 10_000,
}).trim();
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
const target = process.env.KOVA_RELEASE_TARGET ?? "unassigned";
function enabled(name) {
  const value = process.env[name];
  if (value !== undefined && value !== "0" && value !== "1")
    throw new Error(`Invalid flag: ${name}`);
  return value === "1";
}
const scope = {
  id: CORE_LAUNCH_SCOPE,
  paidSubscriptions: enabled("KOVA_LAUNCH_PAID_SUBSCRIPTIONS"),
  imageGeneration: enabled("KOVA_LAUNCH_IMAGE_GENERATION"),
  plugins: [...LAUNCH_PLUGIN_IDS],
};
const plugins = Object.fromEntries(
  LAUNCH_PLUGIN_IDS.map((id) => [
    id,
    {
      commit,
      target,
      ...Object.fromEntries(
        PLUGIN_OPERATIONS.map((operation) => {
          const name = `KOVA_PLUGIN_${id.replaceAll("-", "_").toUpperCase()}_${operation.toUpperCase()}`;
          const status = process.env[name] ?? "not-run";
          if (!statuses.has(status)) throw new Error(`Invalid plugin status: ${name}`);
          return [operation, status];
        }),
      ),
    },
  ]),
);
const report = {
  schemaVersion: 2,
  commit,
  target,
  generatedAt: new Date().toISOString(),
  correlationId,
  scope,
  entries,
  plugins,
};
report.blockers = coreLaunchBlockers(report);
report.launchReady = report.blockers.length === 0;
await mkdir("artifacts/release", { recursive: true });
const json = JSON.stringify(report, null, 2) + "\n";
await writeFile("artifacts/release/launch-report.json", json);
await writeFile(
  "artifacts/release/launch-report.md",
  `# KovaGPT launch report\n\nCommit: \`${commit}\`\n\n${categories.map((name) => `- **${name}**: ${entries[name].status}`).join("\n")}\n\nProduction validated: **${entries.production.productionValidated ? "yes" : "no"}**\n\nCore launch blockers:\n${report.blockers.map((name) => `- ${name}`).join("\n")}\n`,
);
await writeFile(
  "artifacts/release/launch-report.sha256",
  `${createHash("sha256").update(json).digest("hex")}  launch-report.json\n`,
);
console.log(
  `Launch report written; mandatory staging gates ${report.launchReady ? "passed" : "not satisfied"}.`,
);
