import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260901100000_work_browser_research_v2.sql",
  "utf8",
);
const runner = readFileSync("browser-worker/src/runner.mjs", "utf8");
const entry = readFileSync("browser-worker/src/index.mjs", "utf8");
const capture = readFileSync("browser-worker/src/page-capture.mjs", "utf8");
const network = readFileSync("browser-worker/src/network-safety.mjs", "utf8");
const provider = readFileSync("browser-worker/src/azure-openai.mjs", "utf8");
const dockerfile = readFileSync("browser-worker/Dockerfile", "utf8");
const azure = readFileSync("infra/azure/modules/work-worker-jobs.bicep", "utf8");
const product = readFileSync("src/lib/work.functions.ts", "utf8");

function section(start, end) {
  const from = migration.indexOf(start);
  const to = end ? migration.indexOf(end, from + start.length) : migration.length;
  assert.notEqual(from, -1, `missing section ${start}`);
  assert.notEqual(to, -1, `missing section boundary ${end}`);
  return migration.slice(from, to);
}

test("browser jobs are a separately gated extension of the canonical agent_jobs queue", () => {
  assert.match(migration, /check \(kind in \('team', 'browser'\)\)/u);
  assert.match(migration, /browser_enabled boolean not null default false/u);
  assert.match(migration, /browser_active_source_sha/u);
  assert.match(migration, /work_browser_runtime_enabled_v2/u);
  assert.match(migration, /set_work_browser_runtime_v2/u);
  assert.match(migration, /set\s+browser_enabled = false/iu);
  assert.match(product, /export const workExecutionAvailable = false;/u);
});

