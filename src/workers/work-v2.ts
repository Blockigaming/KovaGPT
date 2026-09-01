import os from "node:os";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runWorkExecutionBatchV2,
  validateWorkManagedIdentityBoundary,
} from "@/lib/work-execution-v2.server";
import {
  runWorkWorkerOnce,
  type WorkWorkerHeartbeat,
  type WorkWorkerReadiness,
} from "@/workers/work-v2-runner";

type WorkWorkerRpcClient = {
  rpc<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: T | null;
    error: unknown;
  }>;
};

type WorkReadinessRow = {
  healthy: boolean;
  worker_status: string | null;
  worker_revision: string | null;
  source_sha: string | null;
  heartbeat_age_seconds: number | null;
  active_jobs: number;
  capacity: number;
  due_jobs: number;
  expired_attempts: number;
  runtime_enabled: boolean;
};

// Forward Work v2 RPCs are intentionally absent from generated Supabase types
// until the reviewed migrations are applied. Keep the exception isolated to
// this service-role-only worker adapter.
const workWorkerAdmin = supabaseAdmin as unknown as WorkWorkerRpcClient;

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      component: "work-worker-v2",
      ...fields,
    })}\n`,
  );
}

async function recordHeartbeat(heartbeat: WorkWorkerHeartbeat): Promise<void> {
  const { error } = await workWorkerAdmin.rpc("record_work_worker_heartbeat_v2", {
    p_environment: heartbeat.environment,
    p_worker_revision: heartbeat.revision,
    p_source_sha: heartbeat.sourceSha,
    p_status: heartbeat.status,
    p_active_jobs: heartbeat.activeJobs,
    p_capacity: heartbeat.capacity,
    p_safe_error: heartbeat.safeError,
  });
  if (error) {
    throw new Error("Work worker heartbeat could not be persisted.", { cause: error });
  }
}

async function readReadiness(input: {
  environment: string;
  expectedSourceSha: string;
  staleSeconds: number;
}): Promise<WorkWorkerReadiness> {
  const result = await workWorkerAdmin.rpc<WorkReadinessRow[]>("work_worker_readiness_v2", {
    p_environment: input.environment,
    p_expected_source_sha: input.expectedSourceSha,
    p_stale_seconds: input.staleSeconds,
  });
  if (result.error) {
    throw new Error("Work worker readiness could not be read.", { cause: result.error });
  }
  const row = Array.isArray(result.data) && result.data.length === 1 ? result.data[0] : undefined;
  if (!row) throw new Error("Work worker readiness returned an invalid result.");

  return {
    healthy: row.healthy === true,
    workerStatus: typeof row.worker_status === "string" ? row.worker_status : null,
    workerRevision: typeof row.worker_revision === "string" ? row.worker_revision : null,
    sourceSha: typeof row.source_sha === "string" ? row.source_sha : null,
    heartbeatAgeSeconds:
      typeof row.heartbeat_age_seconds === "number" ? row.heartbeat_age_seconds : null,
    activeJobs: Number(row.active_jobs),
    capacity: Number(row.capacity),
    dueJobs: Number(row.due_jobs),
    expiredAttempts: Number(row.expired_attempts),
    runtimeEnabled: row.runtime_enabled === true,
  };
}

try {
  await runWorkWorkerOnce({
    validateProviderBoundary: validateWorkManagedIdentityBoundary,
    runBatch: runWorkExecutionBatchV2,
    recordHeartbeat,
    readReadiness,
    hostname: os.hostname,
    log,
  });
} catch (reason) {
  log("error", "work_worker_process_failed", {
    errorName: reason instanceof Error ? reason.name : "UnknownError",
  });
  process.exitCode = 1;
}
