#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { print, result } from "./lib.mjs";

const dockerfile = readFileSync("Dockerfile", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");
const checks = [
  { status: /USER kova/u.test(dockerfile) ? "PASS" : "BLOCKER", code: "nonroot_runtime" },
  { status: /dist\/server\/index\.mjs/u.test(dockerfile) ? "PASS" : "BLOCKER", code: "entrypoint" },
  { status: existsSync("src/routes/api/health.ts") ? "PASS" : "BLOCKER", code: "health_route" },
  { status: /\.env/u.test(dockerignore) ? "PASS" : "BLOCKER", code: "env_excluded" },
  { status: existsSync("package-lock.json") ? "PASS" : "BLOCKER", code: "lockfile" },
];
print(
  result("artifact", checks, {
    nodeRuntime: dockerfile.match(/FROM node:([^\s]+)/u)?.[1] || "unknown",
    credentialsInspected: false,
  }),
);
