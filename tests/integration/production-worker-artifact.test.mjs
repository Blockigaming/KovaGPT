import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const serverDirectory = new URL("../../dist/server/", import.meta.url);
const workerEntry = new URL("index.mjs", serverDirectory);
const workerConfig = new URL("wrangler.json", serverDirectory);
const isWindows = process.platform === "win32";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.[cm]?js$/.test(entry.name) ? [url] : [];
  });
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

async function stopWorker(worker) {
  if (!worker.pid || worker.exitCode !== null) return;

  const signal = (name) => {
    try {
      if (isWindows) worker.kill(name);
      else process.kill(-worker.pid, name);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  signal("SIGTERM");
  await Promise.race([once(worker, "exit").catch(() => undefined), delay(3_000)]);
  if (worker.exitCode === null) signal("SIGKILL");
}

test("production build emits Nitro's deployable Cloudflare Worker", () => {
  assert.equal(existsSync(workerEntry), true, "dist/server/index.mjs is missing");
  assert.equal(existsSync(workerConfig), true, "dist/server/wrangler.json is missing");

  const config = JSON.parse(readFileSync(workerConfig, "utf8"));
  assert.equal(config.main, "index.mjs");
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.assets?.directory, "../client");
  assert.ok(config.compatibility_flags?.includes("nodejs_compat"));

  const bundledSource = sourceFiles(serverDirectory)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    bundledSource,
    /#tanstack-(?:router-entry|start-entry|start-plugin-adapters)/,
  );
});

test(
  "generated production Worker boots in workerd and serves dynamic routes",
  { timeout: 50_000 },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "kovagpt-worker-"));
    await cp("dist", join(fixtureRoot, "dist"), { recursive: true });

    const port = await getAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    const wranglerBinary = resolve("node_modules/.bin", isWindows ? "wrangler.cmd" : "wrangler");
    let output = "";
    let spawnError;
    const worker = spawn(
      wranglerBinary,
      ["--cwd", "dist/server", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port)],
      {
        cwd: fixtureRoot,
        detached: !isWindows,
        env: {
          ...process.env,
          AI_GENERATION_ENABLED: "false",
          AZURE_ENVIRONMENT: "ci",
          CI: "1",
          NO_COLOR: "1",
          WRANGLER_SEND_METRICS: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-12_000);
    };
    worker.stdout.on("data", capture);
    worker.stderr.on("data", capture);
    worker.on("error", (error) => {
      spawnError = error;
      capture(error.stack ?? error.message);
    });

    try {
      const deadline = Date.now() + 30_000;
      let healthResponse;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (worker.exitCode !== null) {
          assert.fail(`wrangler exited with code ${worker.exitCode}\n${output}`);
        }

        try {
          const response = await fetch(`${origin}/api/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (response.status === 200) {
            healthResponse = response;
            break;
          }
        } catch {
          // Workerd is still starting.
        }
        await delay(250);
      }

      assert.ok(healthResponse, `Worker did not become healthy\n${output}`);
      assert.match(healthResponse.headers.get("content-type") ?? "", /application\/json/);
      const diagnostics = await healthResponse.json();
      assert.equal(diagnostics.ok, true);
      assert.equal(diagnostics.app, "KovaGPT");

      const rootResponse = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(5_000),
      });
      const rootBody = await rootResponse.text();
      assert.equal(rootResponse.status, 200, rootBody);
      assert.match(rootResponse.headers.get("content-type") ?? "", /text\/html/);
      assert.match(rootBody, /KovaGPT/);
      assert.doesNotMatch(rootBody, /This page didn't load/);
    } finally {
      await stopWorker(worker);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);
