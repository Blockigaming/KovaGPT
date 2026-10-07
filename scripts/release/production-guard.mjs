import { coreLaunchBlockers } from "./core-launch-gates.mjs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const path = process.env.KOVA_APPROVED_LAUNCH_REPORT ?? "artifacts/release/launch-report.json";
const raw = await readFile(path, "utf8");
const expectedHash = process.env.KOVA_APPROVED_LAUNCH_REPORT_SHA256;
if (!expectedHash || createHash("sha256").update(raw).digest("hex") !== expectedHash)
  throw new Error("Launch report hash is not approved");
const report = JSON.parse(raw);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 10_000,
}).trim();
if (report.commit !== commit)
  throw new Error("Launch report commit differs from deployment commit");
const blockers = coreLaunchBlockers(report);
if (blockers.length || report.launchReady !== true)
  throw new Error(`Core launch acceptance is incomplete: ${blockers.join(",") || "launchReady"}`);
if (
  report.entries.authenticatedCrud.cleanup !== "cleaned" ||
  process.env.KOVA_PRODUCTION_HUMAN_APPROVAL !== "APPROVED"
)
  throw new Error("Cleanup or explicit human approval is absent");
console.log(`Production guard approved immutable commit ${commit}; this command does not deploy.`);
