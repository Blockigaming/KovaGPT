import { spawnSync } from "node:child_process";
const run = (args, allow = false) => {
  const r = spawnSync("npx", ["supabase", ...args], {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_NON_INTERACTIVE: "1" },
  });
  if (r.status !== 0 && !allow) process.exit(r.status ?? 1);
  return r.status === 0;
};
if (process.argv.includes("--dry-run")) {
  console.log(
    "Isolated database contract: supabase start -> db reset -> migration list -> db dump -> stop. No remote database is used.",
  );
  process.exit(0);
}
let started = false;
try {
  started = run(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
  run(["db", "reset", "--local"]);
  run(["migration", "list", "--local"]);
  run([
    "db",
    "dump",
    "--local",
    "--schema",
    "public",
    "-f",
    "artifacts/release/isolated-schema.sql",
  ]);
} finally {
  if (started) run(["stop", "--no-backup"], true);
}
