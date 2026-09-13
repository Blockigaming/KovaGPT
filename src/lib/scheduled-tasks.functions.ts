import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { activeScheduledExecutionReadiness } from "@/lib/scheduled-execution-readiness.server";
import {
  parseTaskPayload,
  type TaskContextRef,
  type TaskTrigger,
} from "@/lib/scheduled-task-policy.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { z } from "zod";
export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  run_at: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  status: "scheduled" | "running" | "paused" | "completed" | "failed";
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  timezone: string;
  schedule_local: string;
  trigger_mode: "time" | "event";
  context_refs: TaskContextRef[];
  event_triggers: TaskTrigger[];
  last_error: string | null;
};
type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Query = PromiseLike<Result> & {
  select(value: string): Query;
  eq(key: string, value: unknown): Query;
  order(key: string, options?: { ascending: boolean }): Query;
  limit(value: number): Query;
  is(key: string, value: null): Query;
  gt(key: string, value: unknown): Query;
  lt(key: string, value: unknown): Query;
  maybeSingle(): Query;
  abortSignal(signal: AbortSignal): Query;
};
type Admin = { rpc(name: string, args: Record<string, unknown>): Query; from(name: string): Query };
const fields =
  "id,title,prompt,run_at,repeat,status,last_run_at,next_run_at,last_result,created_at,updated_at,revision,timezone,schedule_local,trigger_mode,context_refs,event_triggers,last_error";
function safeTaskError(code?: string, message?: string): Error {
  if (message === "task_execution_unavailable")
    return new Error("Background execution is not ready. Your task was not started.");
  if (message === "task_plan_required")
    return new Error("An active Plus or Pro plan is required to start tasks.");
  if (message === "task_recipient_unavailable")
    return new Error("That recipient is unavailable. Choose an existing verified account.");
  if (code === "40001")
    return new Error("This task changed. Refresh it before applying this action.");
  if (code === "54000")
    return new Error(
      "The task or pending invitation limit was reached. Remove an unused item and retry.",
    );
  if (code === "42501")
    return new Error(
      "Task access or a required connection is unavailable. Refresh your permissions.",
    );
  if (code === "22023" || code === "23514")
    return new Error("Check the task schedule, context, and trigger settings.");
  return new Error("Tasks are temporarily unavailable. Please retry.");
}
async function access(userId: string, mutation = false) {
  const request = getRequest();
  if (mutation && isCrossSiteMutation(request)) throw new Error("Cross-site request blocked.");
  const auth = await requireVerifiedUser(request);
  if (auth instanceof Response) throw auth;
  if (auth.userId !== userId) throw new Error("Sign in again to use Tasks.");
  const rate = await consumeApplicationRateLimit({
    identity: `user:${userId}`,
    action: mutation ? "scheduled_task_mutation" : "scheduled_task_read",
    limit: mutation ? 20 : 90,
    windowSeconds: 60,
  });
  if (!rate.allowed) throw new Error("Tasks are busy. Please try again shortly.");
  const admin = auth.supabaseAdmin as unknown as Admin;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const current = await admin
    .rpc("scheduled_task_account_available", { p_user_id: userId })
    .abortSignal(signal);
  if (current.error || current.data !== true) throw safeTaskError("42501");
  return { admin, signal };
}
async function scheduledExecutionAvailable() {
  return (await activeScheduledExecutionReadiness()).configured;
}
async function mutate(
  userId: string,
  action: string,
  input: {
    id: string;
    mutationId: string;
    expectedRevision: number;
    payload: Record<string, unknown>;
  },
) {
  const { admin, signal } = await access(userId, true);
  if (["create", "resume", "retry"].includes(action) && !(await scheduledExecutionAvailable()))
    throw safeTaskError("55000", "task_execution_unavailable");
  const result = await admin
    .rpc("mutate_scheduled_task", {
      p_user_id: userId,
      p_mutation_id: input.mutationId,
      p_task_id: input.id,
      p_expected_revision: input.expectedRevision,
      p_action: action,
      p_payload: input.payload,
      p_policy_version: runtimeEnv("KOVA_TASK_POLICY_VERSION"),
    })
    .abortSignal(signal);
  if (result.error) throw safeTaskError(result.error.code, result.error.message);
  return {
    admin,
    signal,
    result: result.data as { taskId: string | null; offerId: string | null },
  };
}
async function readTask(
  admin: Admin,
  signal: AbortSignal,
  id: string,
  userId: string,
): Promise<ScheduledTask> {
  const result = await admin
    .from("scheduled_tasks")
    .select(fields)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()
    .abortSignal(signal);
  if (result.error || !result.data) throw safeTaskError(result.error?.code);
  return result.data as ScheduledTask;
}
const taskReadIdentity = z.object({ expectedUserId: z.string().uuid() });
function assertTaskPrincipal(data: { expectedUserId: string }, userId: string) {
  if (data.expectedUserId !== userId)
    throw new Error("Your account changed. Reopen Tasks before continuing.");
}
export const isScheduledTasksEligible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => taskReadIdentity.parse(value))
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const plan = await admin
      .rpc("effective_user_plan_tier", { _user_id: context.userId })
      .abortSignal(signal);
    if (plan.error) throw safeTaskError(plan.error.code);
    const ready = await activeScheduledExecutionReadiness();
    return {
      eligible: plan.data === "plus" || plan.data === "pro",
      executionAvailable: ready.configured,
      reason: ready.reason,
    };
  });
