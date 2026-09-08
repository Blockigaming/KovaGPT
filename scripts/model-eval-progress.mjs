import fs from "node:fs/promises";
import { isMain } from "./model-eval-contract.mjs";

const CHECKPOINT_COUNT = 20;
const STATUSES = new Set(["pending", "in_progress", "blocked", "verified"]);

export function summarizeProgress(ledger) {
  if (
    ledger?.schema_version !== 1 ||
    ledger?.metric !== "engineering_checkpoints" ||
    !Array.isArray(ledger.checkpoints) ||
    ledger.checkpoints.length !== CHECKPOINT_COUNT
  ) {
    throw new Error("Progress must define the versioned 20-checkpoint engineering ledger");
  }
  const ids = new Set();
  for (const checkpoint of ledger.checkpoints) {
    if (
      typeof checkpoint.id !== "string" ||
      !checkpoint.id.trim() ||
      ids.has(checkpoint.id) ||
      typeof checkpoint.title !== "string" ||
      !checkpoint.title.trim() ||
      !STATUSES.has(checkpoint.status) ||
      !Array.isArray(checkpoint.evidence) ||
      checkpoint.evidence.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error("Invalid or duplicate progress checkpoint");
    }
    if (checkpoint.status === "verified" && !checkpoint.evidence.length) {
      throw new Error("Verified progress requires recorded evidence");
    }
    ids.add(checkpoint.id);
  }
  const verified = ledger.checkpoints.filter((item) => item.status === "verified").length;
  return {
    label: "KovaGPT Model progress",
    percent: (verified / CHECKPOINT_COUNT) * 100,
    verified_checkpoints: verified,
    total_checkpoints: CHECKPOINT_COUNT,
    basis: "Recorded engineering milestones, not measured model capability, effort or time",
    replacement_authorized: false,
  };
}

if (isMain(import.meta.url)) {
  const file = new URL("../model/evals/program-progress.json", import.meta.url);
  const ledger = JSON.parse(await fs.readFile(file, "utf8"));
  console.log(JSON.stringify(summarizeProgress(ledger), null, 2));
}
