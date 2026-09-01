import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  AiProviderError,
  chatCompletions,
  chatModel,
  providerErrorFromResponse,
} from "@/lib/ai/provider.server";

export type ClaimedWorkJobV2 = {
  job_id: string;
  owner_id: string;
  attempt_id: string;
  attempt_number: number;
  lease_token: string;
  lease_expires_at: string;
  state_version: number;
  input: Record<string, unknown>;
  tool_policy: Record<string, unknown>;
  allowed_domains: string[];
  entitlement: "plus" | "pro";
  token_budget: number;
};

export type WorkExecutionResultV2 = {
  jobId: string;
  attemptId: string;
  status: "complete" | "failed" | "paused" | "cancelled";
  retryAt: string | null;
};

type RpcError = { message: string };
type RpcResult<T> = { data: T | null; error: RpcError | null };
type WorkAdminClient = {
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<RpcResult<T>>;
};

type HeartbeatRow = {
  status: string;
  requested_action: "pause" | "cancel" | null;
  lease_expires_at: string;
  state_version: number;
};

type SettledJobRow = {
  id: string;
  status: string;
  retry_after?: string | null;
};

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type EnvironmentLike = Record<string, string | undefined>;

type WorkExecutionDependencies = {
  admin: WorkAdminClient;
  chat: typeof chatCompletions;
  now: () => number;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
};

const defaultDependencies: WorkExecutionDependencies = {
  admin: supabaseAdmin as unknown as WorkAdminClient,
  chat: chatCompletions,
  now: Date.now,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

class WorkLeaseUncertainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkLeaseUncertainError";
  }
}

class WorkOwnerActionError extends Error {
  readonly action: "pause" | "cancel";

  constructor(action: "pause" | "cancel") {
    super(`Work owner requested ${action}.`);
    this.name = "WorkOwnerActionError";
    this.action = action;
  }
}

class WorkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkPolicyError";
  }
}

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function validateWorkManagedIdentityBoundary(
  environment: EnvironmentLike = process.env,
): void {
  if (environment.KOVA_WORK_MODEL_PROVIDER !== "azure-managed-identity") {
    throw new Error("work_model_provider_invalid");
  }
  if (environment.KOVA_RUNTIME_PLATFORM !== "azure-container-apps") {
    throw new Error("work_runtime_platform_invalid");
  }

  required(environment.AZURE_OPENAI_ENDPOINT, "work_azure_endpoint_required");
  required(environment.AZURE_OPENAI_DEPLOYMENT_DEEP, "work_deep_deployment_required");
  required(environment.IDENTITY_ENDPOINT, "work_managed_identity_endpoint_required");
  required(environment.IDENTITY_HEADER, "work_managed_identity_header_required");

  if (environment.OPENAI_API_KEY || environment.AZURE_OPENAI_API_KEY) {
    throw new Error("work_direct_api_key_forbidden");
  }

  const pinned = required(environment.KOVA_WORK_MODEL_DEPLOYMENT, "work_model_deployment_required");
  if (pinned !== environment.AZURE_OPENAI_DEPLOYMENT_DEEP) {
    throw new Error("work_model_deployment_mismatch");
  }
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function objectiveFor(job: ClaimedWorkJobV2): string {
  const objective = typeof job.input?.objective === "string" ? job.input.objective.trim() : "";
  if (!objective || objective.length > 12000) {
    throw new WorkPolicyError("The Work objective is invalid.");
  }
  return objective;
}

function allowedTools(job: ClaimedWorkJobV2): string[] {
  const value = job.tool_policy?.allowed_tools;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function assertClaim(job: ClaimedWorkJobV2): void {
  if (
    !job ||
    typeof job.job_id !== "string" ||
    !job.job_id ||
    typeof job.owner_id !== "string" ||
    !job.owner_id ||
    typeof job.attempt_id !== "string" ||
    !job.attempt_id ||
    typeof job.lease_token !== "string" ||
    !job.lease_token ||
    !Number.isInteger(job.attempt_number) ||
    job.attempt_number < 1 ||
    !Number.isInteger(job.state_version) ||
    job.state_version < 1 ||
    !Number.isInteger(job.token_budget) ||
    job.token_budget < 1000 ||
    job.token_budget > 200000 ||
    !["plus", "pro"].includes(job.entitlement) ||
    !Array.isArray(job.allowed_domains) ||
    job.allowed_domains.length > 50 ||
    !job.input ||
    typeof job.input !== "object" ||
    Array.isArray(job.input) ||
    !job.tool_policy ||
    typeof job.tool_policy !== "object" ||
    Array.isArray(job.tool_policy)
  ) {
    throw new WorkPolicyError("The Work claim is malformed.");
  }

  const expiresAt = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new WorkLeaseUncertainError("The Work lease is invalid or expired.");
  }

  objectiveFor(job);
}

function safeError(reason: unknown): string {
  if (reason instanceof WorkPolicyError) return reason.message.slice(0, 500);
  if (reason instanceof AiProviderError) {
    if (reason.code === "provider_timeout") return "Work timed out while waiting for KovaGPT.";
    if (reason.retryable) return "KovaGPT was temporarily unavailable while running Work.";
    return "KovaGPT could not complete this Work run.";
  }
  if (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  ) {
    return "Work was interrupted before completion.";
  }
  return "The Work run could not be completed.";
}

function classifyFailure(reason: unknown): {
  type: "temporary" | "permanent" | "authorization" | "timeout" | "policy";
  retryable: boolean;
} {
  if (reason instanceof WorkPolicyError) return { type: "policy", retryable: false };
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

async function rpcOne<T>(
  dependencies: WorkExecutionDependencies,
  name: string,
  args: Record<string, unknown>,
  errorPrefix: string,
): Promise<T> {
  const result = await dependencies.admin.rpc<T[]>(name, args);
  if (result.error) throw new Error(`${errorPrefix}: ${result.error.message}`);
  const rows = asRows<T>(result.data);
  if (rows.length !== 1) throw new Error(`${errorPrefix}: invalid response`);
  return rows[0]!;
}

async function claimWorkJob(
  dependencies: WorkExecutionDependencies,
  options: {
    workerId: string;
    workerRevision: string;
    sourceSha: string;
    capacity: number;
    leaseSeconds: number;
  },
): Promise<ClaimedWorkJobV2 | null> {
  const result = await dependencies.admin.rpc<ClaimedWorkJobV2[]>("claim_work_job_v2", {
    p_worker_id: options.workerId,
    p_worker_revision: options.workerRevision,
    p_source_sha: options.sourceSha,
    p_capacity: options.capacity,
    p_lease_seconds: options.leaseSeconds,
  });
  if (result.error) throw new Error(`Work claim failed: ${result.error.message}`);
  const rows = asRows<ClaimedWorkJobV2>(result.data);
  if (rows.length > 1) throw new Error("Work claim returned an invalid batch.");
  return rows[0] ?? null;
}

async function heartbeat(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  leaseSeconds: number,
): Promise<HeartbeatRow> {
  const row = await rpcOne<HeartbeatRow>(
    dependencies,
    "heartbeat_work_job_v2",
    {
      p_job_id: job.job_id,
      p_attempt_id: job.attempt_id,
      p_lease_token: job.lease_token,
      p_state_version: job.state_version,
      p_lease_seconds: leaseSeconds,
    },
    "Work heartbeat failed",
  );

  if (!Number.isInteger(row.state_version) || typeof row.status !== "string") {
    throw new WorkLeaseUncertainError("Work heartbeat returned an invalid response.");
  }
  if (row.requested_action === "pause" || row.requested_action === "cancel") {
    throw new WorkOwnerActionError(row.requested_action);
  }
  if (row.state_version !== job.state_version || !["leased", "running"].includes(row.status)) {
    throw new WorkLeaseUncertainError("Work ownership changed during execution.");
  }
  const expiresAt = Date.parse(row.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= dependencies.now()) {
    throw new WorkLeaseUncertainError("Work heartbeat did not renew the lease.");
  }
  return row;
}

async function checkpoint(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  sequence: number,
  phase: "planning" | "executing" | "tool" | "approval" | "finalizing",
  state: Record<string, unknown>,
): Promise<void> {
  const result = await dependencies.admin.rpc<number>("checkpoint_work_job_v2", {
    p_job_id: job.job_id,
    p_attempt_id: job.attempt_id,
    p_lease_token: job.lease_token,
    p_state_version: job.state_version,
    p_sequence: sequence,
    p_phase: phase,
    p_checkpoint_state: state,
    p_integrity_hash: stableHash(state),
  });
  if (result.error || !Number.isInteger(result.data)) {
    throw new WorkLeaseUncertainError(
      `Work checkpoint failed${result.error ? `: ${result.error.message}` : "."}`,
    );
  }
}

async function appendEvent(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const result = await dependencies.admin.rpc<number>("append_work_event_v2", {
    p_job_id: job.job_id,
    p_attempt_id: job.attempt_id,
    p_lease_token: job.lease_token,
    p_state_version: job.state_version,
    p_event_type: type,
    p_safe_payload: payload,
  });
  if (result.error || !Number.isInteger(result.data)) {
    throw new WorkLeaseUncertainError(
      `Work event write failed${result.error ? `: ${result.error.message}` : "."}`,
    );
  }
}

function usageFor(payload: ChatCompletionPayload): Record<string, number> {
  const usage = payload.usage ?? {};
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);
  return {
    input_tokens: Number.isFinite(input) ? Math.max(0, Math.trunc(input)) : 0,
    output_tokens: Number.isFinite(output) ? Math.max(0, Math.trunc(output)) : 0,
    total_tokens: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0,
  };
}

function normalizeModelResult(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed)
    throw new AiProviderError({
      error: "KovaGPT returned an empty Work result.",
      code: "provider_bad_response",
      retryable: true,
      status: 502,
    });

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = parsed as Record<string, unknown>;
      const summary = typeof value.summary === "string" ? value.summary.trim() : "";
      return {
        ...value,
        summary: (summary || "Work completed.").slice(0, 12000),
        runtime: "model_only_v2",
      };
    }
  } catch {
    // A bounded text result is still useful and can be represented canonically.
  }

  return {
    summary: trimmed.slice(0, 12000),
    content: trimmed.slice(0, 100000),
    runtime: "model_only_v2",
  };
}