export const listScheduledTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => taskReadIdentity.parse(value))
  .handler(async ({ data, context }): Promise<ScheduledTask[]> => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const rows: ScheduledTask[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      let query = admin
        .from("scheduled_tasks")
        .select(fields)
        .eq("user_id", context.userId)
        .order("id", { ascending: true })
        .limit(50);
      if (cursor) query = query.gt("id", cursor);
      const result = await query.abortSignal(signal);
      if (result.error || !Array.isArray(result.data)) throw safeTaskError(result.error?.code);
      const values = result.data as ScheduledTask[];
      rows.push(...values);
      if (values.length < 50) return rows;
      cursor = values.at(-1)?.id ?? null;
      if (!cursor) throw safeTaskError();
    }
    throw safeTaskError();
  });
const identity = z.object({
  expectedUserId: z.string().uuid(),
  id: z.string().uuid(),
  mutationId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
const createSchema = z
  .object({
    expectedUserId: z.string().uuid(),
    id: z.string().uuid().optional(),
    mutationId: z.string().uuid().optional(),
  })
  .passthrough();
export const createScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => {
    const { id, mutationId, expectedUserId, ...payload } = createSchema.parse(value);
    return {
      expectedUserId,
      id: id ?? crypto.randomUUID(),
      mutationId: mutationId ?? crypto.randomUUID(),
      payload: parseTaskPayload(payload),
    };
  })
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    assertTaskPrincipal(data, context.userId);
    const result = await mutate(context.userId, "create", {
      ...data,
      expectedRevision: 0,
      payload: data.payload as Record<string, unknown>,
    });
    return readTask(result.admin, result.signal, data.id, context.userId);
  });
const updateSchema = identity
  .extend({ status: z.enum(["scheduled", "paused"]).optional(), retry: z.boolean().optional() })
  .passthrough();
export const updateScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => {
    const { id, mutationId, expectedRevision, expectedUserId, status, retry, ...payload } =
      updateSchema.parse(value);
    if (retry && status !== "scheduled") throw new Error("Retry must schedule a failed task.");
    if (status !== undefined && Object.keys(payload).length)
      throw new Error("Save task changes before resuming.");
    return {
      id,
      mutationId,
      expectedRevision,
      expectedUserId,
      action: retry
        ? "retry"
        : status === "scheduled"
          ? "resume"
          : status === "paused"
            ? "pause"
            : "edit",
      payload: parseTaskPayload(payload, true),
    };
  })
  .handler(async ({ data, context }): Promise<ScheduledTask> => {
    assertTaskPrincipal(data, context.userId);
    const result = await mutate(context.userId, data.action, {
      ...data,
      payload: data.payload as Record<string, unknown>,
    });
    return readTask(result.admin, result.signal, data.id, context.userId);
  });
export const deleteScheduledTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => identity.parse(value))
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    await mutate(context.userId, "delete", { ...data, payload: {} });
    return { ok: true as const };
  });
export const offerScheduledTaskCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    identity.extend({ email: z.string().email().max(254) }).parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const result = await mutate(context.userId, "shareCopy", {
      ...data,
      payload: { email: data.email },
    });
    return { offerId: result.result.offerId };
  });
