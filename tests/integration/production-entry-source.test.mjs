import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viteConfig = await readFile("vite.config.ts", "utf8");
const packageJson = await readFile("package.json", "utf8");
const wranglerConfig = await readFile("wrangler.jsonc", "utf8");

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
