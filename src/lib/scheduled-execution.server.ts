import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AiProviderError, chatCompletions, chatModel } from "@/lib/ai/provider.server";

type FailureType = "temporary" | "permanent" | "authorization" | "timeout";

export type ClaimedScheduledTask = {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  run_at: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  status: "running";
  next_run_at: string | null;
  execution_attempts: number;
  worker_id: string | null;
  lease_expires_at: string | null;
};

export type ScheduledExecutionResult = {
  taskId: string;
  runId: string;
  status: "complete" | "failed";
  retryAt: string | null;
};

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type AdminQuery = {
  insert: (value: unknown) => Promise<QueryResult<unknown>>;
  upsert: (value: unknown, options?: { onConflict?: string }) => Promise<QueryResult<unknown>>;
  update: (value: unknown) => AdminQuery;
  eq: (column: string, value: unknown) => AdminQuery;
  select: (columns?: string) => AdminQuery;
  single: () => Promise<QueryResult<unknown>>;
  then?: never;
};

type AdminClient = {
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<RpcResult<T>>;
  from: (name: string) => AdminQuery;
};

const admin = supabaseAdmin as unknown as AdminClient;

function scheduledFor(task: ClaimedScheduledTask): string {
  return task.next_run_at ?? task.run_at;
}

function runId(task: ClaimedScheduledTask): string {
  const timestamp = Date.parse(scheduledFor(task));

  if (!Number.isFinite(timestamp)) {
    throw new Error("Scheduled task has an invalid execution time.");
  }

  return `${task.id}:${timestamp}`;
}

function safeError(reason: unknown): string {
  if (reason instanceof AiProviderError) {
    if (reason.code === "provider_timeout") {
      return "The scheduled task timed out while waiting for KovaGPT.";
    }

    if (reason.retryable) {
      return "KovaGPT was temporarily unavailable while running this scheduled task.";
    }

    return "KovaGPT could not complete this scheduled task.";
  }

  if (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  ) {
    return "The scheduled task timed out.";
  }

  return "The scheduled task could not be completed.";
}

function classifyFailure(reason: unknown): {
  type: FailureType;
  retryable: boolean;
} {
  if (reason instanceof AiProviderError) {
    if (reason.code === "provider_timeout") {
      return { type: "timeout", retryable: true };
    }

    if (reason.status === 401 || reason.status === 402 || reason.status === 403) {
      return { type: "authorization", retryable: false };
    }

    return {
      type: reason.retryable ? "temporary" : "permanent",
      retryable: reason.retryable,
    };
  }

  if (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  ) {
    return { type: "timeout", retryable: true };
  }

  return { type: "temporary", retryable: true };
}

async function claimTasks(workerId: string, limit: number): Promise<ClaimedScheduledTask[]> {
  const recovered = await admin.rpc<number>("recover_expired_scheduled_task_leases");

  if (recovered.error) {
    throw new Error(`Scheduled lease recovery failed: ${recovered.error.message}`);
  }

  const claimed = await admin.rpc<ClaimedScheduledTask[]>("claim_due_scheduled_tasks", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 120,
  });

  if (claimed.error) {
    throw new Error(`Scheduled claim failed: ${claimed.error.message}`);
  }

  return claimed.data ?? [];
}

async function writeRunStart(task: ClaimedScheduledTask, workerId: string): Promise<string> {
  const id = runId(task);

  const result = await admin.from("scheduled_task_runs").upsert(
    {
      id,
      task_id: task.id,
      user_id: task.user_id,
      scheduled_for: scheduledFor(task),
      started_at: new Date().toISOString(),
      completed_at: null,
      status: "running",
      result_summary: null,
      delivery_status: "pending",
      failure_type: null,
      retry_eligible: false,
      safe_logs: [
        `Execution claimed by trusted worker ${workerId}.`,
        `Attempt ${task.execution_attempts}.`,
      ],
      next_run_at: null,
    },
    {
      onConflict: "task_id,scheduled_for",
    },
  );

  if (result.error) {
    throw new Error(`Could not create scheduled run: ${result.error.message}`);
  }

  return id;
}

