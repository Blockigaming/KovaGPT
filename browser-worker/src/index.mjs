import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import {
  validateBrowserManagedIdentityBoundary,
  synthesizeBrowserResearch,
} from "./azure-openai.mjs";
import { captureAllowedPage } from "./page-capture.mjs";
import { runBrowserWorkOnce } from "./runner.mjs";

function required(value, code) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(code);
  return normalized;
}

function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      component: "work-browser-worker-v2",
      ...fields,
    })}\n`,
  );
}

function one(value, code) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(code);
    return value[0];
  }
  if (!value || typeof value !== "object") throw new Error(code);
  return value;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

async function main() {
  if (process.env.KOVA_WORK_BROWSER_WORKER_ENABLED !== "1") {
    throw new Error("browser_work_worker_disabled");
  }
  validateBrowserManagedIdentityBoundary(process.env);

  const supabase = createClient(
    required(process.env.SUPABASE_URL, "browser_supabase_url_required"),
    required(process.env.SUPABASE_SERVICE_ROLE_KEY, "browser_supabase_service_key_required"),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Kova-Worker": "work-browser-v2" } },
    },
  );

  async function rpc(name, args) {
    const result = await supabase.rpc(name, args);
    if (result.error)
      throw new Error(`Browser Work database operation failed: ${name}`, {
        cause: result.error,
      });
    return result.data;
  }

  const dependencies = {
    now: Date.now,
    hostname: os.hostname,
    log,
    capture: captureAllowedPage,
    synthesize: (input) => synthesizeBrowserResearch(input, process.env, fetch),
    async upload({ path, body, contentType }) {
      const result = await supabase.storage.from("agent-evidence").upload(path, body, {
        contentType,
        upsert: true,
        cacheControl: "private, max-age=0, no-store",
      });
      if (result.error) {
        throw new Error("Browser Work evidence could not be stored.", { cause: result.error });
      }
    },
    async recover() {
      await rpc("recover_expired_work_attempts_v2");
    },
    async claim({ workerId, workerRevision, sourceSha, capacity, leaseSeconds }) {
      const data = await rpc("claim_browser_work_job_v2", {
        p_worker_id: workerId,
        p_worker_revision: workerRevision,
        p_source_sha: sourceSha,
        p_capacity: capacity,
        p_lease_seconds: leaseSeconds,
      });
      const claimed = rows(data);
      if (claimed.length > 1) throw new Error("Browser Work claim returned an invalid batch.");
      return claimed[0] ?? null;
    },
    async heartbeatJob(job, leaseSeconds) {
      return one(
        await rpc("heartbeat_work_job_v2", {
          p_job_id: job.job_id,
          p_attempt_id: job.attempt_id,
          p_lease_token: job.lease_token,
          p_state_version: job.state_version,
          p_lease_seconds: leaseSeconds,
        }),
        "Browser Work heartbeat returned an invalid result.",
      );
    },
    async recordToolResult(job, result) {
      await rpc("record_work_browser_tool_result_v2", {
        p_job_id: job.job_id,
        p_attempt_id: job.attempt_id,
        p_lease_token: job.lease_token,
        p_state_version: job.state_version,
        p_idempotency_key: result.idempotencyKey,
        p_destination: result.destination,
        p_status: result.status,
        p_response_payload: result.responsePayload,
        p_safe_error: result.safeError,
        p_evidence: result.evidence,
      });
    },
    async settleFailure(job, failure) {
      const settled = one(
        await rpc("settle_work_failure_v2", {
          p_job_id: job.job_id,
          p_attempt_id: job.attempt_id,
          p_lease_token: job.lease_token,
          p_state_version: job.state_version,
          p_failure_type: failure.failureType,
          p_safe_error: failure.safeError,
          p_retryable: failure.retryable,
        }),
        "Browser Work failure settlement returned an invalid result.",
      );
      return {
        jobId: job.job_id,
        attemptId: job.attempt_id,
        status: "failed",
        retryAt: settled.retry_after ?? null,
      };
    },
    async settleSuccess(job, value) {
      const settled = one(
        await rpc("settle_work_browser_success_v2", {
          p_job_id: job.job_id,
          p_attempt_id: job.attempt_id,
          p_lease_token: job.lease_token,
          p_state_version: job.state_version,
          p_provider_request_id: value.providerRequestId,
          p_provider_receipt: value.providerReceipt,
          p_usage: value.usage,
          p_result: value.result,
          p_report_title: value.reportTitle,
          p_report_storage_path: value.reportStoragePath,
          p_report_byte_size: value.reportByteSize,
          p_report_integrity_hash: value.reportIntegrityHash,
        }),
        "Browser Work completion settlement returned an invalid result.",
      );
      if (settled.status !== "completed") {
        throw new Error("Browser Work completion settlement did not complete the job.");
      }
      return {
        jobId: job.job_id,
        attemptId: job.attempt_id,
        status: "complete",
        retryAt: null,
      };
    },
    async recordWorkerHeartbeat(heartbeat) {
      await rpc("record_work_browser_worker_heartbeat_v2", {
        p_environment: heartbeat.environment,
        p_worker_revision: heartbeat.revision,
        p_source_sha: heartbeat.sourceSha,
        p_status: heartbeat.status,
        p_active_jobs: heartbeat.activeJobs,
        p_capacity: heartbeat.capacity,
        p_safe_error: heartbeat.safeError,
      });
    },
    async readReadiness({ environment, sourceSha, staleSeconds }) {
      const value = one(
        await rpc("work_browser_worker_readiness_v2", {
          p_environment: environment,
          p_expected_source_sha: sourceSha,
          p_stale_seconds: staleSeconds,
        }),
        "Browser Work readiness returned an invalid result.",
      );
      return {
        healthy: value.healthy === true,
        sourceSha: value.source_sha,
        expiredAttempts: Number(value.expired_attempts ?? 0),
        runtimeEnabled: value.runtime_enabled === true,
      };
    },
  };

  await runBrowserWorkOnce(dependencies, process.env);
}

main().catch((reason) => {
  log("error", "work_browser_worker_process_failed", {
    errorName: reason instanceof Error ? reason.name : "UnknownError",
  });
  process.exitCode = 1;
});
