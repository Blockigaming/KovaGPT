import http from "node:http";
import os from "node:os";

const version = process.env.WORKER_VERSION || "1.0.0";
const identity = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
const port = bounded("WORKER_PORT", 8788, 1, 65535);
let stopping = false;

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be ${min}-${max}`);
  return value;
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

function responseBody(status) {
  return JSON.stringify({
    status,
    reason: "agent_runtime_unavailable",
    execution_enabled: false,
    worker_id: identity,
    version,
  });
}

const server = http.createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(stopping ? 503 : 200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(responseBody(stopping ? "unavailable" : "ok"));
    return;
  }
  if (request.url === "/readyz") {
    response.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": "3600",
    });
    response.end(responseBody("unavailable"));
    return;
  }
  response.writeHead(404, { "cache-control": "no-store" }).end();
});

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "shutdown_started", { signal });
  server.close(() => {
    log("info", "shutdown_complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(port, "0.0.0.0");
log("warn", "worker_execution_disabled", {
  port,
  reason: "agent_runtime_unavailable",
});
