import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDeveloperStatus,
  developerProbeState,
} from "../../src/lib/pricing/developer-service-status.mjs";
import { developerRequestTrace } from "../../src/lib/pricing/developer-request-trace.mjs";

test("only exact probe contracts establish readiness; unexpected and disabled responses do not", () => {
  assert.equal(developerProbeState("liveness", 200, { status: "alive" }), "ready");
  assert.equal(developerProbeState("readiness", 200, { status: "degraded" }), "degraded");
  assert.equal(developerProbeState("readiness", 503, { status: "unavailable" }), "unavailable");
  assert.equal(
    developerProbeState("ingress", 401, { error: { code: "developer_unauthorized" } }),
    "ready",
  );
  assert.equal(
    developerProbeState("ingress", 503, { error: { code: "developer_platform_disabled" } }),
    "unavailable",
  );
  assert.equal(developerProbeState("ingress", 200, { data: [] }), "unknown");
  assert.equal(developerProbeState("liveness", 200, {}), "unknown");
});

test("credential-free fixed GET probes are bounded by signal and never retried", async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const observations = await checkDeveloperStatus(async (path, options) => {
    calls.push(path);
    assert.deepEqual(options, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal,
    });
    if (path.endsWith("livez")) return Response.json({ status: "alive" });
    if (path.endsWith("readyz")) return Response.json({ status: "unavailable" }, { status: 503 });
    throw new Error("network unavailable");
  }, signal);
  assert.deepEqual(calls, ["/api/livez", "/api/readyz", "/api/v1/models"]);
  assert.deepEqual(
    observations.map((row) => row.state),
    ["ready", "unavailable", "unknown"],
  );
  assert.ok(observations.every((row) => Number.isFinite(Date.parse(row.checkedAt))));
});

test("request trace uses only stored dates, capped samples and known meter values", () => {
  const date = "2026-11-28T12:00:00Z";
  const trace = developerRequestTrace(
    {
      created_at: date,
      settled_at: date,
      terminal_outcome: "released",
      secret: "hidden",
      authoritative_usage: { input_tokens: 0, private_tokens: 5 },
    },
    Array.from({ length: 101 }, () => ({ settlement_state: "rejected" })),
    date,
  );
  assert.deepEqual(
    trace.timeline.map((row) => row.stage),
    ["Reserved", "Released"],
  );
  assert.equal(trace.serviceObservation.sampleSize, 100);
  assert.equal(trace.serviceObservation.truncated, true);
  assert.equal(trace.serviceObservation.counts.rejected, 100);
  assert.equal(trace.meters.input_tokens, 0);
  assert.equal(trace.meters.private_tokens, undefined);
  assert.equal(trace.serviceObservation.providerHealth, "unknown");
  assert.doesNotMatch(JSON.stringify(trace), /hidden/);
});
