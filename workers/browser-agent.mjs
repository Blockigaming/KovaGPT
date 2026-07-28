import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENT_WORKER_ID"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const workerId = process.env.AGENT_WORKER_ID;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeText = (value) =>
  String(value)
    .replace(/(password|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 20_000);

async function claim() {
  const now = new Date();
  const { data: candidates } = await db
    .from("agent_runs")
    .select("*")
    .in("status", ["queued", "retry_wait"])
    .lte("available_at", now.toISOString())
    .order("created_at")
    .limit(1);
  const candidate = candidates?.[0];
  if (!candidate) return null;
  const { data } = await db
    .from("agent_runs")
    .update({
      status: "leased",
      lease_owner: workerId,
      lease_expires_at: new Date(now.getTime() + 60_000).toISOString(),
      attempt: candidate.attempt + 1,
    })
    .eq("id", candidate.id)
    .in("status", ["queued", "retry_wait"])
    .select("*")
    .maybeSingle();
  return data;
}
async function event(run, kind, payload, evidence) {
  await db.from("agent_run_events").insert({
    run_id: run.id,
    owner_id: run.owner_id,
    kind,
    safe_payload: payload,
    evidence_sha256: evidence ?? null,
  });
}

async function execute(run) {
  const root = `/tmp/kova-agent-${run.id}`;
  await mkdir(root, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
  const page = await context.newPage();
  const started = Date.now();
  try {
    await db
      .from("agent_runs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("lease_owner", workerId);
    for (let index = run.current_step; index < run.plan.length; index++) {
      const action = run.plan[index];
      if (Date.now() - started > run.policy.maxRuntimeMs)
        throw new Error("maximum_runtime_exceeded");
      const { data: fresh } = await db
        .from("agent_runs")
        .select("status")
        .eq("id", run.id)
        .single();
      if (["cancelled", "paused"].includes(fresh.status)) return;
      if (action.type === "click" && action.consequentialAction) {
        const { data: approval } = await db
          .from("integration_action_approvals")
          .insert({
            owner_id: run.owner_id,
            tool_name: action.consequentialAction,
            safe_summary: `Allow agent to ${action.consequentialAction.replaceAll("_", " ")}`,
            shared_fields: [],
            expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          })
          .select("id")
          .single();
        await db
          .from("agent_runs")
          .update({ status: "approval_needed", current_step: index })
          .eq("id", run.id);
        await event(run, "approval", {
          approvalId: approval.id,
          action: action.consequentialAction,
        });
        return;
      }
      if (action.type === "goto")
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      else if (action.type === "click")
        await page.locator(action.selector).click({ timeout: 15_000 });
      else if (action.type === "fill") {
        if (action.sensitive) throw new Error("raw_secret_entry_prohibited");
        await page.locator(action.selector).fill(action.value);
      } else if (action.type === "scroll") await page.evaluate((y) => scrollBy(0, y), action.y);
      else if (action.type === "wait")
        await page.waitForTimeout(Math.min(action.milliseconds, 30_000));
      else if (action.type === "extract")
        await event(run, "observation", {
          step: index,
          text: safeText(await page.locator(action.selector).innerText()),
        });
      else if (action.type === "screenshot") {
        const bytes = await page.screenshot({ fullPage: false });
        const hash = createHash("sha256").update(bytes).digest("hex");
        await event(
          run,
          "screenshot",
          { step: index, label: safeText(action.label), byteLength: bytes.length },
          hash,
        );
      }
      await event(run, "action", {
        step: index,
        type: action.type,
        url: new URL(page.url()).origin,
      });
      await db
        .from("agent_runs")
        .update({
          current_step: index + 1,
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("lease_owner", workerId);
    }
    await db
      .from("agent_runs")
      .update({
        status: "completed",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    await event(run, "result", { status: "completed" });
  } catch (error) {
    const retry = run.attempt < run.max_attempts;
    const delay = Math.min(60_000, 1000 * 2 ** run.attempt);
    await db
      .from("agent_runs")
      .update({
        status: retry ? "retry_wait" : "failed",
        available_at: new Date(Date.now() + delay).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    await event(run, "error", {
      code: safeText(error instanceof Error ? error.message : "worker_failure"),
      retry,
    });
  } finally {
    await context.close();
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
}
while (true) {
  const run = await claim();
  if (run) await execute(run);
  else await sleep(2000);
}
