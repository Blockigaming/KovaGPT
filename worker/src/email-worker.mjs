import http from "node:http";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  createEmailDispatcher,
  EmailWorkerError,
  loadEmailWorkerConfig,
} from "./email-dispatcher.mjs";

const config = loadEmailWorkerConfig();
const port = boundedPort(process.env.EMAIL_WORKER_PORT ?? "8789");
const version = process.env.WORKER_VERSION || "1.0.0";
const identity = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
const startedAt = Date.now();
let stopping = false;
let pollAbort = new AbortController();
let lastPollAt = null;
let lastSuccessAt = null;
let lastErrorCode = null;
let consecutiveFailures = 0;
const counters = {
  polls: 0,
  processed: 0,
  sent: 0,
  suppressed: 0,
  already_complete: 0,
  retrying: 0,
  dead_lettered: 0,
  poll_failures: 0,
};

function boundedPort(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65_535) {
    throw new Error("EMAIL_WORKER_PORT must be 1-65535");
  }
  return number;
}

function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      worker_id: identity,
      version,
      ...fields,
    })}\n`,
  );
}

const dispatcher = createEmailDispatcher(config, { log });

function readiness() {
  const successAge = lastSuccessAt === null ? null : Date.now() - lastSuccessAt;
  const staleAfterMs = Math.max(30_000, config.pollMs * 5);
  const ready = !stopping && successAge !== null && successAge <= staleAfterMs;
  return {
    status: ready ? "ok" : "unavailable",
    service: "kovagpt-email-worker",
    execution_enabled: true,
    agent_execution_enabled: false,
    worker_id: identity,
    version,
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1_000),
    last_poll_at: lastPollAt === null ? null : new Date(lastPollAt).toISOString(),
    last_success_at: lastSuccessAt === null ? null : new Date(lastSuccessAt).toISOString(),
    last_error_code: lastErrorCode,
    consecutive_failures: consecutiveFailures,
  };
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET") {
    writeJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (request.url === "/healthz") {
    writeJson(response, stopping ? 503 : 200, {
      status: stopping ? "unavailable" : "ok",
      service: "kovagpt-email-worker",
      worker_id: identity,
      version,
    });
    return;
  }
  if (request.url === "/readyz") {
    const state = readiness();
    writeJson(response, state.status === "ok" ? 200 : 503, state);
    return;
  }
  if (request.url === "/metrics") {
    writeJson(response, 200, {
      service: "kovagpt-email-worker",
      worker_id: identity,
      version,
      ...counters,
    });
    return;
  }
  writeJson(response, 404, { error: "not_found" });
});

async function pollLoop() {
  while (!stopping) {
    let waitMs = config.pollMs;
    lastPollAt = Date.now();
    counters.polls += 1;
    try {
      const report = await dispatcher.pollOnce();
      lastSuccessAt = Date.now();
      lastErrorCode = null;
      consecutiveFailures = 0;
      counters.processed += report.processed;
      counters.sent += report.sent;
      counters.suppressed += report.suppressed;
      counters.already_complete += report.alreadyComplete;
      counters.retrying += report.retrying;
      counters.dead_lettered += report.deadLettered;
      waitMs = Math.max(waitMs, report.retryAfterMs);
      if (report.processed > 0) {
        log("info", "email_poll_complete", report);
      }
    } catch (error) {
      const code = error instanceof EmailWorkerError ? error.code : "email_poll_failed";
      lastErrorCode = code;
      consecutiveFailures += 1;
      counters.poll_failures += 1;
      waitMs = Math.min(60_000, Math.max(config.pollMs, 2 ** consecutiveFailures * 1_000));
      log("error", "email_poll_failed", {
        error_code: code,
        consecutive_failures: consecutiveFailures,
        retry_in_ms: waitMs,
      });
    }
    if (!stopping) {
      try {
        await delay(waitMs, undefined, { signal: pollAbort.signal });
      } catch {
        // Shutdown aborts the pending delay.
      }
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  pollAbort.abort();
  log("info", "shutdown_started", { signal });
  const close = new Promise((resolve) => server.close(resolve));
  await Promise.race([close, delay(10_000)]);
  log("info", "shutdown_complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

server.listen(port, "0.0.0.0", () => {
  log("info", "email_worker_started", {
    port,
    poll_ms: config.pollMs,
    batch_size: config.batchSize,
    concurrency: config.concurrency,
    visibility_timeout_seconds: config.visibilityTimeoutSeconds,
  });
});
void pollLoop();
