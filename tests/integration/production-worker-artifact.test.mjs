import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const serverDirectory = new URL("../../dist/server/", import.meta.url);
const workerEntry = new URL("index.mjs", serverDirectory);
const workerConfig = new URL("wrangler.json", serverDirectory);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.[cm]?js$/.test(entry.name) ? [url] : [];
  });
}

test("production build emits Lovable's deployable Cloudflare Worker", () => {
  assert.equal(existsSync(workerEntry), true, "dist/server/index.mjs is missing");
  assert.equal(existsSync(workerConfig), true, "dist/server/wrangler.json is missing");

  const config = JSON.parse(readFileSync(workerConfig, "utf8"));
  assert.equal(config.main, "index.mjs");
  assert.match(JSON.stringify(config.assets ?? {}), /\.\.\/client/);
  assert.ok(config.compatibility_flags?.includes("nodejs_compat"));

  const bundledSource = sourceFiles(serverDirectory)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    bundledSource,
    /#tanstack-(?:router-entry|start-entry|start-plugin-adapters)/,
  );
  assert.doesNotMatch(
    bundledSource,
    /import\(\s*["']@tanstack\/react-start\/server-entry["']\s*\)/,
  );
});
