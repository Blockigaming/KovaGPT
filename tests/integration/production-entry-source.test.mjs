import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const vite = readFileSync("vite.config.ts", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const production = readFileSync("infra/azure/production/main.bicep", "utf8");

test("production emits a Node server for Azure Container Apps only", () => {
  assert.match(vite, /tanstackStart\(\{ server: \{ entry: "server" \} \}\)/u);
  assert.match(vite, /preset:\s*"node-server"/u);
  assert.doesNotMatch(vite, /cloudflare-module|@cloudflare\/vite-plugin|wrangler/u);
  assert.match(dockerfile, /CMD \["node", "dist\/server\/index\.mjs"\]/u);
  assert.match(production, /KOVA_RUNTIME_PLATFORM'[\s\S]*azure-container-apps/u);
  assert.equal(existsSync("wrangler.jsonc"), false);
});
