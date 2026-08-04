import assert from "node:assert/strict";

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { promisify } from "node:util";

import { readFile } from "node:fs/promises";


import test from "node:test";

const execFileAsync = promisify(execFile);

const viteConfig = await readFile("vite.config.ts", "utf8");
const packageJson = await readFile("package.json", "utf8");
const wranglerConfig = await readFile("wrangler.jsonc", "utf8");


async function buildProductionOutput() {
  await execFileAsync("npm", ["run", "build"], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

test("production uses the repository server entry without a private Vite wrapper", () => {

test("production uses the repository server entry and emits Nitro's Worker contract", () => {

  assert.doesNotMatch(viteConfig, /@lovable\.dev\/vite-tanstack-config/);
  assert.doesNotMatch(packageJson, /@lovable\.dev\/vite-tanstack-config/);
  assert.match(viteConfig, /tanstackStart\(\{ server: \{ entry: "server" \} \}\)/);
  assert.match(
    viteConfig,
    /preset:\s*useNodeBrowserPreview \? "node-server" : "cloudflare-module"/,
  );
  assert.match(viteConfig, /serverDir: "dist\/server"/);
  assert.match(viteConfig, /publicDir: "dist\/client"/);
  assert.match(viteConfig, /cloudflare: \{ nodeCompat: true, deployConfig: true \}/);


test("production bundles TanStack's H3 routing graph instead of importing it at runtime", { skip: !existsSync("dist/server") }, async () => {
  assert.match(viteConfig, /noExternal: \["h3-v2", "rou3"\]/);

test("production bundles TanStack's h3-v2 alias instead of importing it at runtime", async () => {
  assert.match(viteConfig, /noExternal: \["h3-v2"\]/);

  await buildProductionOutput();


  const serverFiles = await readdir("dist/server", { recursive: true });
  const javascriptFiles = serverFiles.filter((file) => file.endsWith(".js"));
  for (const file of javascriptFiles) {
    const output = await readFile(`dist/server/${file}`, "utf8");
    assert.doesNotMatch(output, /(?:from\s*|import\s*)["']h3-v2["']/, file);
  }


test("every generated bare server import is a declared production dependency", { skip: !existsSync("dist/server") }, async () => {
  const manifest = JSON.parse(packageJson);
  const serverFiles = await readdir("dist/server", { recursive: true });
  const external = new Set();
  for (const file of serverFiles.filter((entry) => entry.endsWith(".js"))) {
    const output = await readFile(`dist/server/${file}`, "utf8");
    for (const line of output.split("\n")) {
      const match = line.match(/^import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["'];?$/);
      const specifier = match?.[1];
      if (!specifier || specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      external.add(packageName);
    }
  }
  for (const dependency of external) {
    assert.ok(manifest.dependencies[dependency], `${dependency} must be a production dependency`);
  }
  for (const required of [
    "react",
    "react-dom",
    "@tanstack/history",
    "@tanstack/router-core",
    "seroval",
    "srvx",
  ]) {
    assert.ok(external.has(required), `${required} should be covered by the server import audit`);
  }
});

test("generated production server entry can be imported by Node", { skip: !existsSync("dist/server/server.js") }, async () => {
  const entry = `${pathToFileURL(resolve("dist/server/server.js")).href}?audit=${Date.now()}`;
  const loaded = await import(entry);
  assert.equal(typeof loaded.default?.fetch, "function");

  // The source config is Nitro's input. Production must deploy the generated
  // dist/server/wrangler.json, which the artifact/runtime tests validate.
  assert.match(wranglerConfig, /"main": "src\/server\.ts"/);


});
