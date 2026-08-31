import os from "node:os";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runScheduledExecutionBatchV2 } from "@/lib/scheduled-execution-v2.server";
import {
  runScheduledWorkerOnce,
  type ScheduledWorkerHeartbeat,
} from "@/workers/scheduled-v2-runner";

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      component: "scheduled-worker-v2",
      ...fields,
    })}\n`,
  );
}

async function recordHeartbeat(heartbeat: ScheduledWorkerHeartbeat): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_scheduled_worker_heartbeat_v2", {
    p_environment: heartbeat.environment,
    p_worker_revision: heartbeat.revision,
    p_source_sha: heartbeat.sourceSha,
    p_status: heartbeat.status,
    p_safe_error: heartbeat.safeError,
  });
  if (error) {
    throw new Error("Scheduled worker heartbeat could not be persisted.", { cause: error });
  }
}

try {
  await runScheduledWorkerOnce({
    runBatch: runScheduledExecutionBatchV2,
    recordHeartbeat,
    log,
    hostname: os.hostname,
  });
} catch (reason) {
  log("error", "scheduled_worker_process_failed", {
    errorName: reason instanceof Error ? reason.name : "UnknownError",
  });
  process.exitCode = 1;
}
