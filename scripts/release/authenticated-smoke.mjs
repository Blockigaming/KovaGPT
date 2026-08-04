import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const dry = process.argv.includes("--dry-run");
const report = {
  schemaVersion: 1,
  target: "not-run",
  startedAt: new Date().toISOString(),
  paidCapacityConsumed: false,
  workflows: {},
  cleanup: "not-run",
  orphans: [],
};
if (dry) {
  await mkdir("artifacts/release", { recursive: true });
  await writeFile(
    "artifacts/release/authenticated-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (process.env.GITHUB_ENV && report.workflows.administratorDiagnostics?.status === "passed")
    await writeFile(process.env.GITHUB_ENV, "KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS=passed\n", {
      flag: "a",
    });
  console.log("Authenticated smoke dry run: refused all network and mutations.");
  process.exit(0);
}
const required = [
  "KOVA_STAGING_BASE_URL",
  "KOVA_STAGING_ALLOWED_HOST",
  "KOVA_STAGING_DISPOSABLE",
  "KOVA_STAGING_ACCESS_TOKEN",
  "KOVA_STAGING_SECONDARY_TOKEN",
  "KOVA_STAGING_ADMIN_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
];
for (const k of required) if (!process.env[k]) throw new Error(`Missing staging requirement: ${k}`);
const base = new URL(process.env.KOVA_STAGING_BASE_URL);
if (
  base.protocol !== "https:" ||
  base.hostname !== process.env.KOVA_STAGING_ALLOWED_HOST ||
  process.env.KOVA_STAGING_DISPOSABLE !== "1" ||
  (/prod(uction)?/i.test(base.hostname) && process.env.KOVA_ALLOW_PRODUCTION_SMOKE !== "1")
)
  throw new Error("Refusing non-approved disposable staging target");
report.target = base.hostname;
const decodeSub = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
const primary = process.env.KOVA_STAGING_ACCESS_TOKEN,
  secondary = process.env.KOVA_STAGING_SECONDARY_TOKEN,
  admin = process.env.KOVA_STAGING_ADMIN_TOKEN;
const userId = decodeSub(primary);
if (!userId || userId === decodeSub(secondary))
  throw new Error("Two distinct staging identities are required");
if (!decodeSub(admin)) throw new Error("A staging administrator identity is required");
const prefix = `__kova_smoke_${Date.now()}_`,
  url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_PUBLISHABLE_KEY;
const request = (token, path, init = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "X-Correlation-Id": init.correlationId ?? randomUUID(),
      ...(init.headers ?? {}),
    },
  });
