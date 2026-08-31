import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AiProviderError, chatCompletions, chatModel } from "@/lib/ai/provider.server";

type FailureType = "temporary" | "permanent" | "authorization" | "timeout";

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type AdminClient = {
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<RpcResult<T>>;
};

const admin = supabaseAdmin as unknown as AdminClient;
const LEASE_SECONDS = 120;
const HEARTBEAT_INTERVAL_MS = 40_000;

export type ScheduledClaimV2 = {
  task_id: string;
  user_id: string;
  occurrence_id: string;
  attempt_id: string;
  attempt_number: number;
  lease_token: string;
  lease_expires_at: string;
  task_state_version: number;
  scheduled_for: string;
  title: string;
  prompt: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  time_zone: string;
  schedule_rule: unknown;
};

export type ScheduledExecutionV2Result = {
  taskId: string;
  occurrenceId: string;
  attemptId: string;
  status: "complete" | "failed" | "canceled";
  retryAt: string | null;
};

type HeartbeatRow = {
  lease_expires_at: string;
  cancel_requested: boolean;
};

type SuccessRow = {
  next_run_at: string | null;
  outbox_queued: boolean;
};

type FailureRow = {
  retry_at: string | null;
  terminal: boolean;
};

class LeaseUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseUncertainError";
  }
}

function singleRow<T>(result: RpcResult<T[]>, name: string): T {
  if (result.error) throw new Error(`${name} failed: ${result.error.message}`);
  if (!Array.isArray(result.data) || result.data.length !== 1 || !result.data[0]) {
    throw new Error(`${name} returned an invalid acknowledgement.`);
  }
  return result.data[0];
}

function assertClaim(value: unknown): ScheduledClaimV2 {
  if (!value || typeof value !== "object") {
    throw new Error("Scheduled v2 claim is malformed.");
  }
  const claim = value as Partial<ScheduledClaimV2>;
  const ids = [claim.task_id, claim.user_id, claim.occurrence_id, claim.attempt_id, claim.lease_token];
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Scheduled v2 claim is missing execution identity.");
  }
  if (typeof claim.prompt !== "string" || !claim.prompt.trim()) {
    throw new Error("Scheduled v2 claim has no executable prompt.");
  }
  if (!Number.isInteger(claim.attempt_number) || (claim.attempt_number ?? 0) < 1) {
    throw new Error("Scheduled v2 claim has an invalid attempt number.");
  }
  if (!Number.isInteger(claim.task_state_version) || (claim.task_state_version ?? -1) < 0) {
    throw new Error("Scheduled v2 claim has an invalid state version.");
  }
  const lease = Date.parse(claim.lease_expires_at ?? "");
  const scheduled = Date.parse(claim.scheduled_for ?? "");
  if (!Number.isFinite(lease) || lease <= Date.now() || !Number.isFinite(scheduled)) {
    throw new Error("Scheduled v2 claim has an invalid or expired execution window.");
  }
  return claim as ScheduledClaimV2;
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