export const decideScheduledTaskCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    identity
      .extend({ offerId: z.string().uuid(), decision: z.enum(["accept", "decline", "revoke"]) })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const result = await mutate(
      context.userId,
      data.decision === "accept"
        ? "acceptCopy"
        : data.decision === "decline"
          ? "declineCopy"
          : "revokeCopy",
      { ...data, payload: { offerId: data.offerId } },
    );
    return result.result;
  });
export const listScheduledTaskOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => taskReadIdentity.parse(value))
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const [sent, received] = await Promise.all(
      ["owner_id", "recipient_id"].map((column) =>
        admin
          .from("scheduled_task_copy_offers")
          .select(
            "id,source_task_id,owner_id,recipient_id,title,prompt,repeat,timezone,state,expires_at,created_at",
          )
          .eq(column, context.userId)
          .eq("state", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(100)
          .abortSignal(signal),
      ),
    );
    if (sent.error || received.error) throw safeTaskError();
    return { sent: sent.data ?? [], received: received.data ?? [] };
  });
export const listScheduledTaskRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        expectedUserId: z.string().uuid(),
        taskId: z.string().uuid(),
        before: z.string().datetime().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    await readTask(admin, signal, data.taskId, context.userId);
    let query = admin
      .from("scheduled_task_runs")
      .select(
        "id,task_id,scheduled_for,started_at,completed_at,status,result_summary,delivery_status,failure_type,retry_eligible,next_run_at",
      )
      .eq("user_id", context.userId)
      .eq("task_id", data.taskId)
      .order("scheduled_for", { ascending: false })
      .limit(50);
    if (data.before) query = query.lt("scheduled_for", data.before);
    const result = await query.abortSignal(signal);
    if (result.error) throw safeTaskError(result.error.code);
    return result.data ?? [];
  });

export type TaskConnectionOption = {
  id: string;
  provider: "gmail" | "slack" | "github";
  label: string;
  requiredScopes: string[];
  generation: string;
  account: string;
};
export type TaskGrantView = {
  id: string;
  provider: "gmail" | "slack" | "github";
  connection_ref: string;
  expires_at: string;
};
export const listScheduledTaskConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => taskReadIdentity.parse(value))
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const [google, linked, grants] = await Promise.all([
      admin
        .from("google_oauth_tokens")
        .select("id,email,google_sub,scopes,grant_id")
        .eq("user_id", context.userId)
        .is("revoked_at", null)
        .eq("reauthorization_required", false)
        .eq("identity_verified", true)
        .order("id")
        .limit(21)
        .abortSignal(signal),
      admin
        .from("integration_linked_accounts")
        .select(
          "id,provider_id,account_label,provider_account_id,granted_scopes,credential_key_version,updated_at",
        )
        .eq("owner_id", context.userId)
        .eq("status", "connected")
        .is("workspace_id", null)
        .is("deleted_at", null)
        .order("id")
        .limit(201)
        .abortSignal(signal),
      admin
        .from("scheduled_task_connection_grants")
        .select("id,provider,connection_ref,expires_at")
        .eq("user_id", context.userId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("id")
        .limit(21)
        .abortSignal(signal),
    ]);
    if (google.error || linked.error || grants.error) throw safeTaskError();
    const connections: TaskConnectionOption[] = [];
    if (
      !Array.isArray(google.data) ||
      !Array.isArray(linked.data) ||
      !Array.isArray(grants.data) ||
      google.data.length > 20 ||
      linked.data.length > 200 ||
      grants.data.length > 20
    )
      throw safeTaskError();
    for (const row of google.data) {
      if (
        typeof row.scopes === "string" &&
        row.scopes.split(/\s+/u).includes("https://www.googleapis.com/auth/gmail.readonly")
      )
        connections.push({
          id: row.id,
          provider: "gmail",
          label: row.email ?? "Google account",
          generation: row.grant_id,
          account: row.google_sub,
          requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        });
    }
    for (const row of linked.data) {
      const scope =
        row.provider_id === "slack"
          ? "channels:history"
          : row.provider_id === "github"
            ? "repo"
            : null;
      if (scope && Array.isArray(row.granted_scopes) && row.granted_scopes.includes(scope))
        connections.push({
          id: row.id,
          provider: row.provider_id,
          label: row.account_label ?? row.provider_account_id,
          generation: `${row.credential_key_version}:${Date.parse(row.updated_at)}`,
          account: row.provider_account_id,
          requiredScopes: [
            scope,
            ...(row.provider_id === "slack" ? ["channels:read"] : []),
            ...(row.provider_id === "slack" &&
            row.granted_scopes.includes("groups:history") &&
            row.granted_scopes.includes("groups:read")
              ? ["groups:history", "groups:read"]
              : []),
          ],
        });
    }
    return { connections, grants: grants.data as TaskGrantView[] };
  });
