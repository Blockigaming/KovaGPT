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

type SuccessSettlementRow = {
  next_run_at: string | null;
  delivery_status: string;
};

type FailureSettlementRow = {
  retry_at: string | null;
  delivery_status: string;
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
  const claimed = await admin.rpc<ClaimedScheduledTask[]>("claim_due_scheduled_tasks", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 120,
  });

  if (claimed.error) {
    throw new Error(`Scheduled claim failed: ${claimed.error.message}`);
  }

  if (!Array.isArray(claimed.data) || claimed.data.length > limit) {
    throw new Error("Scheduled claim returned an invalid batch.");
  }

  return claimed.data;
}

function assertClaimReady(task: ClaimedScheduledTask, workerId: string): void {
  if (
    typeof task.user_id !== "string" ||
    !task.user_id.trim() ||
    typeof task.prompt !== "string" ||
    !task.prompt.trim() ||
    task.status !== "running" ||
    task.worker_id !== workerId ||
    !Number.isInteger(task.execution_attempts) ||
    task.execution_attempts < 1
  ) {
    throw new Error("Scheduled claim has invalid execution ownership or input.");
  }

  const expiresAt = Date.parse(task.lease_expires_at ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Scheduled claim has an invalid or expired lease.");
  }
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
    // Provider error bodies are not needed for classification or safe user copy.
    await response.body?.cancel().catch(() => undefined);
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

async function executeClaimedTask(
  task: ClaimedScheduledTask,
  workerId: string,
): Promise<ScheduledExecutionResult> {
  assertClaimReady(task, workerId);
  const id = await writeRunStart(task, workerId);
  // History persistence may be slow. Do not spend on an already-expired lease.
  assertClaimReady(task, workerId);

  let result: string;
  try {
    result = await executePrompt(task);
  } catch (reason) {
    const failure = classifyFailure(reason);
    const message = safeError(reason);

    const settlement = await admin.rpc<FailureSettlementRow[]>("settle_scheduled_task_failure", {
      p_task_id: task.id,
      p_worker_id: workerId,
      p_run_id: id,
      p_failure_type: failure.type,
      p_safe_error: message,
      p_retryable: failure.retryable,
    });

    if (settlement.error) {
      throw new Error(`Task failure settlement failed: ${settlement.error.message}`, {
        cause: reason,
      });
    }

    const row =
      Array.isArray(settlement.data) && settlement.data.length === 1
        ? settlement.data[0]
        : undefined;

    if (!row || typeof row.retry_at === "undefined") {
      throw new Error("Task failure settlement returned no result.", {
        cause: reason,
      });
    }

    return {
      taskId: task.id,
      runId: id,
      status: "failed",
      retryAt: row.retry_at,
    };
  }

  // Generation has already completed. A lost settlement response may mean the
  // database committed successfully. Do not convert it to a provider failure,
  // write a contradictory failure, or continue claiming more work. Recovery of
  // ambiguous outcomes still requires the occurrence/attempt v2 protocol.
  const settlement = await admin.rpc<SuccessSettlementRow[]>("settle_scheduled_task_success", {
    p_task_id: task.id,
    p_worker_id: workerId,
    p_scheduled_for: scheduledFor(task),
    p_run_id: id,
    p_result: result,
  });

  if (settlement.error) {
    throw new Error(`Task completion settlement failed: ${settlement.error.message}`);
  }

  const row =
    Array.isArray(settlement.data) && settlement.data.length === 1 ? settlement.data[0] : undefined;

  if (!row || typeof row.delivery_status !== "string") {
    throw new Error("Task completion settlement returned no result.");
  }

  return {
    taskId: task.id,
    runId: id,
    status: "complete",
    retryAt: null,
  };
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

  const limit = options?.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Scheduled batch limit must be an integer between 1 and 25.");
  }

  const recovered = await admin.rpc<number>("recover_expired_scheduled_task_leases");
  if (recovered.error) {
    throw new Error(`Scheduled lease recovery failed: ${recovered.error.message}`);
  }

  const results: ScheduledExecutionResult[] = [];
  const seenTaskIds = new Set<string>();

  // This legacy executor is sequential: leasing several rows up front lets
  // later leases expire while earlier generations run. Claim only when ready.
  while (results.length < limit) {
    const tasks = await claimTasks(workerId, 1);
    if (tasks.length === 0) break;
    const task = tasks[0];
    if (!task || typeof task.id !== "string" || !task.id || seenTaskIds.has(task.id)) {
      throw new Error("Scheduled claim returned an invalid or repeated task.");
    }
    seenTaskIds.add(task.id);
    results.push(await executeClaimedTask(task, workerId));
  }

  return {
    workerId,
    claimed: results.length,
    complete: results.filter((result) => result.status === "complete").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