async function executeModelOnlyWork(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  signal: AbortSignal,
): Promise<{
  result: Record<string, unknown>;
  usage: Record<string, number>;
  providerRequestId: string;
  providerReceipt: string;
}> {
  const tools = allowedTools(job);
  if (tools.length > 0) {
    throw new WorkPolicyError(
      "This Work run requires tools that are not yet available in the isolated Work worker.",
    );
  }

  const objective = objectiveFor(job);
  const response = await dependencies.chat(
    {
      model: chatModel("deep"),
      stream: false,
      max_tokens: Math.min(6000, job.token_budget),
      messages: [
        {
          role: "system",
          content:
            "You are KovaGPT Work running in a durable, model-only execution worker. " +
            "Complete the user's objective using reasoning and writing only. Do not claim to browse, " +
            "send, modify, purchase, upload, download, contact, or execute external actions. " +
            "Return a JSON object with string fields summary and content. Keep every claim factual.",
        },
        { role: "user", content: objective },
      ],
    },
    { signal },
  );

  if (!response.ok) throw await providerErrorFromResponse(response);
  const payload = (await response.json()) as ChatCompletionPayload;
  const content = payload.choices?.[0]?.message?.content ?? "";
  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("apim-request-id") ?? "";
  return {
    result: normalizeModelResult(content),
    usage: usageFor(payload),
    providerRequestId: requestId.slice(0, 200),
    providerReceipt: stableHash({ requestId, content }).slice(0, 64),
  };
}

