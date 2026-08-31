export type ScheduledWorkerBatchResult = {
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  canceled: number;
  results: unknown[];
};

export type ScheduledWorkerHeartbeat = {
  environment: string;
  revision: string;
  sourceSha: string;
  status: "running" | "healthy" | "failed";
  safeError: string | null;
};

export type ScheduledWorkerDependencies = {
  runBatch: (options: { workerId: string; limit: number }) => Promise<ScheduledWorkerBatchResult>;
  recordHeartbeat: (heartbeat: ScheduledWorkerHeartbeat) => Promise<void>;
  log: (level: "info" | "error", event: string, fields?: Record<string, unknown>) => void;
  hostname: () => string;
};

export type ScheduledWorkerSummary = {
  environment: string;
  revision: string;
  sourceSha: string;
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  canceled: number;
};

type EnvironmentLike = Record<string, string | undefined>;

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = value == null || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("scheduled_worker_batch_limit_invalid");
  }
  return parsed;
}

function safeFailure(reason: unknown): string {
  if (reason instanceof Error && reason.name === "AbortError") {
    return "The scheduled worker was interrupted before completion.";
  }
  return "The scheduled worker could not complete its one-shot batch.";
}

function safeLogError(reason: unknown): { errorName: string } {
  return {
    errorName: reason instanceof Error ? reason.name : "UnknownError",
  };
}

export async function runScheduledWorkerOnce(
  dependencies: ScheduledWorkerDependencies,
  environment: EnvironmentLike = process.env,
): Promise<ScheduledWorkerSummary> {
  if (environment.KOVA_SCHEDULED_WORKER_ENABLED !== "1") {
    throw new Error("scheduled_worker_disabled");
  }

  const workerEnvironment = required(
    environment.KOVA_SCHEDULED_WORKER_ENVIRONMENT,
    "scheduled_worker_environment_required",
  );
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(workerEnvironment)) {
    throw new Error("scheduled_worker_environment_invalid");
  }

  const revision = required(
    environment.KOVA_WORKER_REVISION ?? environment.CONTAINER_APP_JOB_EXECUTION_NAME,
    "scheduled_worker_revision_required",
  ).slice(0, 200);
  const sourceSha = required(
    environment.KOVA_SOURCE_SHA ?? environment.KOVA_BUILD_SHA,
    "scheduled_worker_source_sha_required",
  );
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error("scheduled_worker_source_sha_invalid");
  }

  const batchLimit = boundedInteger(environment.KOVA_SCHEDULED_WORKER_BATCH_LIMIT, 5, 1, 25);
  const host = dependencies.hostname().replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 80);
  const workerId = `${workerEnvironment}-${revision}-${host}`.slice(0, 240);
  const heartbeatBase = {
    environment: workerEnvironment,
    revision,
    sourceSha,
  };

  dependencies.log("info", "scheduled_worker_started", {
    environment: workerEnvironment,
    revision,
    sourceSha,
    workerId,
    batchLimit,
  });

  await dependencies.recordHeartbeat({
    ...heartbeatBase,
    status: "running",
    safeError: null,
  });

  try {
    const result = await dependencies.runBatch({ workerId, limit: batchLimit });
    await dependencies.recordHeartbeat({
      ...heartbeatBase,
      status: "healthy",
      safeError: null,
    });

    const summary: ScheduledWorkerSummary = {
      environment: workerEnvironment,
      revision,
      sourceSha,
      workerId,
      claimed: result.claimed,
      complete: result.complete,
      failed: result.failed,
      canceled: result.canceled,
    };
    dependencies.log("info", "scheduled_worker_completed", summary);
    return summary;
  } catch (reason) {
    const safeError = safeFailure(reason);
    try {
      await dependencies.recordHeartbeat({
        ...heartbeatBase,
        status: "failed",
        safeError,
      });
    } catch (heartbeatReason) {
      dependencies.log("error", "scheduled_worker_failure_heartbeat_failed", {
        ...safeLogError(heartbeatReason),
        environment: workerEnvironment,
        revision,
        sourceSha,
      });
    }

    dependencies.log("error", "scheduled_worker_failed", {
      ...safeLogError(reason),
      environment: workerEnvironment,
      revision,
      sourceSha,
    });
    throw new Error(safeError, { cause: reason });
  }
}
