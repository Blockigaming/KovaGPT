#!/usr/bin/env node
import { args, jsonFile, print, result } from "./lib.mjs";

const cli = args();
if (cli.help || !cli.metadata) {
  console.log(
    "Usage: node scripts/staging-validation/azure-rollback.mjs --metadata revisions.json --resource-group RG --app APP --known-good REV --candidate REV [--execute --confirm-staging-mutation]\nDry-run by default; never deletes revisions or changes databases.",
  );
  process.exit(cli.help ? 0 : 2);
}
const data = jsonFile(cli.metadata);
const revisions = Array.isArray(data) ? data : data.revisions || [];
const names = new Set(revisions.map((revision) => revision.name));
const checks = [
  { status: names.has(cli["known-good"]) ? "PASS" : "BLOCKER", code: "known_good_exists" },
  { status: names.has(cli.candidate) ? "PASS" : "BLOCKER", code: "candidate_exists" },
  { status: cli["known-good"] !== cli.candidate ? "PASS" : "BLOCKER", code: "distinct_revisions" },
];
const command = [
  "az",
  "containerapp",
  "ingress",
  "traffic",
  "set",
  "-g",
  cli["resource-group"] || "<RG>",
  "-n",
  cli.app || "<APP>",
  "--revision-weight",
  `${cli["known-good"]}=100`,
  `${cli.candidate}=0`,
];
if (cli.execute && !cli["confirm-staging-mutation"])
  checks.push({ status: "BLOCKER", code: "explicit_confirmation_required" });
print(
  result("azure-rollback", checks, {
    commandClass: cli.execute ? "STAGING MUTATION" : "READ ONLY DRY RUN",
    command,
    executed: false,
    invariant: "revisions, secrets, and databases are never deleted",
  }),
);
