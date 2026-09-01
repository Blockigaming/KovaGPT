import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const packagePath = "package.json";
const migrationPath = "supabase/migrations/20260901010000_work_execution_v2.sql";
const enginePath = "src/lib/work-execution-v2.server.ts";
const scheduledBuildTestPath = "tests/unit/scheduled-worker-build-v2.test.mjs";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `${label}: expected source was not found`);
  assert.equal(
    source.indexOf(before, index + before.length),
    -1,
    `${label}: expected source was not unique`,
  );
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchPackage() {
  let source = readFileSync(packagePath, "utf8");
  if (source.includes('"build:work-worker": "vite build --config vite.work-worker.config.ts"')) {
    assert.match(source, /"build": "vite build && npm run build:workers"/u);
    assert.match(source, /"worker:work:v2": "node dist\/worker\/work-v2\.mjs"/u);
    return false;
  }

  source = replaceOnce(
    source,
    '    "build": "vite build && npm run build:scheduled-worker",\n    "build:scheduled-worker": "vite build --config vite.scheduled-worker.config.ts",\n    "build:dev": "vite build --mode development && npm run build:scheduled-worker",',
    '    "build": "vite build && npm run build:workers",\n    "build:workers": "npm run build:scheduled-worker && npm run build:work-worker",\n    "build:scheduled-worker": "vite build --config vite.scheduled-worker.config.ts",\n    "build:work-worker": "vite build --config vite.work-worker.config.ts",\n    "build:dev": "vite build --mode development && npm run build:workers",',
    "package worker build scripts",
  );
  source = replaceOnce(
    source,
    '    "worker:scheduled:v2": "node dist/worker/scheduled-v2.mjs",',
    '    "worker:scheduled:v2": "node dist/worker/scheduled-v2.mjs",\n    "worker:work:v2": "node dist/worker/work-v2.mjs",',
    "package Work worker command",
  );
  writeFileSync(packagePath, source);
  return true;
}

function patchMigration() {
  let source = readFileSync(migrationPath, "utf8");
  const marker = "-- Resolve a retried request before checking the owner's active-run limit.";
  if (source.includes(marker)) return false;

  const oldOrder = `  v_tier := public.work_plan_tier_v2(v_user_id);
  v_limit := public.work_max_concurrency_v2(v_tier);
  if v_limit = 0 then
    raise exception 'work_paid_plan_required' using errcode = '42501';
  end if;

  select count(*) into v_active
  from public.agent_jobs job
  where job.owner_id = v_user_id
    and job.deleted_at is null
    and job.status in (
      'queued',
      'leased',
      'running',
      'approval_required',
      'paused',
      'retrying',
      'cancelling'
    );
  if v_active >= v_limit then
    raise exception 'work_concurrency_limit_reached' using errcode = '54000';
  end if;

  select * into v_row
  from public.agent_jobs
  where owner_id = v_user_id
    and idempotency_key = p_idempotency_key
    and deleted_at is null;
  if found then
    return v_row;
  end if;
`;
  const idempotentOrder = `  ${marker}
  select * into v_row
  from public.agent_jobs
  where owner_id = v_user_id
    and idempotency_key = p_idempotency_key
    and deleted_at is null;
  if found then
    return v_row;
  end if;

  v_tier := public.work_plan_tier_v2(v_user_id);
  v_limit := public.work_max_concurrency_v2(v_tier);
  if v_limit = 0 then
    raise exception 'work_paid_plan_required' using errcode = '42501';
  end if;

  select count(*) into v_active
  from public.agent_jobs job
  where job.owner_id = v_user_id
    and job.deleted_at is null
    and job.status in (
      'queued',
      'leased',
      'running',
      'approval_required',
      'paused',
      'retrying',
      'cancelling'
    );
  if v_active >= v_limit then
    raise exception 'work_concurrency_limit_reached' using errcode = '54000';
  end if;
`;

  source = replaceOnce(
    source,
    oldOrder,
    idempotentOrder,
    "Work idempotency before concurrency",
  );
  writeFileSync(migrationPath, source);
  return true;
}

function patchEngine() {
  let source = readFileSync(enginePath, "utf8");
  let changed = false;

  const unsafeSha = '  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("work_source_sha_invalid");';
  const safeSha =
    '  if (!sourceSha || !/^[a-f0-9]{40}$/u.test(sourceSha)) {\n    throw new Error("work_source_sha_invalid");\n  }';
  if (source.includes(unsafeSha)) {
    source = replaceOnce(source, unsafeSha, safeSha, "Work source SHA validation");
    changed = true;
  } else {
    assert.ok(source.includes(safeSha), "Work source SHA guard is missing");
  }

  const unsafeInitialHeartbeat = `  assertClaim(job);
  await heartbeat(dependencies, job, options.leaseSeconds);
  await appendEvent(dependencies, job, "planning_started", {`;
  const safeInitialHeartbeat = `  assertClaim(job);
  try {
    await heartbeat(dependencies, job, options.leaseSeconds);
  } catch (reason) {
    if (reason instanceof WorkOwnerActionError) return settleOwnerAction(dependencies, job);
    throw new WorkLeaseUncertainError("Work lease was uncertain before execution.", {
      cause: reason,
    });
  }
  await appendEvent(dependencies, job, "planning_started", {`;
  if (source.includes(unsafeInitialHeartbeat)) {
    source = replaceOnce(
      source,
      unsafeInitialHeartbeat,
      safeInitialHeartbeat,
      "initial Work heartbeat owner-action fence",
    );
    changed = true;
  } else {
    assert.ok(
      source.includes('Work lease was uncertain before execution.'),
      "initial Work heartbeat fence is missing",
    );
  }

  if (changed) writeFileSync(enginePath, source);
  return changed;
}

function patchScheduledBuildTest() {
  let source = readFileSync(scheduledBuildTestPath, "utf8");
  if (source.includes('packageJson.scripts["build:work-worker"]')) return false;

  source = replaceOnce(
    source,
    'test("the normal production build includes one bundled scheduled worker", () => {\n  assert.equal(packageJson.scripts.build, "vite build && npm run build:scheduled-worker");',
    'test("the normal production build includes both one-shot worker bundles", () => {\n  assert.equal(packageJson.scripts.build, "vite build && npm run build:workers");\n  assert.equal(\n    packageJson.scripts["build:workers"],\n    "npm run build:scheduled-worker && npm run build:work-worker",\n  );',
    "scheduled worker aggregate build assertion",
  );
  source = replaceOnce(
    source,
    '  assert.equal(packageJson.scripts["worker:scheduled:v2"], "node dist/worker/scheduled-v2.mjs");',
    '  assert.equal(packageJson.scripts["worker:scheduled:v2"], "node dist/worker/scheduled-v2.mjs");\n  assert.equal(\n    packageJson.scripts["build:work-worker"],\n    "vite build --config vite.work-worker.config.ts",\n  );\n  assert.equal(packageJson.scripts["worker:work:v2"], "node dist/worker/work-v2.mjs");',
    "scheduled worker Work build assertions",
  );
  writeFileSync(scheduledBuildTestPath, source);
  return true;
}

const changed = [];
if (patchPackage()) changed.push(packagePath);
if (patchMigration()) changed.push(migrationPath);
if (patchEngine()) changed.push(enginePath);
if (patchScheduledBuildTest()) changed.push(scheduledBuildTestPath);

console.log(`KOVAGPT_WORK_V2_SOURCE_APPLIED=${changed.length}`);
for (const path of changed) console.log(path);
