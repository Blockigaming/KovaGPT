import type { AuthedCaller } from "@/lib/api-auth.server";
import { BILLING_ENV, tierForLookupKey } from "@/lib/billing-plans";
import { createClient } from "@supabase/supabase-js";

import { resolveAgentEntitlement } from "./entitlement-policy.mjs";
import type { BrowserAction } from "./policy";

export type AgentEntitlement = "plus" | "pro" | "business" | "enterprise";
export const AGENT_LIMITS: Record<
  AgentEntitlement,
  { concurrency: number; maxRuntimeMs: number; maxActions: number }
> = {
  plus: { concurrency: 1, maxRuntimeMs: 15 * 60_000, maxActions: 50 },
  pro: { concurrency: 3, maxRuntimeMs: 60 * 60_000, maxActions: 200 },
  business: { concurrency: 5, maxRuntimeMs: 90 * 60_000, maxActions: 300 },
  enterprise: { concurrency: 10, maxRuntimeMs: 2 * 60 * 60_000, maxActions: 500 },
};

export async function getAgentEntitlement(caller: AuthedCaller): Promise<AgentEntitlement | null> {
  const { data, error } = await caller.supabaseAdmin
    .from("subscriptions")
    .select("price_id, status, current_period_end, environment")
    .eq("user_id", caller.userId)
    .eq("environment", BILLING_ENV)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[getAgentEntitlement] subscription lookup failed", error);
    return null;
  }
  return resolveAgentEntitlement(data, {
    billingEnvironment: BILLING_ENV,
    tierForLookupKey,
  });
}

export async function createAgentRun(
  caller: AuthedCaller,
  input: {
    objective: string;
    projectId?: string;
    idempotencyKey: string;
    actions: BrowserAction[];
    allowedDomains: string[];
  },
): Promise<never> {
  void caller;
  void input;
  throw new Error("browser_agent_unavailable");
}

export async function controlAgentRun(
  caller: AuthedCaller,
  runId: string,
  command: "pause" | "resume" | "cancel" | "delete" | "deny",
  approvalId?: string,
) {
  const db = caller.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const { data: run, error: runError } = await db
    .from("agent_runs")
    .select("id,status")
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .maybeSingle();
  if (runError) throw new Error("agent_control_unavailable");
  if (!run) throw new Error("agent_run_not_found");
  const safeRun = run as unknown as { status: string };
  if (command === "resume") throw new Error("browser_agent_unavailable");
  if (command === "delete") {
    if (!["completed", "failed", "cancelled"].includes(safeRun.status))
      throw new Error("active_run_cannot_be_deleted");
    const { error } = await db
      .from("agent_runs")
      .delete()
      .eq("id", runId)
      .eq("owner_id", caller.userId);
    if (error) throw new Error("agent_run_delete_failed");
    return { deleted: true };
  }
  const allowedStatuses =
    command === "pause"
      ? ["queued", "leased", "planning", "running", "retry_wait"]
      : command === "deny"
        ? ["approval_needed"]
        : ["queued", "leased", "planning", "running", "approval_needed", "paused", "retry_wait"];
  if (!allowedStatuses.includes(safeRun.status)) throw new Error("invalid_agent_state_transition");
  if (command === "deny") {
    if (!approvalId) throw new Error("approval_id_required");
    const { data: approval, error } = await db
      .from("integration_action_approvals")
      .update({
        status: "denied",
        decided_at: new Date().toISOString(),
      } as never)
      .eq("id", approvalId)
      .eq("owner_id", caller.userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !approval) throw new Error("approval_not_pending");
  }
  const status = command === "pause" ? "paused" : "cancelled";
  const { data: updated, error: updateError } = await db
    .from("agent_runs")
    .update({
      status,
      available_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      cancelled_at: command === "cancel" || command === "deny" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", runId)
    .eq("owner_id", caller.userId)
    .eq("status", safeRun.status)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error("agent_state_changed");
  const { error: eventError } = await db.from("agent_run_events").insert({
    run_id: runId,
    owner_id: caller.userId,
    kind: command === "deny" ? "approval" : "log",
    safe_payload: { command, result: "accepted" },
  } as never);
  return { status, auditRecorded: !eventError };
}
