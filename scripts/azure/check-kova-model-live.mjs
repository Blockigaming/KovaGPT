#!/usr/bin/env node
/** Read-only production Kova model configuration audit.
 * Must be run by an authorized Azure operator. No Azure mutations or secret reads.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditKovaModelConfiguration } from "../../src/lib/ai/kova-live-model-readiness.mjs";

export function assessAzureAppReadiness(app) {
  return auditKovaModelConfiguration(app);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const json = execFileSync(
      "az",
      [
        "containerapp",
        "show",
        "--resource-group",
        "rg-kovagpt-prod",
        "--name",
        "kovagpt-prod-web",
        "--output",
        "json",
        "--only-show-errors",
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const report = assessAzureAppReadiness(JSON.parse(json));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.configurationReady) process.exitCode = 1;
  } catch {
    process.stderr.write("Unable to read the exact production KovaGPT app; no changes made.\n");
    process.exitCode = 1;
  }
}
