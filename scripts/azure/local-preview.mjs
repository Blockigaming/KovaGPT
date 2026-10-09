import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = fileURLToPath(new URL("../../dist/server/index.mjs", import.meta.url));
const guard = fileURLToPath(
  new URL("../../tests/fixtures/azure-local-network-guard.mjs", import.meta.url),
);
if (!existsSync(entry)) throw new Error("Run npm run build:azure first");

// Deliberately do not inherit cloud credentials, database settings or NODE_OPTIONS.
const child = spawn(process.execPath, ["--import", guard, entry], {
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
  stdio: "inherit",
});
let killTimer;
function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
}
const deadline = setTimeout(stop, 180000);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
child.once("error", () => {
  clearTimeout(deadline);
  clearTimeout(killTimer);
  console.error("azure_local_preview_spawn_failed");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  clearTimeout(deadline);
  clearTimeout(killTimer);
  process.exitCode = code ?? (signal === "SIGTERM" ? 0 : 1);
});
