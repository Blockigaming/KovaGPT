import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENT_WORKER_ID", "OPENAI_API_KEY"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const worker = `${process.env.AGENT_WORKER_ID}:team`,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blockedHostnames = new Set(["localhost", "metadata.google.internal"]);
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    const value = parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (value >= 0x64400000 && value <= 0x647fffff) ||
      (value >= 0x7f000000 && value <= 0x7fffffff) ||
      (value >= 0xa9fe0000 && value <= 0xa9feffff) ||
      (value >= 0xac100000 && value <= 0xac1fffff) ||
      (value >= 0xc0000000 && value <= 0xc00000ff) ||
      (value >= 0xc0000200 && value <= 0xc00002ff) ||
      (value >= 0xc0a80000 && value <= 0xc0a8ffff) ||
      (value >= 0xc6120000 && value <= 0xc613ffff) ||
      (value >= 0xc6336400 && value <= 0xc63364ff) ||
      (value >= 0xcb007100 && value <= 0xcb0071ff) ||
      value >= 0xe0000000
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}
async function assertPublicHttpsUrl(rawUrl, allowedHosts) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("https_required");
  const host = url.hostname.toLowerCase();
  if (
    blockedHostnames.has(host) ||
    [...blockedHostnames].some((domain) => host.endsWith(`.${domain}`))
  )
    throw new Error("domain_blocked");
  if (allowedHosts?.size && !allowedHosts.has(host)) throw new Error("domain_not_allowed");
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error("private_network_blocked");
  return url;
}
const redact = (value) =>
  String(value)
    .replace(/(password|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 100_000);
const roles = {
  planner:
    "Decompose the objective into a precise plan. State assumptions, dependencies, and checkpoints.",
  research:
    "Compare sources, separate evidence from inference, retain source URLs, and identify uncertainty.",
  browser:
    "Inspect only the authorized public website evidence supplied to you. Never claim an action not in the evidence.",
  file: "Analyze only authorized file and workspace context. Identify missing inputs rather than inventing content.",
  coding:
    "Inspect supplied repository context, explain architecture, propose minimal patches, and call out tests and risks.",
  writing:
    "Create a structured, clear deliverable grounded exclusively in supplied context and upstream outputs.",
  review:
    "Act as a skeptical reviewer. Check factual support, citations, completeness, safety, and regressions.",
};
async function claim() {
  const { data: candidates } = await db
    .from("agent_run_tasks")
    .select("*,agent_runs!inner(status,entitlement,objective,policy,project_id)")
    .in("status", ["queued", "retry_wait"])
    .lte("available_at", new Date().toISOString())
    .in("agent_runs.status", ["queued", "running"])
    .order("created_at")
    .limit(10);
  for (const candidate of candidates ?? []) {
    const limit =
      { plus: 1, pro: 3, business: 5, enterprise: 10 }[candidate.agent_runs.entitlement] ?? 1;
    const { count } = await db
      .from("agent_run_tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", candidate.owner_id)
      .in("status", ["leased", "running"]);
    if ((count ?? 0) >= limit) continue;
    const { data } = await db
      .from("agent_run_tasks")
      .update({
        status: "leased",
        lease_owner: worker,
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempt: candidate.attempt + 1,
        started_at: candidate.started_at ?? new Date().toISOString(),
        progress: 5,
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "retry_wait"])
      .select("*,agent_runs!inner(status,entitlement,objective,policy,project_id)")
      .maybeSingle();
    if (data) return data;
  }
  return null;
}
async function event(task, kind, payload, evidence) {
  await db.from("agent_run_events").insert({
    run_id: task.run_id,
    owner_id: task.owner_id,
    kind,
    safe_payload: payload,
    evidence_sha256: evidence ?? null,
  });
}
async function upstream(task) {
  if (!task.dependencies.length) return [];
  const { data } = await db
    .from("agent_run_tasks")
    .select("client_key,title,output_text")
    .eq("run_id", task.run_id)
    .in("client_key", task.dependencies)
    .eq("status", "completed");
  return data ?? [];
}
async function workspaceContext(task) {
  const requested = new Set(task.agent_runs.policy?.contextSources ?? []),
    result = {};
  const safe = async (key, query) => {
    if (!requested.has(key)) return;
    const { data } = await query;
    if (data?.length) result[key] = data;
  };
  if (task.agent_runs.project_id)
    await safe(
      "projects",
      db
        .from("projects")
        .select("id,name,description,system_prompt,updated_at")
        .eq("id", task.agent_runs.project_id)
        .eq("owner_id", task.owner_id)
        .limit(1),
    );
  await Promise.all([
    safe(
      "memory",
      db
        .from("chat_memories")
        .select("title,summary,updated_at")
        .eq("user_id", task.owner_id)
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
    safe(
      "files",
      db
        .from("project_files")
        .select("name,mime_type,kind,size_bytes,created_at,project_id")
        .eq("uploaded_by", task.owner_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
    safe(
      "context_packs",
      db
        .from("context_packs")
        .select("name,description,items,updated_at")
        .eq("user_id", task.owner_id)
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
    safe(
      "library",
      db
        .from("user_library_items")
        .select("title,item_type,content_text,updated_at")
        .eq("user_id", task.owner_id)
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
  ]);
  return result;
}
async function browse(task) {
  const urls = [
    ...`${task.instructions}\n${task.agent_runs.objective}`.matchAll(/https:\/\/[^\s)\]]+/g),
  ].map((match) => match[0]);
  if (!urls.length) throw new Error("browser_source_url_required");
  const initialUrls = [];
  const allowedHosts = new Set();
  for (const url of urls.slice(0, 5)) {
    const parsed = await assertPublicHttpsUrl(url);
    initialUrls.push(parsed.toString());
    allowedHosts.add(parsed.hostname.toLowerCase());
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest()) return route.continue();
    try {
      await assertPublicHttpsUrl(request.url(), allowedHosts);
      return route.continue();
    } catch {
      return route.abort("blockedbyclient");
    }
  });
  try {
    const evidence = [];
    for (const url of initialUrls) {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await assertPublicHttpsUrl(page.url(), allowedHosts);
      const text = redact(await page.locator("body").innerText());
      const shot = await page.screenshot();
      const hash = createHash("sha256").update(shot).digest("hex");
      const storagePath = `${task.owner_id}/${task.run_id}/${task.id}/${Date.now()}-${hash.slice(0, 12)}.png`;
      const uploaded = await db.storage
        .from("agent-evidence")
        .upload(storagePath, shot, { contentType: "image/png", upsert: false });
      if (uploaded.error) throw new Error("screenshot_storage_failed");
      evidence.push({
        url: page.url(),
        title: await page.title(),
        text,
        capturedAt: new Date().toISOString(),
      });
      await event(
        task,
        "screenshot",
        { taskId: task.id, url: new URL(page.url()).origin, byteLength: shot.length, storagePath },
        hash,
      );
      await page.close();
    }
    return evidence;
  } finally {
    await context.close();
    await browser.close();
  }
}
async function generate(task, evidence, dependencies, context) {
  const response = await fetch(
    `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.KOVA_AGENT_MODEL ?? process.env.KOVA_DEEP_MODEL ?? "gpt-4o",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `${roles[task.agent_role]} You are one specialist in a dependency graph. Do not fabricate execution, sources, files, or completed actions.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              objective: task.agent_runs.objective,
              assignment: task.instructions,
              authorizedWorkspaceContext: context,
              upstream: dependencies,
              browserEvidence: evidence,
            }),
          },
        ],
      }),
    },
  );
  if (!response.ok) throw new Error(`agent_provider_${response.status}`);
  const body = await response.json();
  return redact(body.choices?.[0]?.message?.content ?? "");
}
async function release(task) {
  const { data } = await db
    .from("agent_run_tasks")
    .select("id,client_key,dependencies,status")
    .eq("run_id", task.run_id);
  const done = new Set(
    (data ?? []).filter((item) => item.status === "completed").map((item) => item.client_key),
  );
  for (const item of data ?? [])
    if (item.status === "waiting" && item.dependencies.every((key) => done.has(key)))
      await db
        .from("agent_run_tasks")
        .update({ status: "queued", available_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("status", "waiting");
  const { data: run } = await db
    .from("agent_runs")
    .select("status")
    .eq("id", task.run_id)
    .maybeSingle();
  if (!["queued", "running"].includes(run?.status)) return;
  const unfinished = (data ?? []).some((item) => !["completed", "cancelled"].includes(item.status));
  if (!unfinished) {
    const { data: completedRun } = await db
      .from("agent_runs")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", task.run_id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (completedRun) await event(task, "result", { status: "completed", type: "agent_team" });
  }
}
async function execute(task) {
  try {
    await db
      .from("agent_run_tasks")
      .update({ status: "running", progress: 15 })
      .eq("id", task.id)
      .eq("lease_owner", worker);
    await db
      .from("agent_runs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", task.run_id)
      .in("status", ["queued", "running"]);
    const dependencies = await upstream(task),
      context = await workspaceContext(task);
    const evidence =
      task.agent_role === "browser" || task.agent_role === "research"
        ? await browse(task).catch((error) =>
            task.agent_role === "browser" ? Promise.reject(error) : [],
          )
        : [];
    await db
      .from("agent_run_tasks")
      .update({ progress: 60 })
      .eq("id", task.id)
      .eq("lease_owner", worker)
      .eq("status", "running");
    const output = await generate(task, evidence, dependencies, context);
    if (task.checkpoint) {
      const { data: checkpointTask } = await db
        .from("agent_run_tasks")
        .update({
          status: "approval_needed",
          progress: 90,
          output_text: output,
          output_metadata: { evidenceCount: evidence.length },
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq("id", task.id)
        .eq("lease_owner", worker)
        .eq("status", "running")
        .select("id")
        .maybeSingle();
      if (!checkpointTask) return;
      const { data: approvalRun } = await db
        .from("agent_runs")
        .update({ status: "approval_needed" })
        .eq("id", task.run_id)
        .in("status", ["queued", "running"])
        .select("id")
        .maybeSingle();
      if (!approvalRun) return;
      await event(task, "approval", {
        taskId: task.id,
        title: task.title,
        preview: output.slice(0, 1000),
        reason: "Checkpoint requires review before dependent specialists continue",
      });
      return;
    }
    const { data: completedTask } = await db
      .from("agent_run_tasks")
      .update({
        status: "completed",
        progress: 100,
        output_text: output,
        output_metadata: { evidenceCount: evidence.length },
        completed_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", task.id)
      .eq("lease_owner", worker)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
    if (!completedTask) return;
    const { data: parentRun } = await db
      .from("agent_runs")
      .select("status")
      .eq("id", task.run_id)
      .maybeSingle();
    if (!["queued", "running"].includes(parentRun?.status)) return;
    await event(task, "artifact", {
      taskId: task.id,
      role: task.agent_role,
      title: task.title,
      output: output.slice(0, 20_000),
      evidence: evidence.map(({ url, title, capturedAt }) => ({ url, title, capturedAt })),
    });
    await release(task);
  } catch (error) {
    const retry = task.attempt < task.max_attempts,
      delay = Math.min(60_000, 1000 * 2 ** task.attempt);
    const { data: failedTask } = await db
      .from("agent_run_tasks")
      .update({
        status: retry ? "retry_wait" : "failed",
        available_at: new Date(Date.now() + delay).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", task.id)
      .eq("lease_owner", worker)
      .in("status", ["leased", "running"])
      .select("id")
      .maybeSingle();
    if (!failedTask) return;
    await event(task, "error", {
      taskId: task.id,
      code: redact(error instanceof Error ? error.message : "agent_task_failed"),
      retry,
    });
    if (!retry)
      await db
        .from("agent_runs")
        .update({ status: "failed" })
        .eq("id", task.run_id)
        .in("status", ["queued", "running"]);
  }
}
while (true) {
  const task = await claim();
  if (task) await execute(task);
  else await sleep(1500);
}
