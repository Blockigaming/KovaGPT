import { spawnSync } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() ?? "";
const projectRefPattern = /^[a-z0-9]{20}$/;

if (!projectRefPattern.test(projectRef)) {
  console.error(
    "SUPABASE_PROJECT_REF must be set to the exact 20-character hosted project reference before running db:migrate.",
  );
  process.exit(2);
}

if (process.env.CI) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("SUPABASE_ACCESS_TOKEN is required for non-interactive Supabase linking in CI.");
    process.exit(2);
  }
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error("SUPABASE_DB_PASSWORD is required for non-interactive database migration in CI.");
    process.exit(2);
  }
}

const forwardedArgs = process.argv.slice(2).filter((argument) => argument !== "--linked");
const forbiddenTargetFlags = forwardedArgs.filter(
  (argument) =>
    argument === "--local" ||
    argument === "--include-seed" ||
    argument === "--db-url" ||
    argument.startsWith("--db-url="),
);

if (forbiddenTargetFlags.length > 0) {
  console.error(
    `db:migrate is restricted to the explicitly linked hosted project; remove: ${forbiddenTargetFlags.join(
      ", ",
    )}`,
  );
  process.exit(2);
}

const executable = process.platform === "win32" ? "supabase.cmd" : "supabase";

function runSupabase(args) {
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`Unable to run the Supabase CLI: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Linking the Supabase CLI to ${projectRef} before applying migrations.`);
runSupabase(["link", "--project-ref", projectRef]);
runSupabase(["db", "push", "--linked", ...forwardedArgs]);
