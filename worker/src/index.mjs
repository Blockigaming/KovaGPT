import http from "node:http";
import os from "node:os";
import { rm, mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { assertPublicUrl } from "./network-safety.mjs";

const version = process.env.WORKER_VERSION || "1.0.0";
const identity = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
const pollMs = bounded("WORKER_POLL_MS", 1000, 100, 60000);
const concurrency = bounded("WORKER_CONCURRENCY", 2, 1, 16);
const leaseSeconds = bounded("WORKER_LEASE_SECONDS", 60, 15, 900);
const port = bounded("WORKER_PORT", 8788, 1, 65535);
const tempRoot = process.env.WORKER_TEMP_DIR || "/tmp/kova-agent";
const secretPattern = /(token|secret|password|authorization|cookie|api[-_]?key)/i;
const active = new Map();
let stopping = false;
let polling = false;
let browser;
let lastPollAt = null;
let lastPollError = null;

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be ${min}-${max}`);
  return value;
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, secretPattern.test(k) ? "[REDACTED]" : redact(v)]),
    );
  return typeof value === "string" ? value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]") : value;
}
function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, worker_id: identity, version, ...redact(fields) })}\n`,
  );
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function heartbeat(state = "ready") {
  const { error } = await db.from("agent_workers").upsert({
    id: identity,
    version,
    state,
    concurrency,
    active_jobs: active.size,
    last_seen_at: new Date().toISOString(),
  });
  if (error) throw error;
}
async function recover() {
  const { error } = await db.rpc("recover_expired_agent_leases");
  if (error) throw error;
}
async function lease() {
  const { data, error } = await db.rpc("lease_agent_job", {
    p_worker_id: identity,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return data?.[0] || null;
}
async function emit(jobId, type, payload) {
  const { error } = await db
    .from("agent_run_events")
    .insert({ job_id: jobId, event_type: type, payload });
  if (error) throw error;
}
async function browserJob(job, signal) {
  browser ||= await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  try {
    const target = await assertPublicUrl(job.input.url);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (signal.aborted) throw new Error("Cancelled");
    const screenshot = await page.screenshot({ fullPage: false });
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(screenshot).digest("hex");
    const path = `${job.owner_id}/${job.id}/${hash}.png`;
    const { error } = await db.storage
      .from("agent-evidence")
      .upload(path, screenshot, { contentType: "image/png", upsert: false });
    if (error) throw error;
    await emit(job.id, "screenshot", { storage_path: path, sha256: hash });
    return {
      title: await page.title(),
      text: (await page.locator("body").innerText()).slice(0, 20000),
      url: page.url(),
    };
  } finally {
    await context.close();
  }
}
async function teamJob(job, signal) {
  const endpoint = process.env.AI_PROVIDER_URL;
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!endpoint || !apiKey) throw new Error("AI provider is not configured");
  const { data: readyTasks, error: dependencyError } = await db.rpc(
    "ready_agent_specialist_tasks",
    { p_run_id: job.id },
  );
  if (dependencyError) throw dependencyError;
  if (Array.isArray(readyTasks) && readyTasks.length === 0)
    throw new Error("No specialist task is dependency-ready");
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...job.input, ready_specialist_tasks: readyTasks }),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  return await response.json();
}
async function run(job) {
  const controller = new AbortController();
  active.set(job.id, controller);
  const leaseHeartbeat = setInterval(
    async () => {
      const { data, error } = await db.rpc("heartbeat_agent_job", {
        p_job_id: job.id,
        p_worker_id: identity,
        p_lease_seconds: leaseSeconds,
      });
      if (error || data === "cancelling" || data === "cancelled" || data === "paused")
        controller.abort(error ? "Lease heartbeat failed" : `Job ${data}`);
    },
    Math.max(5000, Math.floor((leaseSeconds * 1000) / 3)),
  );
  leaseHeartbeat.unref();
  const dir = `${tempRoot}/${job.id}`;
  try {
    await mkdir(dir, { recursive: true });
    await emit(job.id, "started", { worker_id: identity, attempt: job.attempts });
    const result =
      job.kind === "browser"
        ? await browserJob(job, controller.signal)
        : await teamJob(job, controller.signal);
    const { error } = await db.rpc("complete_agent_job", {
      p_job_id: job.id,
      p_worker_id: identity,
      p_result: result,
    });
    if (error) throw error;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    let interrupted = controller.signal.aborted;
    if (!interrupted) {
      const { data: currentStatus } = await db.rpc("heartbeat_agent_job", {
        p_job_id: job.id,
        p_worker_id: identity,
        p_lease_seconds: leaseSeconds,
      });
      if (["cancelling", "cancelled", "paused"].includes(currentStatus)) {
        controller.abort(`Job ${currentStatus}`);
        interrupted = true;
      }
    }
    if (interrupted) {
      const { data: status, error: settleError } = await db.rpc("settle_interrupted_agent_job", {
        p_job_id: job.id,
        p_worker_id: identity,
      });
      if (settleError)
        log("error", "job_interrupt_settlement_failed", {
          job_id: job.id,
          error: settleError.message,
        });
      else log("info", "job_interrupted", { job_id: job.id, status });
    } else {
      await db.rpc("fail_agent_job", {
        p_job_id: job.id,
        p_worker_id: identity,
        p_error: message,
      });
      log("error", "job_failed", { job_id: job.id, error: message });
    }
  } finally {
    clearInterval(leaseHeartbeat);
    active.delete(job.id);
    await rm(dir, { recursive: true, force: true });
  }
}
async function poll() {
  if (polling || stopping) return;
  polling = true;
  try {
    lastPollAt = new Date().toISOString();
    await recover();
    while (!stopping && active.size < concurrency) {
      const job = await lease();
      if (!job) break;
      void run(job).catch((error) =>
        log("error", "job_run_unhandled", {
          job_id: job.id,
          error: String(error?.message || error),
        }),
      );
    }
    lastPollError = null;
  } catch (error) {
    lastPollError = String(error?.message || error);
    log("error", "poll_failed", { error: lastPollError });
  } finally {
    polling = false;
  }
}
const server = http.createServer((req, res) => {
  const healthy = !stopping;
  const ready = healthy && !lastPollError;
  const status = req.url === "/readyz" ? ready : healthy;
  if (req.url !== "/healthz" && req.url !== "/readyz") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(status ? 200 : 503, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      status: status ? "ok" : "unavailable",
      worker_id: identity,
      version,
      active_jobs: active.size,
      last_poll_at: lastPollAt,
    }),
  );
});
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "shutdown_started", { signal });
  server.close();
  for (const controller of active.values()) controller.abort();
  await Promise.allSettled(
    [...active.keys()].map((id) =>
      db.rpc("release_agent_lease", { p_job_id: id, p_worker_id: identity }),
    ),
  );
  await browser?.close();
  await heartbeat("stopped").catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
  log("info", "shutdown_complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  log("fatal", "uncaught_exception", { error: error.message });
  void shutdown("uncaughtException");
});
await mkdir(tempRoot, { recursive: true });
await heartbeat();
await recover();
server.listen(port, "0.0.0.0");
setInterval(() => void poll(), pollMs).unref();
setInterval(() => void heartbeat(), 15000).unref();
void poll();
log("info", "worker_started", { port, poll_ms: pollMs, concurrency });