test("owner browser creation is paid, idempotent, project-scoped, bounded, and read-only", () => {
  const owner = section(
    "create or replace function public.owner_create_browser_work_job_v2",
    "create or replace function public.claim_work_job_kind_v3",
  );
  assert.match(owner, /auth\.uid\(\)/u);
  assert.match(owner, /work_browser_runtime_enabled_v2/u);
  assert.match(owner, /cardinality\(coalesce\(p_source_urls/u);
  assert.match(owner, /not between 1 and 10/u);
  assert.match(owner, /p_destination|p_source_urls/u);
  assert.match(owner, /project_members/u);
  assert.match(owner, /idempotency_key = p_idempotency_key/u);
  assert.match(owner, /work_max_concurrency_v2/u);
  assert.match(owner, /'browser'/u);
  assert.match(owner, /'browser\.read'/u);
  assert.match(owner, /'downloads', false/u);
  assert.match(owner, /'writes', false/u);
});

test("model and browser workers claim only their own job kinds with exact-SHA fencing", () => {
  const claim = section(
    "create or replace function public.claim_work_job_kind_v3",
    "create or replace function public.claim_work_job_v2",
  );
  assert.match(claim, /where job\.kind = p_kind/u);
  assert.match(claim, /for update skip locked/u);
  assert.match(claim, /work_runtime_enabled_v2\(p_source_sha\)/u);
  assert.match(claim, /work_browser_runtime_enabled_v2\(p_source_sha\)/u);
  assert.match(claim, /agent_job_attempts_v2/u);
  assert.match(claim, /lease_token/u);
  assert.match(migration, /claim_work_job_kind_v3\(\s*'team'/u);
  assert.match(migration, /claim_work_job_kind_v3\(\s*'browser'/u);
});

test("browser tool evidence and report settlement are lease-fenced and transactional", () => {
  const record = section(
    "create or replace function public.record_work_browser_tool_result_v2",
    "create or replace function public.settle_work_browser_success_v2",
  );
  const settle = section(
    "create or replace function public.settle_work_browser_success_v2",
    "create or replace function public.record_work_browser_worker_heartbeat_v2",
  );
  assert.match(record, /attempt\.lease_expires_at <= now\(\)/u);
  assert.match(record, /v_job\.state_version <> p_state_version/u);
  assert.match(record, /v_host = any\(v_job\.allowed_domains\)/u);
  assert.match(record, /agent_job_tool_calls_v2/u);
  assert.match(record, /agent_job_evidence_v2/u);
  assert.match(record, /on conflict \(job_id, idempotency_key\)/u);
  assert.match(settle, /work_browser_has_no_successful_sources/u);
  assert.match(settle, /work_browser_has_no_evidence/u);
  assert.match(settle, /settle_work_success_v2/u);
  assert.match(settle, /agent_deliverables/u);
  assert.match(settle, /on conflict \(owner_id, deliverable_key, revision\)/u);
});

test("all worker mutation and readiness RPCs stay service-role only", () => {
  for (const name of [
    "claim_work_job_kind_v3",
    "claim_browser_work_job_v2",
    "record_work_browser_tool_result_v2",
    "settle_work_browser_success_v2",
    "record_work_browser_worker_heartbeat_v2",
    "work_browser_worker_readiness_v2",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?authenticated`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?service_role`, "u"),
    );
  }
  assert.match(
    migration,
    /grant execute on function public\.owner_create_browser_work_job_v2[\s\S]*?authenticated/u,
  );
});

test("browser execution is read-only, DNS-pinned, ephemeral, and download-free", () => {
  assert.match(network, /resolvePinnedPublicUrl/u);
  assert.match(network, /browser_dns_binding_changed/u);
  assert.match(network, /browser_dns_private_or_invalid/u);
  assert.match(capture, /--host-resolver-rules=/u);
  assert.match(capture, /acceptDownloads: false/u);
  assert.match(capture, /javaScriptEnabled: false/u);
  assert.match(capture, /serviceWorkers: "block"/u);
  assert.match(capture, /request\.isNavigationRequest\(\)/u);
  assert.match(capture, /\["GET", "HEAD"\]/u);
  assert.match(capture, /download\.cancel\(\)/u);
  assert.doesNotMatch(capture, /page\.fill|page\.click|page\.type|page\.setInputFiles/u);
});

test("the browser worker stores evidence before managed-identity synthesis and fenced settlement", () => {
  assert.match(runner, /uploadEvidence/u);
  assert.match(runner, /recordToolResult/u);
  assert.match(runner, /dependencies\.synthesize/u);
  assert.match(runner, /research-report/u);
  assert.match(runner, /dependencies\.settleSuccess/u);
  assert.match(runner, /never convert it into a contradictory failure settlement/u);
  assert.match(entry, /claim_browser_work_job_v2/u);
  assert.match(entry, /record_work_browser_tool_result_v2/u);
  assert.match(entry, /settle_work_browser_success_v2/u);
  assert.match(entry, /agent-evidence/u);
});

test("the browser provider boundary is managed-identity only", () => {
  assert.match(provider, /KOVA_RUNTIME_PLATFORM !== "azure-container-apps"/u);
  assert.match(provider, /AZURE_OPENAI_USE_MANAGED_IDENTITY !== "true"/u);
  assert.match(provider, /OPENAI_API_KEY \|\| environment\.AZURE_OPENAI_API_KEY/u);
  assert.match(provider, /X-IDENTITY-HEADER/u);
  assert.match(provider, /\/openai\/v1/u);
  assert.match(provider, /\/responses/u);
  assert.doesNotMatch(provider, /api-key/u);
});

test("the browser runtime is isolated in a pinned Playwright image", () => {
  assert.match(dockerfile, /mcr\.microsoft\.com\/playwright:v1\.56\.0-noble/u);
  assert.match(dockerfile, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/u);
  assert.match(dockerfile, /USER pwuser/u);
  assert.match(dockerfile, /browser-worker\/src\/index\.mjs/u);
  assert.doesNotMatch(dockerfile, /COPY dist|dist\/server/u);
});

test("Azure defines separate exact-SHA model and browser jobs with browser disabled by default", () => {
  assert.match(azure, /param deployBrowserJob bool = false/u);
  assert.match(azure, /resource modelJob 'Microsoft\.App\/jobs@2025-01-01'/u);
  assert.match(
    azure,
    /resource browserJob 'Microsoft\.App\/jobs@2025-01-01' = if \(deployBrowserJob\)/u,
  );
  assert.match(azure, /dist\/worker\/work-v2\.mjs/u);
  assert.match(azure, /KOVA_WORK_BROWSER_WORKER_ENABLED/u);
  assert.match(azure, /browserImageReference/u);
  assert.match(azure, /AZURE_OPENAI_USE_MANAGED_IDENTITY/u);
  assert.match(azure, /sourceSha/u);
  assert.match(azure, /Microsoft\.Insights\/scheduledQueryRules@2023-12-01/u);
  assert.match(azure, /cpu: json\('0\.5'\)/u);
  assert.match(azure, /memory: '1Gi'/u);
});