function classifyFailure(reason: unknown): { type: FailureType; retryable: boolean } {
  if (reason instanceof AiProviderError) {
    if (reason.code === "provider_timeout") return { type: "timeout", retryable: true };
    if ([401, 402, 403].includes(reason.status)) {
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

async function claimOne(workerId: string): Promise<ScheduledClaimV2 | null> {
  const result = await admin.rpc<ScheduledClaimV2[]>("claim_due_scheduled_task_occurrence_v2", {
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (result.error) throw new Error(`Scheduled v2 claim failed: ${result.error.message}`);
  if (!Array.isArray(result.data)) throw new Error("Scheduled v2 claim returned an invalid batch.");
  if (result.data.length === 0) return null;
  if (result.data.length !== 1) throw new Error("Scheduled v2 claim returned more than one task.");
  return assertClaim(result.data[0]);
}

async function heartbeat(claim: ScheduledClaimV2): Promise<HeartbeatRow> {
  const result = await admin.rpc<HeartbeatRow[]>("heartbeat_scheduled_task_attempt_v2", {
    p_task_id: claim.task_id,
    p_occurrence_id: claim.occurrence_id,
    p_attempt_id: claim.attempt_id,
    p_lease_token: claim.lease_token,
    p_extend_seconds: LEASE_SECONDS,
  });
  const row = singleRow(result, "Scheduled v2 heartbeat");
  if (typeof row.cancel_requested !== "boolean") {
    throw new Error("Scheduled v2 heartbeat returned an invalid cancellation state.");
  }
  const expiry = Date.parse(row.lease_expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error("Scheduled v2 heartbeat returned an invalid lease.");
  }
  return row;
}

function startLeaseGuard(claim: ScheduledClaimV2, controller: AbortController): {
  stop: () => void;
  failure: () => Error | null;
  cancellationSeen: () => boolean;
} {
  let heartbeatFailure: Error | null = null;
  let cancellation = false;
  let running = false;

  const timer = setInterval(() => {
    if (running || heartbeatFailure || cancellation) return;
    running = true;
    void heartbeat(claim)
      .then((row) => {
        if (row.cancel_requested) {
          cancellation = true;
          controller.abort();
        }
      })
      .catch((reason: unknown) => {
        heartbeatFailure =
          reason instanceof Error ? reason : new Error("Scheduled v2 heartbeat failed.");
        controller.abort();
      })
      .finally(() => {
        running = false;
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    failure: () => heartbeatFailure,
    cancellationSeen: () => cancellation,
  };
}

async function executePrompt(
  claim: ScheduledClaimV2,
  signal: AbortSignal,
): Promise<{ content: string; providerRequestId: string | null; receipt: string }> {
  const response = await chatCompletions(
    {
      model: chatModel("balanced"),
      stream: false,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "You are KovaGPT executing a user-authorized scheduled task. " +
            "Follow the saved task prompt exactly. Return the useful result only. " +
            "This scheduled execution is read-only: do not claim or attempt external side effects.",
        },
        { role: "user", content: claim.prompt },
      ],
    },
    { signal },
  );

  if (!response.ok) {
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
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = value.choices?.[0]?.message?.content?.trim()?.slice(0, 12000);
  if (!content) {
    throw new AiProviderError({
      error: "KovaGPT returned an empty scheduled-task result.",
      code: "provider_bad_response",
      retryable: true,
      status: 502,
    });
  }

  return {
    content,
    providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("apim-request-id"),
    receipt: createHash("sha256").update(content).digest("hex"),
  };
}

async function settleCanceled(claim: ScheduledClaimV2): Promise<ScheduledExecutionV2Result> {
  const settled = await admin.rpc<boolean>("settle_scheduled_task_canceled_v2", {
    p_task_id: claim.task_id,
    p_occurrence_id: claim.occurrence_id,
    p_attempt_id: claim.attempt_id,
    p_lease_token: claim.lease_token,
  });
  if (settled.error || settled.data !== true) {
    throw new Error(`Scheduled v2 cancellation settlement failed: ${settled.error?.message ?? "invalid acknowledgement"}`);
  }
  return {
    taskId: claim.task_id,
    occurrenceId: claim.occurrence_id,
    attemptId: claim.attempt_id,
    status: "canceled",
    retryAt: null,
  };
}

async function executeClaim(claim: ScheduledClaimV2): Promise<ScheduledExecutionV2Result> {
  const controller = new AbortController();
  const guard = startLeaseGuard(claim, controller);

  try {
    let generation: Awaited<ReturnType<typeof executePrompt>>;
    try {
      generation = await executePrompt(claim, controller.signal);
    } catch (reason) {
      guard.stop();
      const guardFailure = guard.failure();
      if (guardFailure) {
        throw new LeaseUncertainError(`Scheduled v2 lease became uncertain: ${guardFailure.message}`);
      }

      const finalHeartbeat = await heartbeat(claim);
      if (guard.cancellationSeen() || finalHeartbeat.cancel_requested) {
        return await settleCanceled(claim);
      }

      const failure = classifyFailure(reason);
      const result = await admin.rpc<FailureRow[]>("settle_scheduled_task_failure_v2", {
        p_task_id: claim.task_id,
        p_occurrence_id: claim.occurrence_id,
        p_attempt_id: claim.attempt_id,
        p_lease_token: claim.lease_token,
        p_failure_type: failure.type,
        p_safe_error: safeError(reason),
        p_retryable: failure.retryable,
      });
      const row = singleRow(result, "Scheduled v2 failure settlement");
      if (typeof row.terminal !== "boolean" || typeof row.retry_at === "undefined") {
        throw new Error("Scheduled v2 failure settlement returned an invalid result.");
      }
      return {
        taskId: claim.task_id,
        occurrenceId: claim.occurrence_id,
        attemptId: claim.attempt_id,
        status: "failed",
        retryAt: row.retry_at,
      };
    }

    guard.stop();
    const guardFailure = guard.failure();
    if (guardFailure) {
      throw new LeaseUncertainError(`Scheduled v2 lease became uncertain: ${guardFailure.message}`);
    }

    const finalHeartbeat = await heartbeat(claim);
    if (guard.cancellationSeen() || finalHeartbeat.cancel_requested) {
      return await settleCanceled(claim);
    }

    // Generation succeeded. From this point forward a missing settlement response
    // is ambiguous. Never convert it to a provider failure; recovery reconciles the
    // still-running attempt after its fenced lease expires.
    const result = await admin.rpc<SuccessRow[]>("settle_scheduled_task_success_v2", {
      p_task_id: claim.task_id,
      p_occurrence_id: claim.occurrence_id,
      p_attempt_id: claim.attempt_id,
      p_lease_token: claim.lease_token,
      p_provider_request_id: generation.providerRequestId,
      p_provider_receipt: generation.receipt,
      p_result: generation.content,
    });
    const row = singleRow(result, "Scheduled v2 success settlement");
    if (typeof row.outbox_queued !== "boolean") {
      throw new Error("Scheduled v2 success settlement returned an invalid result.");
    }
    return {
      taskId: claim.task_id,
      occurrenceId: claim.occurrence_id,
      attemptId: claim.attempt_id,
      status: "complete",
      retryAt: null,
    };
  } finally {
    guard.stop();
  }
}

export async function runScheduledExecutionBatchV2(options?: {
  workerId?: string;
  limit?: number;
}): Promise<{
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  canceled: number;
  results: ScheduledExecutionV2Result[];
}> {
  const workerId =
    options?.workerId?.trim() || `scheduled-v2-${process.pid}-${randomUUID().slice(0, 8)}`;
  const limit = options?.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Scheduled v2 batch limit must be an integer between 1 and 25.");
  }

  const ineligible = await admin.rpc<number>("pause_ineligible_scheduled_tasks_v2", {
    p_limit: 100,
  });
  if (ineligible.error) {
    throw new Error(`Scheduled v2 entitlement sweep failed: ${ineligible.error.message}`);
  }

  const recovered = await admin.rpc<number>("recover_expired_scheduled_task_attempts_v2", {
    p_limit: 100,
  });
  if (recovered.error) {
    throw new Error(`Scheduled v2 lease recovery failed: ${recovered.error.message}`);
  }

  const results: ScheduledExecutionV2Result[] = [];
  const seenOccurrences = new Set<string>();

  while (results.length < limit) {
    const claim = await claimOne(workerId);
    if (!claim) break;
    if (seenOccurrences.has(claim.occurrence_id)) {
      throw new Error("Scheduled v2 returned the same occurrence twice in one batch.");
    }
    seenOccurrences.add(claim.occurrence_id);
    results.push(await executeClaim(claim));
  }

  return {
    workerId,
    claimed: results.length,
    complete: results.filter((item) => item.status === "complete").length,
    failed: results.filter((item) => item.status === "failed").length,
    canceled: results.filter((item) => item.status === "canceled").length,
    results,
  };
}
