import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const artifactDirectory = "artifacts/release";
const isolatedSchemaPath = `${artifactDirectory}/isolated-schema.sql`;

class SupabaseCommandFailure extends Error {
  constructor(exitCode) {
    super("Local Supabase command failed");
    this.name = "SupabaseCommandFailure";
    this.exitCode = exitCode;
  }
}

const run = (args, allowFailure = false) => {
  const result = spawnSync("npx", ["supabase", ...args], {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_NON_INTERACTIVE: "1" },
  });

  if (result.error) throw result.error;

  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  if (exitCode !== 0 && !allowFailure) {
    throw new SupabaseCommandFailure(exitCode);
  }
  return exitCode === 0;
};

if (process.argv.includes("--dry-run")) {
  console.log(
    "Isolated database contract: create artifacts/release -> supabase start -> db reset -> migration list -> db dump -> stop. No remote database is used.",
  );
} else {
  mkdirSync(artifactDirectory, { recursive: true });

  let started = false;
  let failure = null;

  try {
    started = run(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
    run(["db", "reset", "--local"]);
    run(["migration", "list", "--local"]);
    run(["db", "dump", "--local", "--schema", "public", "-f", isolatedSchemaPath]);
  } catch (error) {
    failure = error;
  } finally {
    if (started) {
      try {
        const stopped = run(["stop", "--no-backup"], true);
        if (!stopped && !failure) failure = new SupabaseCommandFailure(1);
      } catch (stopError) {
        if (!failure) {
          failure = stopError;
        } else {
          console.error("Local Supabase cleanup also failed after an earlier command failure.");
        }
      }
    }
  }

  if (failure) {
    if (failure instanceof SupabaseCommandFailure) {
      process.exitCode = failure.exitCode;
    } else {
      throw failure;
    }
  }
}
