import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

function safeDatabaseUrl(value, productionRef) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("database_evidence_url_invalid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("database_evidence_url_invalid");
  }
  if (productionRef && url.hostname.includes(productionRef)) {
    throw new Error("database_evidence_production_target_prohibited");
  }
  return url.toString();
}

export function evidenceQueries() {
  return [
    ["tables", "select schemaname, tablename, rowsecurity from pg_tables where schemaname in ('public','storage') order by 1,2"],
    ["policies", "select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3"],
    ["functions", "select n.nspname as schema, p.proname, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1,2"],
    ["triggers", "select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation from information_schema.triggers where event_object_schema='public' order by 1,2,3"],
    ["extensions", "select extname, extversion from pg_extension order by 1"],
    ["migrations", "select version from supabase_migrations.schema_migrations order by version"],
    ["rls_disabled", "select n.nspname as schema, c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','storage') and not c.relrowsecurity order by 1,2"],
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = safeDatabaseUrl(
    process.env.KOVA_REHEARSAL_DATABASE_URL ?? "",
    process.env.KOVA_PRODUCTION_SUPABASE_PROJECT_REF ?? "",
  );
  const output = resolve(
    process.env.KOVA_DATABASE_EVIDENCE_FILE ?? "artifacts/database-rehearsal-evidence.json",
  );
  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    targetHost: new URL(databaseUrl).hostname,
    results: {},
  };
  for (const [name, query] of evidenceQueries()) {
    const result = spawnSync(
      "psql",
      [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--csv", "--command", query],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new Error(`database_evidence_query_failed:${name}`);
    evidence.results[name] = result.stdout;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`DATABASE_REHEARSAL_EVIDENCE=${output}`);
}
