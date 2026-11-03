import { fileURLToPath } from "node:url";

const ENDPOINT_PATH = "/api/internal/scheduled-execution";
const MAX_RESPONSE_BYTES = 8192;

/**
 * Invoke one existing authenticated Kova scheduled-task batch.
 * No task IDs, prompts, user content, or credentials leave this worker.
 * The server performs all account, consent, lease and billing checks.
 */
export async function invokeScheduledExecution({
  env = process.env,
  request = fetch,
  timeoutMs = 75_000,
} = {}) {
  const secret = env.SCHEDULED_TASK_SECRET || env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("task_worker_secret_unavailable");
  const raw = env.KOVA_SCHEDULED_TASK_ENDPOINT;
  if (!raw) throw new Error("task_worker_endpoint_unavailable");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("task_worker_endpoint_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== ENDPOINT_PATH ||
    !url.hostname ||
    url.port
  )
    throw new Error("task_worker_endpoint_invalid");
  const allowed = (env.KOVA_SCHEDULED_TASK_ALLOWED_HOST || "kovagpt.com").toLowerCase();
  if (url.hostname.toLowerCase() !== allowed) throw new Error("task_worker_endpoint_host_mismatch");
  const response = await request(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`task_worker_http_${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json"))
    throw new Error("task_worker_invalid_response");
  const payload = await response.text();
  if (payload.length > MAX_RESPONSE_BYTES) throw new Error("task_worker_response_too_large");
  let result;
  try {
    result = JSON.parse(payload);
  } catch {
    throw new Error("task_worker_invalid_response");
  }
  if (
    !result ||
    result.ok !== true ||
    !Number.isSafeInteger(result.claimed) ||
    !Number.isSafeInteger(result.complete) ||
    !Number.isSafeInteger(result.failed) ||
    result.claimed < 0 ||
    result.claimed > 1 ||
    result.complete < 0 ||
    result.failed < 0 ||
    result.complete + result.failed > result.claimed
  )
    throw new Error("task_worker_invalid_receipt");
  return {
    claimed: result.claimed,
    complete: result.complete,
    failed: result.failed,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const receipt = await invokeScheduledExecution();
    console.log(JSON.stringify({ status: "completed", ...receipt }));
    if (receipt.failed > 0) process.exitCode = 1;
  } catch (error) {
    // Do not print endpoint headers, secrets, provider errors, or user content.
    const message = error instanceof Error ? error.message : "task_worker_failed";
    const safe = /^task_worker_[a-z0-9_]+$/.test(message) ? message : "task_worker_failed";
    console.error(safe);
    process.exitCode = 1;
  }
}
