export type ScheduledWorkerBatchResult = {
  workerId: string;
  claimed: number;
  complete: number;
  failed: number;
  canceled: number;
  results: unknown[];
};

export type ScheduledWorkerDeliveryResult = {
  claimed: number;
  sent: number;
  failed: number;
  disabled: number;
  recovered: number;
};

export type ScheduledWorkerReadiness = {
  ready: boolean;
  status: string;
  heartbeatAgeSeconds: number | null;
  sourceSha: string | null;
  workerRevision: string | null;
  dueTasks: number;
  runningAttempts: number;
  expiredAttempts: number;
  readyDeliveries: number;
  failedDeliveries: number;
  disabledDeliveries: number;
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
  runDeliveryBatch: (options: {
    limit: number;
    staleSeconds: number;
  }) => Promise<ScheduledWorkerDeliveryResult>;
  readReadiness: (options: {
    environment: string;
    maxStaleSeconds: number;
    maxDeliveryBacklog: number;
  }) => Promise<ScheduledWorkerReadiness>;
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
  deliveryClaimed: number;
  deliverySent: number;
  deliveryFailed: number;
  deliveryDisabled: number;
  deliveryRecovered: number;
  readinessStatus: string;
  dueTasks: number;
  runningAttempts: number;
  readyDeliveries: number;
};

type EnvironmentLike = Record<string, string | undefined>;

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code = "scheduled_worker_batch_limit_invalid",
) {
  const parsed = value == null || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(code);
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
  const deliveryLimit = boundedInteger(
    environment.KOVA_SCHEDULED_DELIVERY_BATCH_LIMIT,
    50,
    1,
    200,
    "scheduled_delivery_batch_limit_invalid",
  );
  const deliveryStaleSeconds = boundedInteger(
    environment.KOVA_SCHEDULED_DELIVERY_STALE_SECONDS,
    300,
    30,
    3600,
    "scheduled_delivery_stale_interval_invalid",
  );
  const readinessStaleSeconds = boundedInteger(
    environment.KOVA_SCHEDULED_WORKER_MAX_STALE_SECONDS,
    180,
    30,
    3600,
    "scheduled_readiness_stale_interval_invalid",
  );
  const maxDeliveryBacklog = boundedInteger(
    environment.KOVA_SCHEDULED_WORKER_MAX_DELIVERY_BACKLOG,
    100,
    0,
    10_000,
    "scheduled_delivery_backlog_limit_invalid",
  );

  const host = dependencies
    .hostname()
    .replace(/[^a-zA-Z0-9._-]/gu, "-")
    .slice(0, 80);
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
    deliveryLimit,
  });

  await dependencies.recordHeartbeat({
    ...heartbeatBase,
    status: "running",
    safeError: null,
  });

  try {
    const result = await dependencies.runBatch({ workerId, limit: batchLimit });
    const delivery = await dependencies.runDeliveryBatch({
      limit: deliveryLimit,
      staleSeconds: deliveryStaleSeconds,
    });

    await dependencies.recordHeartbeat({
      ...heartbeatBase,
      status: "healthy",
      safeError: null,
    });

    const readiness = await dependencies.readReadiness({
      environment: workerEnvironment,
      maxStaleSeconds: readinessStaleSeconds,
      maxDeliveryBacklog,
    });
    if (
      !readiness.ready ||
      readiness.sourceSha !== sourceSha ||
      readiness.workerRevision !== revision
    ) {
      throw new Error("scheduled_worker_readiness_unhealthy");
    }

    const summary: ScheduledWorkerSummary = {
      environment: workerEnvironment,
      revision,
      sourceSha,
      workerId,
      claimed: result.claimed,
      complete: result.complete,
      failed: result.failed,
      canceled: result.canceled,
      deliveryClaimed: delivery.claimed,
      deliverySent: delivery.sent,
      deliveryFailed: delivery.failed,
      deliveryDisabled: delivery.disabled,
      deliveryRecovered: delivery.recovered,
      readinessStatus: readiness.status,
      dueTasks: readiness.dueTasks,
      runningAttempts: readiness.runningAttempts,
      readyDeliveries: readiness.readyDeliveries,
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
