import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const viteConfig = await readFile("vite.config.ts", "utf8");
const packageJson = await readFile("package.json", "utf8");
const wranglerConfig = await readFile("wrangler.jsonc", "utf8");

function isJavaScript(file) {
  return /\.(?:c|m)?js$/.test(file);
}

async function getAvailablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

test("production uses the repository server entry and emits Lovable's Worker contract", () => {
  assert.doesNotMatch(viteConfig, /@lovable\.dev\/vite-tanstack-config/);
  assert.doesNotMatch(packageJson, /@lovable\.dev\/vite-tanstack-config/);
  assert.match(viteConfig, /tanstackStart\(\{ server: \{ entry: "server" \} \}\)/);
  assert.match(viteConfig, /preset: "cloudflare-module"/);
  assert.match(wranglerConfig, /"main": "src\/server\.ts"/);
});

test("production bundles TanStack's H3 routing graph instead of importing it at runtime", async () => {
  assert.match(viteConfig, /noExternal: \["h3-v2", "rou3"\]/);

  const serverFiles = await readdir("dist/server", { recursive: true });
  const javascriptFiles = serverFiles.filter(isJavaScript);
  for (const file of javascriptFiles) {
    const output = await readFile(`dist/server/${file}`, "utf8");
    assert.doesNotMatch(
      output,
      /(?:from\s*|import\s*\(?)["'](?:h3-v2|h3|rou3)(?:\/[^\"']*)?["']/,
      `${file} must not require Nitro's routing graph from the deployment runtime`,
    );
  }
});

test("every generated bare server import is a declared production dependency", async () => {
  const manifest = JSON.parse(packageJson);
  const serverFiles = await readdir("dist/server", { recursive: true });
  const external = new Set();
  for (const file of serverFiles.filter(isJavaScript)) {
    const output = await readFile(`dist/server/${file}`, "utf8");
    for (const line of output.split("\n")) {
      const match = line.match(/^import\s+(?:[^\"']+\s+from\s+)?["']([^\"']+)["'];?$/);
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

test(
  "generated production Worker boots in workerd and serves dynamic routes",
  { timeout: 45_000 },
  async (t) => {
    const port = await getAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    const output = [];
    const worker = spawn(
      resolve("node_modules/.bin/wrangler"),
      [
        "dev",
        "--config",
        "dist/server/wrangler.json",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          CI: "1",
          WRANGLER_SEND_METRICS: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    worker.stdout.on("data", (chunk) => output.push(chunk.toString()));
    worker.stderr.on("data", (chunk) => output.push(chunk.toString()));

    t.after(async () => {
      if (worker.exitCode !== null) return;
      worker.kill("SIGTERM");
      await Promise.race([once(worker, "exit"), delay(3_000)]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    });

    const deadline = Date.now() + 30_000;
    let healthResponse;
    while (Date.now() < deadline) {
      if (worker.exitCode !== null) {
        assert.fail(`wrangler exited with code ${worker.exitCode}\n${output.join("")}`);
      }
      try {
        const response = await fetch(`${origin}/api/health`);
        if (response.status === 200) {
          healthResponse = response;
          break;
        }
      } catch {
        // Workerd is still starting.
      }
      await delay(250);
    }

    assert.ok(healthResponse, `Worker did not become healthy\n${output.join("")}`);
    const diagnostics = await healthResponse.json();
    assert.equal(diagnostics.ok, true);
    assert.equal(diagnostics.app, "KovaGPT");
    assert.equal(typeof diagnostics.features, "object");

    const rootResponse = await fetch(`${origin}/`);
    const rootBody = await rootResponse.text();
    assert.equal(rootResponse.status, 200, rootBody);
    assert.match(rootBody, /KovaGPT/);
    assert.doesNotMatch(rootBody, /This page didn't load/);
  },
);