export const grantScheduledTaskConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        expectedUserId: z.string().uuid(),
        id: z.string().uuid(),
        connectionId: z.string().uuid(),
        provider: z.enum(["gmail", "slack", "github"]),
        generation: z.string().min(1).max(128),
        account: z.string().min(1).max(300),
        consent: z.literal(true),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId, true);
    const found = await admin
      .from(data.provider === "gmail" ? "google_oauth_tokens" : "integration_linked_accounts")
      .select(
        data.provider === "gmail"
          ? "id,google_sub,grant_id"
          : "id,provider_account_id,credential_key_version,updated_at,granted_scopes",
      )
      .eq("id", data.connectionId)
      .eq(data.provider === "gmail" ? "user_id" : "owner_id", context.userId)
      .maybeSingle()
      .abortSignal(signal);
    if (found.error || !found.data) throw safeTaskError("42501");
    const row = found.data as Record<string, unknown>;
    const generation =
      data.provider === "gmail"
        ? row.grant_id
        : `${row.credential_key_version}:${Date.parse(String(row.updated_at))}`;
    const account = data.provider === "gmail" ? row.google_sub : row.provider_account_id;
    if (data.generation !== generation || data.account !== account) throw safeTaskError("42501");
    const scopes =
      data.provider === "gmail"
        ? ["https://www.googleapis.com/auth/gmail.readonly"]
        : data.provider === "github"
          ? ["repo"]
          : [
              "channels:history",
              "channels:read",
              ...(Array.isArray(row.granted_scopes) &&
              row.granted_scopes.includes("groups:history") &&
              row.granted_scopes.includes("groups:read")
                ? ["groups:history", "groups:read"]
                : []),
            ];
    const result = await admin
      .rpc("grant_scheduled_task_connection", {
        p_user_id: context.userId,
        p_grant_id: data.id,
        p_provider: data.provider,
        p_connection_ref: data.connectionId,
        p_connection_generation:
          data.provider === "gmail"
            ? row.grant_id
            : `${row.credential_key_version}:${Date.parse(String(row.updated_at))}`,
        p_provider_account_id: data.provider === "gmail" ? row.google_sub : row.provider_account_id,
        p_scopes: scopes,
      })
      .abortSignal(signal);
    if (result.error) throw safeTaskError(result.error.code);
    return { grantId: result.data as string };
  });
export const revokeScheduledTaskConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z.object({ expectedUserId: z.string().uuid(), id: z.string().uuid() }).parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId, true);
    const result = await admin
      .rpc("revoke_scheduled_task_connection", { p_user_id: context.userId, p_grant_id: data.id })
      .abortSignal(signal);
    if (result.error) throw safeTaskError(result.error.code);
    return { ok: true };
  });

export const listScheduledTaskContextOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        expectedUserId: z.string().uuid(),
        kind: z.enum(["library", "project_file"]),
        after: z.string().uuid().nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const result = await admin
      .rpc("list_scheduled_task_context_options", {
        p_user_id: context.userId,
        p_kind: data.kind,
        p_after: data.after ?? null,
      })
      .abortSignal(signal);
    if (result.error) throw safeTaskError(result.error.code);
    return result.data as {
      items: Array<{ id: string; projectId?: string; label: string }>;
      nextCursor: string | null;
    };
  });
export const listScheduledTaskResourceOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        expectedUserId: z.string().uuid(),
        grantId: z.string().uuid(),
        cursor: z.string().max(500).nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    assertTaskPrincipal(data, context.userId);
    const { admin, signal } = await access(context.userId);
    const found = await admin
      .from("scheduled_task_connection_grants")
      .select("*")
      .eq("user_id", context.userId)
      .eq("id", data.grantId)
      .maybeSingle()
      .abortSignal(signal);
    if (found.error || !found.data) throw safeTaskError("42501");
    const { listTaskConnectedResourceOptions } =
      await import("@/lib/scheduled-task-connected.server");
    try {
      return await listTaskConnectedResourceOptions(
        found.data as import("@/lib/scheduled-task-connected.server").TaskConnectionGrant,
        data.cursor ?? null,
        signal,
      );
    } catch {
      throw safeTaskError("42501");
    }
  });
