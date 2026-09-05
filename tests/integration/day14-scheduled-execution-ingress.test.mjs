import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("scheduled execution ingress is protected by a server secret", () => {
  const route = read("src/routes/api/internal/scheduled-execution.ts");

  assert.match(route, /SCHEDULED_TASK_SECRET/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /Bearer/);
  assert.match(route, /timingSafeEqualText/);
  assert.match(route, /status:\s*401/);
});

test("scheduled execution ingress invokes the trusted engine only after authorization", () => {
  const route = read("src/routes/api/internal/scheduled-execution.ts");

  const authIndex = route.indexOf("if (!authorize(request))");
  const runIndex = route.indexOf("await runScheduledExecutionBatch");

  assert.ok(authIndex >= 0);
  assert.ok(runIndex >= 0);
  assert.ok(runIndex > authIndex);
});

test("ingress fails closed when execution is not configured", () => {
  const route = read("src/routes/api/internal/scheduled-execution.ts");

  assert.match(route, /scheduled_execution_not_configured/);
  assert.match(route, /status:\s*503/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /no-store/);
});

test("readiness requires scheduler credentials and an AI provider", () => {
  const source = read("src/lib/scheduled-execution-readiness.server.ts");

  assert.match(source, /missing_schedule_secret/);
  assert.match(source, /generation_disabled/);
  assert.match(source, /provider_not_configured/);
  assert.match(source, /validateAiProviderConfig/);
  assert.match(source, /scheduled_task_runtime_ready/);
});

test("scheduled-task UI remains disabled until deployment wiring is proven", () => {
  const source = read("src/lib/scheduled-tasks.functions.ts");

  assert.match(source, /activeScheduledExecutionReadiness/);
});
