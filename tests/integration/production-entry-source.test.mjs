import assert from "node:assert/strict";

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

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
  // The source config is Nitro's input. Production must deploy the generated
  // dist/server/wrangler.json, which the artifact/runtime tests validate.
  assert.match(wranglerConfig, /"main": "src\/server\.ts"/);
});

test("production bundles TanStack's h3-v2 alias instead of importing it at runtime", async () => {
  assert.match(viteConfig, /noExternal: \[[^\]]*"h3-v2"/);

  await buildProductionOutput();

  const serverFiles = await readdir("dist/server", { recursive: true });
  const javascriptFiles = serverFiles.filter((file) => file.endsWith(".js"));
  for (const file of javascriptFiles) {
    const output = await readFile(`dist/server/${file}`, "utf8");
    assert.doesNotMatch(output, /(?:from\s*|import\s*)["']h3-v2["']/, file);
  }
});
