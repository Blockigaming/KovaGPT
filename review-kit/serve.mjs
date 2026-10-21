import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export function startServer() {
  const root = fileURLToPath(new URL("./", import.meta.url));
  const entry = fileURLToPath(new URL("./dist/server/index.mjs", import.meta.url));
  if (!existsSync(entry))
    throw new Error("The actual application build is missing from this package.");
  const child = spawn(
    process.execPath,
    ["--import", fileURLToPath(new URL("./review/network-guard.mjs", import.meta.url)), entry],
    {
      cwd: root,
      env: {
        NODE_ENV: "production",
        AZURE_ENVIRONMENT: "ci",
        HOST: "127.0.0.1",
        PORT: "4189",
        KOVA_PUBLIC_URL: "http://127.0.0.1:4189",
        AI_GENERATION_ENABLED: "false",
        KOVA_GENERATION_DISABLED: "true",
        KOVA_AUTH_MODE: "supabase",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let resolveListening, rejectListening;
  const listening = new Promise((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  // Readiness belongs to this child, never an unrelated listener on the same port.
  let startupOutput = "";
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    startupOutput += chunk.toString();
    if (startupOutput.includes("Listening on:")) resolveListening();
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.once("exit", () =>
    rejectListening(new Error("The isolated preview server exited before readiness.")),
  );
  child.once("error", rejectListening);
  let killTimer;
  function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", () => clearTimeout(killTimer));
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  return { child, stop, listening };
}

export async function ready(server) {
  let timer;
  try {
    await Promise.race([
      server.listening,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The isolated preview server did not announce readiness.")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (server.child.exitCode !== null || server.child.signalCode !== null)
    throw new Error("The isolated preview server is not running.");
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4189/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* Wait only for the local listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local preview did not start. Check that port 4189 is free.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = startServer();
  await ready(server).catch((error) => {
    server.stop();
    throw error;
  });
  console.log(
    "Actual KovaGPT source: http://127.0.0.1:4189/ . Guest gates apply. Ctrl+C stops the preview.",
  );
}
