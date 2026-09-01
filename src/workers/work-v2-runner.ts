import type { WorkExecutionResultV2 } from "@/lib/work-execution-v2.server";

export type WorkWorkerHeartbeat = {
  environment: string;
  revision: string;
  sourceSha: string;
  status: "running" | "healthy" | "failed" | "draining";
  activeJobs: number;
  capacity: number;
  safeError: string | null;
};

export type WorkWorkerReadiness = {
  healthy: boolean;
  workerStatus: string | null;
  workerRevision: string | null;
  sourceSha: string | null;
  heartbeatAgeSeconds: number | null;
  activeJobs: number;
  capacity: number;
  dueJobs: number;
  expiredAttempts: number;
  runtimeEnabled: boolean;
};

export type WorkWorkerBatch = {
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  paused: number;
  cancelled: number;
  results: WorkExecutionResultV2[];
};

export type WorkWorkerDependencies = {
  validateProviderBoundary: () => void;
  runBatch: (options: {
    workerId: string;
    workerRevision: string;
    sourceSha: string;
    capacity: number;
    limit: number;
    leaseSeconds: number;
    heartbeatIntervalMs: number;
  }) => Promise<WorkWorkerBatch>;
  recordHeartbeat: (heartbeat: WorkWorkerHeartbeat) => Promise<void>;
  readReadiness: (input: {
    environment: string;
    expectedSourceSha: string;
    staleSeconds: number;
  }) => Promise<WorkWorkerReadiness>;
  hostname: () => string;
  log: (level: "info" | "error", event: string, fields?: Record<string, unknown>) => void;
};

export type WorkWorkerSummary = {
  environment: string;
  revision: string;
  sourceSha: string;
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  paused: number;
  cancelled: number;
  readiness: WorkWorkerReadiness;
};

type EnvironmentLike = Record<string, string | undefined>;

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const parsed = value == null || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
}

function safeFailure(reason: unknown): string {
  if (reason instanceof Error && reason.name === "AbortError") {
    return "The Work worker was interrupted before completion.";
  }
  return "The Work worker could not complete its one-shot batch.";
}

function safeLogError(reason: unknown): { errorName: string } {
  return { errorName: reason instanceof Error ? reason.name : "UnknownError" };
}

export async function runWorkWorkerOnce(
  dependencies: WorkWorkerDependencies,
  environment: EnvironmentLike = process.env,
): Promise<WorkWorkerSummary> {
  if (environment.KOVA_WORK_WORKER_ENABLED !== "1") {
    throw new Error("work_worker_disabled");
  }

  const workerEnvironment = required(
    environment.KOVA_WORK_WORKER_ENVIRONMENT,
    "work_worker_environment_required",
  );
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(workerEnvironment)) {
    throw new Error("work_worker_environment_invalid");
  }

  const revision = required(
    environment.KOVA_WORKER_REVISION ?? environment.CONTAINER_APP_JOB_EXECUTION_NAME,
    "work_worker_revision_required",
  ).slice(0, 200);
  const sourceSha = required(
    environment.KOVA_SOURCE_SHA ?? environment.KOVA_BUILD_SHA,
    "work_worker_source_sha_required",
  );
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("work_worker_source_sha_invalid");

  const capacity = integer(
    environment.KOVA_WORK_WORKER_CAPACITY,
    1,
    1,
    64,
    "work_worker_capacity_invalid",
  );
  const batchLimit = integer(
    environment.KOVA_WORK_WORKER_BATCH_LIMIT,
    3,
    1,
    25,
    "work_worker_batch_limit_invalid",
  );
  const leaseSeconds = integer(
    environment.KOVA_WORK_WORKER_LEASE_SECONDS,
    180,
    60,
    900,
    "work_worker_lease_seconds_invalid",
  );
  const heartbeatIntervalMs = integer(
    environment.KOVA_WORK_WORKER_HEARTBEAT_MS,
    30_000,
    1_000,
    leaseSeconds * 500 - 1,
    "work_worker_heartbeat_interval_invalid",
  );
  const readinessStaleSeconds = integer(
    environment.KOVA_WORK_WORKER_READINESS_STALE_SECONDS,
    300,
    30,
    3600,
    "work_worker_readiness_stale_invalid",
  );

  dependencies.validateProviderBoundary();

  const host = dependencies
    .hostname()
    .replace(/[^a-zA-Z0-9._-]/gu, "-")
    .slice(0, 80);
  const workerId = `${workerEnvironment}-${revision}-${host}`.slice(0, 240);
  const heartbeatBase = {
    environment: workerEnvironment,
    revision,
    sourceSha,
    capacity,
  };

  dependencies.log("info", "work_worker_started", {
    environment: workerEnvironment,
    revision,
    sourceSha,
    workerId,
    capacity,
    batchLimit,
    leaseSeconds,
  });

  await dependencies.recordHeartbeat({
    ...heartbeatBase,
    status: "running",
    activeJobs: 0,
    safeError: null,
  });

  try {
    const batch = await dependencies.runBatch({
      workerId,
      workerRevision: revision,
      sourceSha,
      capacity,
      limit: batchLimit,
      leaseSeconds,
      heartbeatIntervalMs,
    });

    await dependencies.recordHeartbeat({
      ...heartbeatBase,
      status: "healthy",
      activeJobs: 0,
      safeError: null,
    });

    const readiness = await dependencies.readReadiness({
      environment: workerEnvironment,
      expectedSourceSha: sourceSha,
      staleSeconds: readinessStaleSeconds,
    });
    if (
      !readiness.healthy ||
      readiness.sourceSha !== sourceSha ||
      readiness.workerRevision !== revision ||
      readiness.expiredAttempts !== 0 ||
      !readiness.runtimeEnabled
    ) {
      throw new Error("work_worker_readiness_unhealthy");
    }

    const summary: WorkWorkerSummary = {
      environment: workerEnvironment,
      revision,
      sourceSha,
      workerId,
      claimed: batch.claimed,
      complete: batch.complete,
      failed: batch.failed,
      paused: batch.paused,
      cancelled: batch.cancelled,
      readiness,
    };
    dependencies.log("info", "work_worker_completed", summary);
    return summary;
  } catch (reason) {
    const safeError = safeFailure(reason);
    try {
      await dependencies.recordHeartbeat({
        ...heartbeatBase,
        status: "failed",
        activeJobs: 0,
        safeError,
      });
    } catch (heartbeatReason) {
      dependencies.log("error", "work_worker_failure_heartbeat_failed", {
        ...safeLogError(heartbeatReason),
        environment: workerEnvironment,
        revision,
        sourceSha,
      });
    }

    dependencies.log("error", "work_worker_failed", {
      ...safeLogError(reason),
      environment: workerEnvironment,
      revision,
      sourceSha,
    });
    throw new Error(safeError, { cause: reason });
  }
}
