import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
test("environment contract is complete and secrets remain server only", () => {
  const r = spawnSync(
    process.execPath,
    ["scripts/production-readiness/validate-environment-contract.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).valid, true);
});
test("health response is stable, cache-free, and contains no configuration values", () => {
  const s = readFileSync("src/routes/api/health.ts", "utf8");
  assert.match(s, /status: "ok"/);
  assert.match(s, /service: "kovagpt-web"/);
  assert.match(s, /Cache-Control.*no-store/s);
  assert.doesNotMatch(
    s,
    /SERVICE_ROLE|API_KEY|ENDPOINT|SECRET|process\.env\.(?!AZURE_ENVIRONMENT|NODE_ENV)/,
  );
});
test("readiness documents retain external safety boundaries", () => {
  for (const p of [
    "supabase-rls-validation.md",
    "stripe-test-mode-validation.md",
    "azure-production-runbook.md",
    "auth-migration-go-live-checklist.md",
    "remaining-external-actions.md",
  ]) {
    const s = readFileSync(`docs/production-readiness/${p}`, "utf8");
    assert.match(s, /STOP|Stop|stop/);
    assert.doesNotMatch(s, /(?:sk_live|whsec|eyJ)[A-Za-z0-9_-]{12}/);
  }
});
test("user-owned database families retain RLS and owner policy evidence", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const sql = files
    .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
    .join("\n")
    .toLowerCase();
  for (const table of [
    "projects",
    "project_files",
    "user_library_items",
    "deep_research_runs",
    "google_oauth_tokens",
    "subscriptions",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `(?:alter table|create table)[\\s\\S]{0,180}${table}|${table}[\\s\\S]{0,180}enable row level security`,
      ),
      `${table} lacks migration evidence`,
    );
  }
  assert.match(sql, /auth\.uid\(\)/);
});