function startHeartbeatLoop(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  leaseSeconds: number,
  intervalMs: number,
  controller: AbortController,
): {
  stop: () => void;
  error: () => unknown;
  ownerAction: () => "pause" | "cancel" | null;
} {
  let running = false;
  let loopError: unknown;
  let action: "pause" | "cancel" | null = null;

  const timer = dependencies.setInterval(() => {
    if (running || loopError || action) return;
    running = true;
    void heartbeat(dependencies, job, leaseSeconds)
      .catch((reason) => {
        if (reason instanceof WorkOwnerActionError) action = reason.action;
        else loopError = reason;
        controller.abort();
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    stop: () => dependencies.clearInterval(timer),
    error: () => loopError,
    ownerAction: () => action,
  };
}

async function settleOwnerAction(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
): Promise<WorkExecutionResultV2> {
  const row = await rpcOne<SettledJobRow>(
    dependencies,
    "settle_work_owner_action_v2",
    {
      p_job_id: job.job_id,
      p_attempt_id: job.attempt_id,
      p_lease_token: job.lease_token,
    },
    "Work owner action settlement failed",
  );
  if (!["paused", "cancelled"].includes(row.status)) {
    throw new Error("Work owner action settlement returned an invalid status.");
  }
  return {
    jobId: job.job_id,
    attemptId: job.attempt_id,
    status: row.status as "paused" | "cancelled",
    retryAt: null,
  };
}

async function executeClaimedWork(
  dependencies: WorkExecutionDependencies,
  job: ClaimedWorkJobV2,
  options: { leaseSeconds: number; heartbeatIntervalMs: number },
): Promise<WorkExecutionResultV2> {
  assertClaim(job);
  try {
    await heartbeat(dependencies, job, options.leaseSeconds);
  } catch (reason) {
    if (reason instanceof WorkOwnerActionError) return settleOwnerAction(dependencies, job);
    throw new WorkLeaseUncertainError("Work lease was uncertain before execution.", {
      cause: reason,
    });
  }
  await appendEvent(dependencies, job, "planning_started", {
    attempt_id: job.attempt_id,
    attempt_number: job.attempt_number,
    runtime: "model_only_v2",
  });
  await checkpoint(dependencies, job, 1, "planning", {
    objective_hash: stableHash(objectiveFor(job)),
    allowed_domain_count: job.allowed_domains.length,
    allowed_tool_count: allowedTools(job).length,
    token_budget: job.token_budget,
  });

  const controller = new AbortController();
  const loop = startHeartbeatLoop(
    dependencies,
    job,
    options.leaseSeconds,
    options.heartbeatIntervalMs,
    controller,
  );

  let generated:
    | {
        result: Record<string, unknown>;
        usage: Record<string, number>;
        providerRequestId: string;
        providerReceipt: string;
      }
    | undefined;
  let generationError: unknown;

  try {
    generated = await executeModelOnlyWork(dependencies, job, controller.signal);
  } catch (reason) {
    generationError = reason;
  } finally {
    loop.stop();
  }

  if (loop.ownerAction()) return settleOwnerAction(dependencies, job);
  if (loop.error()) {
    throw new WorkLeaseUncertainError("Work lease became uncertain during generation.", {
      cause: loop.error(),
    });
  }

  try {
    await heartbeat(dependencies, job, options.leaseSeconds);
  } catch (reason) {
    if (reason instanceof WorkOwnerActionError) return settleOwnerAction(dependencies, job);
    throw new WorkLeaseUncertainError("Work lease became uncertain after generation.", {
      cause: reason,
    });
  }

  if (generationError) {
    const failure = classifyFailure(generationError);
    const result = await dependencies.admin.rpc<SettledJobRow[]>("settle_work_failure_v2", {
      p_job_id: job.job_id,
      p_attempt_id: job.attempt_id,
      p_lease_token: job.lease_token,
      p_state_version: job.state_version,
      p_failure_type: failure.type,
      p_safe_error: safeError(generationError),
      p_retryable: failure.retryable,
    });
    if (result.error) {
      throw new Error(`Work failure settlement failed: ${result.error.message}`, {
        cause: generationError,
      });
    }
    const row = asRows<SettledJobRow>(result.data)[0];
    if (!row || !["retrying", "failed"].includes(row.status)) {
      throw new Error("Work failure settlement returned an invalid result.", {
        cause: generationError,
      });
    }
    return {
      jobId: job.job_id,
      attemptId: job.attempt_id,
      status: "failed",
      retryAt: row.retry_after ?? null,
    };
  }

  if (!generated) throw new WorkLeaseUncertainError("Work generation returned no result.");

  await checkpoint(dependencies, job, 2, "finalizing", {
    result_hash: stableHash(generated.result),
    usage: generated.usage,
    provider_receipt: generated.providerReceipt,
  });
  await appendEvent(dependencies, job, "finalizing", {
    attempt_id: job.attempt_id,
    result_hash: stableHash(generated.result),
  });

  // Generation has completed. A missing settlement response may represent a
  // committed result, so never convert this path into a contradictory failure.
  const settled = await dependencies.admin.rpc<SettledJobRow[]>("settle_work_success_v2", {
    p_job_id: job.job_id,
    p_attempt_id: job.attempt_id,
    p_lease_token: job.lease_token,
    p_state_version: job.state_version,
    p_provider_request_id: generated.providerRequestId,
    p_provider_receipt: generated.providerReceipt,
    p_usage: generated.usage,
    p_result: generated.result,
  });
  if (settled.error) {
    throw new WorkLeaseUncertainError(
      `Work completion settlement failed: ${settled.error.message}`,
    );
  }
  const row = asRows<SettledJobRow>(settled.data)[0];
  if (!row || row.status !== "completed") {
    throw new WorkLeaseUncertainError("Work completion settlement returned an invalid result.");
  }

  return {
    jobId: job.job_id,
    attemptId: job.attempt_id,
    status: "complete",
    retryAt: null,
  };
}

export async function runWorkExecutionBatchV2(
  options: {
    workerId: string;
    workerRevision: string;
    sourceSha: string;
    capacity?: number;
    limit?: number;
    leaseSeconds?: number;
    heartbeatIntervalMs?: number;
  },
  dependencies: WorkExecutionDependencies = defaultDependencies,
): Promise<{
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  paused: number;
  cancelled: number;
  results: WorkExecutionResultV2[];
}> {
  const workerId = options.workerId?.trim();
  const workerRevision = options.workerRevision?.trim();
  const sourceSha = options.sourceSha?.trim();
  const limit = options.limit ?? 3;
  const capacity = options.capacity ?? 1;
  const leaseSeconds = options.leaseSeconds ?? 180;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;

  if (!workerId || workerId.length > 240) throw new Error("work_worker_id_invalid");
  if (!workerRevision || workerRevision.length > 200) {
    throw new Error("work_worker_revision_invalid");
  }
  if (!sourceSha || !/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error("work_source_sha_invalid");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("work_batch_limit_invalid");
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
    throw new Error("work_worker_capacity_invalid");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 900) {
    throw new Error("work_lease_seconds_invalid");
  }
  if (
    !Number.isInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1_000 ||
    heartbeatIntervalMs >= leaseSeconds * 500
  ) {
    throw new Error("work_heartbeat_interval_invalid");
  }

  const recovered = await dependencies.admin.rpc<number>("recover_expired_work_attempts_v2");
  if (recovered.error) {
    throw new Error(`Work lease recovery failed: ${recovered.error.message}`);
  }

  const results: WorkExecutionResultV2[] = [];
  const seen = new Set<string>();

  while (results.length < limit) {
    const job = await claimWorkJob(dependencies, {
      workerId,
      workerRevision,
      sourceSha,
      capacity,
      leaseSeconds,
    });
    if (!job) break;
    if (seen.has(job.job_id)) throw new Error("Work claim returned a repeated job.");
    seen.add(job.job_id);
    results.push(
      await executeClaimedWork(dependencies, job, {
        leaseSeconds,
        heartbeatIntervalMs,
      }),
    );
  }

  return {
    workerId,
    claimed: results.length,
    complete: results.filter((result) => result.status === "complete").length,
    failed: results.filter((result) => result.status === "failed").length,
    paused: results.filter((result) => result.status === "paused").length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
    results,
  };
}
