import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ScheduledDeliveryBatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  disabled: number;
  recovered: number;
};

export type ScheduledWorkerReadinessV2 = {
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

type RpcResult<T> = {
  data: T | null;
  error: unknown;
};

type AdminClient = {
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<RpcResult<T>>;
};

const admin = supabaseAdmin as unknown as AdminClient;

type DeliveryRow = {
  claimed: number;
  sent: number;
  failed: number;
  disabled: number;
};

type ReadinessRow = {
  ready: boolean;
  status: string;
  heartbeat_age_seconds: number | null;
  source_sha: string | null;
  worker_revision: string | null;
  due_tasks: number;
  running_attempts: number;
  expired_attempts: number;
  ready_deliveries: number;
  failed_deliveries: number;
  disabled_deliveries: number;
};

function one<T>(result: RpcResult<T[]>, name: string): T {
  if (result.error) throw new Error(`${name} failed.`, { cause: result.error });
  if (!Array.isArray(result.data) || result.data.length !== 1 || !result.data[0]) {
    throw new Error(`${name} returned an invalid acknowledgement.`);
  }
  return result.data[0];
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export async function runScheduledDeliveryBatchV2(options?: {
  limit?: number;
  staleSeconds?: number;
}): Promise<ScheduledDeliveryBatchResult> {
  const limit = boundedInteger(options?.limit ?? 50, 1, 200, "Scheduled delivery limit");
  const staleSeconds = boundedInteger(
    options?.staleSeconds ?? 300,
    30,
    3600,
    "Scheduled delivery stale interval",
  );

  const recovered = await admin.rpc<number>("recover_stale_scheduled_delivery_v2", {
    p_stale_seconds: staleSeconds,
    p_limit: Math.max(limit, 100),
  });
  if (recovered.error || typeof recovered.data !== "number" || recovered.data < 0) {
    throw new Error("Scheduled delivery recovery failed.", { cause: recovered.error ?? undefined });
  }

  const delivery = await admin.rpc<DeliveryRow[]>("deliver_scheduled_in_app_outbox_v2", {
    p_limit: limit,
  });
  const row = one(delivery, "Scheduled in-app delivery");

  for (const [name, value] of Object.entries(row)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Scheduled in-app delivery returned an invalid ${name} count.`);
    }
  }
  if (row.sent + row.failed + row.disabled !== row.claimed) {
    throw new Error("Scheduled in-app delivery returned inconsistent counts.");
  }

  return {
    claimed: row.claimed,
    sent: row.sent,
    failed: row.failed,
    disabled: row.disabled,
    recovered: recovered.data,
  };
}

export async function readScheduledWorkerReadinessV2(options: {
  environment: string;
  maxStaleSeconds?: number;
  maxDeliveryBacklog?: number;
}): Promise<ScheduledWorkerReadinessV2> {
  const environment = options.environment.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(environment)) {
    throw new Error("Scheduled worker environment is invalid.");
  }
  const maxStaleSeconds = boundedInteger(
    options.maxStaleSeconds ?? 180,
    30,
    3600,
    "Scheduled worker stale threshold",
  );
  const maxDeliveryBacklog = boundedInteger(
    options.maxDeliveryBacklog ?? 100,
    0,
    10_000,
    "Scheduled delivery backlog threshold",
  );

  const result = await admin.rpc<ReadinessRow[]>("scheduled_worker_readiness_v2", {
    p_environment: environment,
    p_max_stale_seconds: maxStaleSeconds,
    p_max_delivery_backlog: maxDeliveryBacklog,
  });
  const row = one(result, "Scheduled worker readiness");

  const counts = [
    row.due_tasks,
    row.running_attempts,
    row.expired_attempts,
    row.ready_deliveries,
    row.failed_deliveries,
    row.disabled_deliveries,
  ];
  if (
    typeof row.ready !== "boolean" ||
    typeof row.status !== "string" ||
    !row.status ||
    counts.some((value) => !Number.isInteger(value) || value < 0) ||
    (row.heartbeat_age_seconds !== null &&
      (!Number.isInteger(row.heartbeat_age_seconds) || row.heartbeat_age_seconds < 0))
  ) {
    throw new Error("Scheduled worker readiness returned an invalid snapshot.");
  }

  return {
    ready: row.ready,
    status: row.status,
    heartbeatAgeSeconds: row.heartbeat_age_seconds,
    sourceSha: row.source_sha,
    workerRevision: row.worker_revision,
    dueTasks: row.due_tasks,
    runningAttempts: row.running_attempts,
    expiredAttempts: row.expired_attempts,
    readyDeliveries: row.ready_deliveries,
    failedDeliveries: row.failed_deliveries,
    disabledDeliveries: row.disabled_deliveries,
  };
}