async function executePrompt(task: ClaimedScheduledTask): Promise<string> {
  const response = await chatCompletions({
    model: chatModel("balanced"),
    stream: false,
    max_tokens: 1800,
    messages: [
      {
        role: "system",
        content:
          "You are KovaGPT executing a user-authorized scheduled task. " +
          "Follow the saved task prompt exactly. Return the useful result only. " +
          "Do not claim that you performed external actions unless a real tool " +
          "result supplied to you proves that action occurred.",
      },
      {
        role: "user",
        content: task.prompt,
      },
    ],
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AiProviderError({
      error: "KovaGPT could not complete the scheduled task.",
      code:
        response.status === 429
          ? "provider_rate_limited"
          : response.status >= 500
            ? "provider_unavailable"
            : "provider_bad_response",
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }

  const value = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  const content = value.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new AiProviderError({
      error: "KovaGPT returned an empty scheduled-task result.",
      code: "provider_bad_response",
      retryable: true,
      status: 502,
    });
  }

  return content.slice(0, 12000);
}

async function notify(
  task: ClaimedScheduledTask,
  runIdValue: string,
  type: "task_result" | "task_failure",
  title: string,
  preview: string,
): Promise<void> {
  const safePreview = preview
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 220);

  const appNotification = await admin.from("app_notifications").insert({
    owner_id: task.user_id,
    type,
    title: title.slice(0, 240),
    safe_preview: safePreview || "Scheduled task update.",
    action_url: "/scheduled-tasks",
    source_entity: `scheduled_task:${task.id}`,
    delivery_state: "delivered",
  });

  if (appNotification.error) {
    throw new Error(`Could not create app notification: ${appNotification.error.message}`);
  }

  const delivery = await admin.from("notification_deliveries").insert({
    user_id: task.user_id,
    task_run_id: runIdValue,
    channel: "in_app",
    status: "sent",
    preview: safePreview || "Scheduled task update.",
    delivered_at: new Date().toISOString(),
  });

  if (delivery.error) {
    throw new Error(`Could not record notification delivery: ${delivery.error.message}`);
  }
}

async function markRunComplete(
  task: ClaimedScheduledTask,
  runIdValue: string,
  result: string,
  nextRunAt: string | null,
): Promise<void> {
  const update = await admin
    .from("scheduled_task_runs")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      result_summary: result,
      delivery_status: "sent",
      failure_type: null,
      retry_eligible: false,
      next_run_at: nextRunAt,
      safe_logs: ["Scheduled task completed successfully.", "In-app notification recorded."],
    })
    .eq("id", runIdValue)
    .eq("task_id", task.id)
    .select("id")
    .single();

  if (update.error) {
    throw new Error(`Could not settle scheduled run: ${update.error.message}`);
  }
}

async function markRunFailed(
  task: ClaimedScheduledTask,
  runIdValue: string,
  failureType: FailureType,
  message: string,
  retryAt: string | null,
): Promise<void> {
  const update = await admin
    .from("scheduled_task_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      delivery_status: "sent",
      failure_type: failureType,
      retry_eligible: retryAt !== null,
      next_run_at: retryAt,
      safe_logs: [
        message,
        retryAt ? "A bounded automatic retry was scheduled." : "No automatic retry is scheduled.",
      ],
    })
    .eq("id", runIdValue)
    .eq("task_id", task.id)
    .select("id")
    .single();

  if (update.error) {
    throw new Error(`Could not record scheduled-task failure: ${update.error.message}`);
  }
}

async function executeClaimedTask(
  task: ClaimedScheduledTask,
  workerId: string,
): Promise<ScheduledExecutionResult> {
  const id = await writeRunStart(task, workerId);

  try {
    const result = await executePrompt(task);

    const settlement = await admin.rpc<string | null>("complete_scheduled_task_execution", {
      p_task_id: task.id,
      p_worker_id: workerId,
      p_scheduled_for: scheduledFor(task),
      p_result: result,
    });

    if (settlement.error) {
      throw new Error(`Task completion settlement failed: ${settlement.error.message}`);
    }

    const nextRunAt = settlement.data ?? null;

    await notify(task, id, "task_result", `Completed: ${task.title}`, result);

    await markRunComplete(task, id, result, nextRunAt);

    return {
      taskId: task.id,
      runId: id,
      status: "complete",
      retryAt: null,
    };
  } catch (reason) {
    const failure = classifyFailure(reason);
    const message = safeError(reason);

    const settlement = await admin.rpc<string | null>("fail_scheduled_task_execution", {
      p_task_id: task.id,
      p_worker_id: workerId,
      p_failure_type: failure.type,
      p_safe_error: message,
      p_retryable: failure.retryable,
    });

    if (settlement.error) {
      throw new Error(`Task failure settlement failed: ${settlement.error.message}`, {
        cause: reason,
      });
    }

    const retryAt = settlement.data ?? null;

    await notify(
      task,
      id,
      "task_failure",
      `Task issue: ${task.title}`,
      retryAt ? `${message} KovaGPT will retry automatically.` : message,
    );

    await markRunFailed(task, id, failure.type, message, retryAt);

    return {
      taskId: task.id,
      runId: id,
      status: "failed",
      retryAt,
    };
  }
}

export async function runScheduledExecutionBatch(options?: {
  workerId?: string;
  limit?: number;
}): Promise<{
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  results: ScheduledExecutionResult[];
}> {
  const workerId =
    options?.workerId?.trim() || `scheduled-worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  const limit = Math.max(1, Math.min(options?.limit ?? 5, 25));

  const tasks = await claimTasks(workerId, limit);
  const results: ScheduledExecutionResult[] = [];

  for (const task of tasks) {
    results.push(await executeClaimedTask(task, workerId));
  }

  return {
    workerId,
    claimed: tasks.length,
    complete: results.filter((result) => result.status === "complete").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