const resources = [];
async function workflow(name, table, body, update) {
  const correlationId = randomUUID();
  report.workflows[name] = {
    status: "failed",
    correlationId,
    isolation: { select: false, update: false, delete: false },
    cleanup: "pending",
  };
  let id;
  try {
    const created = await request(primary, table, {
      method: "POST",
      body: JSON.stringify(body),
      correlationId,
    });
    if (!created.ok) {
      report.workflows[name].status = created.status === 404 ? "skipped" : "unavailable";
      return;
    }
    id = (await created.json())[0]?.id;
    if (!id) throw new Error(`${name}_id_absent`);
    resources.push({ table, id, name });
    const read = await request(primary, `${table}?id=eq.${id}`);
    if (!read.ok || (await read.json()).length !== 1) throw new Error(`${name}_owner_read`);
    if (update) {
      const changed = await request(primary, `${table}?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      if (!changed.ok) throw new Error(`${name}_owner_update`);
    }
    for (const [verb, method, payload] of [
      ["select", "GET"],
      ["update", "PATCH", update ?? body],
      ["delete", "DELETE"],
    ]) {
      const cross = await request(secondary, `${table}?id=eq.${id}`, {
        method,
        ...(method === "PATCH" ? { body: JSON.stringify(payload) } : {}),
      });
      const rows = cross.ok ? await cross.json() : [];
      report.workflows[name].isolation[verb] = cross.ok && Array.isArray(rows) && rows.length === 0;
    }
    if (!Object.values(report.workflows[name].isolation).every(Boolean))
      throw new Error(`${name}_owner_isolation`);
    report.workflows[name].status = "passed";
  } catch (error) {
    report.workflows[name].failureCategory = error instanceof Error ? error.message : "unknown";
  }
}
try {
  const ready = await fetch(new URL("/api/readyz", base), { signal: AbortSignal.timeout(10000) });
  if (!ready.ok) throw new Error("Staging readiness failed");
  await workflow(
    "agents",
    "agent_definitions",
    {
      name: prefix + "agent",
      instructions: "Disposable staging contract",
      allowed_tools: [],
      memory_enabled: false,
    },
    { name: prefix + "agent_updated" },
  );
  await workflow(
    "projects",
    "projects",
    { owner_id: userId, name: prefix + "project", description: "disposable" },
    { description: "updated disposable" },
  );
  await workflow(
    "writing",
    "writing_documents",
    {
      owner_id: userId,
      title: prefix + "document",
      content: "disposable",
      content_format: "plain_text",
    },
    { content: "disposable v2", version: 2 },
  );
  const diagnostics = await fetch(new URL("/api/admin/diagnostics", base), {
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${admin}`, "X-Correlation-Id": randomUUID() },
  });
  report.workflows.administratorDiagnostics = {
    status: diagnostics.ok ? "passed" : "failed",
    httpStatus: diagnostics.status,
    cleanup: "not-applicable",
  };
  if (!diagnostics.ok) throw new Error("Administrator diagnostics failed");
  await workflow(
    "library",
    "user_library_items",
    {
      user_id: userId,
      title: prefix + "library",
      item_type: "other",
      source: "manual",
      content_text: "disposable",
    },
    { title: prefix + "library_updated" },
  );
  await workflow(
    "scheduledTasks",
    "scheduled_tasks",
    {
      user_id: userId,
      title: prefix + "task",
      prompt: "disabled disposable",
      run_at: new Date(Date.now() + 86400000).toISOString(),
      repeat: "none",
      status: "paused",
    },
    { title: prefix + "task_updated", status: "paused" },
  );
  for (const name of [
    "conversations",
    "research",
    "files",
    "images",
    "notifications",
    "accountData",
  ])
    report.workflows[name] = {
      status: "skipped",
      reason: "No safe disposable mutation contract is exposed by this release",
      cleanup: "not-applicable",
    };
} finally {
  for (const resource of resources.reverse()) {
    let cleaned = false;
    for (let attempt = 0; attempt < 3 && !cleaned; attempt++) {
      const response = await request(primary, `${resource.table}?id=eq.${resource.id}`, {
        method: "DELETE",
      });
      cleaned = response.ok;
    }
    report.workflows[resource.name].cleanup = cleaned ? "cleaned" : "orphaned";
    if (!cleaned) report.orphans.push(resource);
  }
  report.cleanup = report.orphans.length ? "orphaned" : "cleaned";
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts/release", { recursive: true });
  await writeFile(
    "artifacts/release/authenticated-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (process.env.GITHUB_ENV && report.workflows.administratorDiagnostics?.status === "passed")
    await writeFile(process.env.GITHUB_ENV, "KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS=passed\n", {
      flag: "a",
    });
}
const requiredWorkflowStatuses = Object.entries(report.workflows).filter(
  ([, workflow]) => workflow.cleanup !== "not-applicable",
);
const incompleteWorkflows = requiredWorkflowStatuses.filter(
  ([, workflow]) => workflow.status !== "passed",
);
if (incompleteWorkflows.length || report.orphans.length) {
  throw new Error(
    `Authenticated staging smoke failed; incomplete required workflows: ${
      incompleteWorkflows.map(([name, workflow]) => `${name}:${workflow.status}`).join(", ") ||
      "none"
    }`,
  );
}
console.log("Authenticated staging smoke completed; all required workflows passed.");
