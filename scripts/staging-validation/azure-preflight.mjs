#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { args, jsonFile, print, result } from "./lib.mjs";

const cli = args();
if (cli.help) {
  console.log(
    "Usage: node scripts/staging-validation/azure-preflight.mjs (--metadata file.json | --resource-group RG --app APP --live)\nREAD ONLY; live mode invokes az show/list commands only.",
  );
  process.exit(0);
}
let metadata;
if (cli.metadata) metadata = jsonFile(cli.metadata);
else if (cli.live && cli["resource-group"] && cli.app) {
  metadata = JSON.parse(
    execFileSync(
      "az",
      ["containerapp", "show", "-g", cli["resource-group"], "-n", cli.app, "-o", "json"],
      { encoding: "utf8" },
    ),
  );
} else {
  console.error("Provide --metadata or --live --resource-group --app");
  process.exit(2);
}
const properties = metadata.properties || metadata;
const config = properties.configuration || {};
const template = properties.template || {};
const image = template.containers?.[0]?.image || metadata.image || "";
const traffic = config.ingress?.traffic || metadata.traffic || [];
const checks = [
  { status: metadata.name || properties.name ? "PASS" : "BLOCKER", code: "app_exists" },
  {
    status: /@sha256:[a-f0-9]{64}$/u.test(image) ? "PASS" : "BLOCKER",
    code: "immutable_image_digest",
  },
  {
    status:
      config.ingress?.external === false ||
      config.ingress?.allowInsecure === false ||
      metadata.httpsOnly === true
        ? "PASS"
        : "WARNING",
    code: "https_ingress",
  },
  {
    status: (template.scale?.minReplicas ?? metadata.minReplicas ?? 0) >= 0 ? "PASS" : "BLOCKER",
    code: "replica_bounds",
  },
  {
    status:
      traffic.reduce((sum, item) => sum + Number(item.weight || 0), 0) === 100 ? "PASS" : "WARNING",
    code: "traffic_total",
  },
];
print(
  result("azure-preflight", checks, {
    commandClass: "READ ONLY",
    resourceName: metadata.name,
    imageDigestPresent: image.includes("@sha256:"),
    traffic,
  }),
);
