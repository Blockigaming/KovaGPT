import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkRunnerTransport,
  parseWorkRunnerConfiguration,
  signRunnerEnvelope,
  verifyRunnerInvocation,
} from "../../src/lib/work-runner-transport.mjs";
import { WORK_RUNNER_CAPABILITIES } from "../../src/lib/work-execution-protocol.mjs";
const RUNNER = "66666666-6666-4666-8666-666666666666",
  RUN = "33333333-3333-4333-8333-333333333333";
const OWNER = "11111111-1111-4111-8111-111111111111",
  STEP = "44444444-4444-4444-8444-444444444444";
const RES = "55555555-5555-4555-8555-555555555555";
const configuration = {
  origin: "https://runner.example.net",
  id: RUNNER,
  build: "a".repeat(40),
  token: "t".repeat(64),
  signingKey: "s".repeat(64),
};
const now = () => Date.now();
const payload = () => ({
  status: "ready",
  protocol: "kova-work-v1",
  capabilities: [...WORK_RUNNER_CAPABILITIES],
  heartbeatAt: now(),
  expiresAt: now() + 50000,
});
function fetchFixture(handler, options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const request = JSON.parse(init.body);
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, `Bearer ${configuration.token}`);
    assert.equal(
      init.headers["X-Kova-Signature"],
      await signRunnerEnvelope(configuration.signingKey, "request", init.body),
    );
    const response = {
      protocol: "kova-work-v1",
      runnerId: RUNNER,
      build: configuration.build,
      requestId: request.requestId,
      at: now(),
      payload: await handler(request),
      ...options.envelope,
    };
    const body = JSON.stringify(response);
    return new Response(body, {
      status: options.status ?? 200,
      headers: {
        "content-type": "application/json",
        "x-kova-signature":
          options.signature ??
          (await signRunnerEnvelope(configuration.signingKey, "response", body)),
      },
    });
  };
  return { calls, transport: createWorkRunnerTransport(configuration, fetcher) };
}
test("runner configuration is disabled by default and rejects credentials, private origins, paths, ports and unpinned builds", () => {
  assert.equal(parseWorkRunnerConfiguration({ enabled: false }), null);
  for (const change of [
    { origin: "http://runner.example.net" },
    { origin: "https://127.0.0.1" },
    { origin: "https://localhost" },
    { origin: "https://runner.internal" },
    { origin: "https://user:secret@runner.example.net" },
    { origin: "https://runner.example.net/api" },
    { origin: "https://runner.example.net:444" },
    { build: "latest" },
    { token: "short" },
  ])
    assert.throws(
      () => parseWorkRunnerConfiguration({ ...configuration, enabled: true, ...change }),
      /invalid/,
    );
  assert.equal(
    parseWorkRunnerConfiguration({ ...configuration, enabled: true }).origin,
    configuration.origin,
  );
});
test("actual HTTPS transport authenticates a current capability heartbeat", async () => {
  const fixture = fetchFixture(() => payload());
  const runner = await fixture.transport.heartbeat();
  assert.equal(runner.authenticated, true);
  assert.equal(runner.id, RUNNER);
  assert.equal(fixture.calls[0].url, `${configuration.origin}/v1/work/heartbeat`);
});
test("signature, nonce, build, time, readiness and missing capabilities fail closed", async () => {
  for (const options of [
    { signature: "f".repeat(64) },
    { envelope: { requestId: RUN } },
    { envelope: { build: "b".repeat(40) } },
    { envelope: { at: now() - 20000 } },
    { status: 302 },
  ])
    await assert.rejects(fetchFixture(() => payload(), options).transport.heartbeat());
  for (const change of [
    { status: "diagnostic" },
    { capabilities: [] },
    { heartbeatAt: now() - 30001 },
    { expiresAt: now() - 1 },
  ])
    await assert.rejects(
      fetchFixture(() => ({ ...payload(), ...change })).transport.heartbeat(),
      /unavailable/,
    );
});
const input = () => ({
  runId: RUN,
  ownerId: OWNER,
  epoch: 1,
  stepId: STEP,
  reservationId: RES,
  model: "gpt-5.6-luna",
  objective: "Summarize the attached report",
  directions: [],
  answer: null,
  maxTokens: 1000,
  maxCostMicros: 10000,
});
const attempt = (request, status = "accepted") => ({
  runId: request.payload.runId,
  ownerId: request.payload.ownerId,
  epoch: request.payload.epoch,
  stepId: request.payload.stepId,
  inputHash: request.payload.inputHash,
  attemptId: STEP,
  status,
});
test("attempt submission, status, cancellation and reconciliation retain exact idempotent owner/epoch/input bindings", async () => {
  const fixture = fetchFixture((request) =>
    attempt(request, request.operation === "reconcile" ? "unknown" : "accepted"),
  );
  const first = await fixture.transport.submit(input());
  const second = await fixture.transport.submit(input());
  assert.equal(first.inputHash, second.inputHash);
  assert.equal(
    fixture.calls[0].init.headers["Idempotency-Key"],
    fixture.calls[1].init.headers["Idempotency-Key"],
  );
  await fixture.transport.status(first);
  await fixture.transport.cancel(first);
  assert.equal((await fixture.transport.reconcile(first)).status, "unknown");
  await assert.rejects(fixture.transport.submit({ ...input(), tools: ["shell"] }), /field_invalid/);
  await assert.rejects(
    fetchFixture((request) => ({ ...attempt(request), ownerId: RUNNER })).transport.submit(input()),
    /binding/,
  );
});
test("completed receipts verify usage bounds and reject URL-shaped output provenance", async () => {
  const fixture = fetchFixture((request) => ({
    ...attempt(request, "completed"),
    receipt: {
      ...attempt(request),
      reservationId: RES,
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      latencyMs: 30,
      costMicros: 1,
      outputs: [
        {
          artifactId: RES,
          sha256: "a".repeat(64),
          bytes: 1,
          mimeType: "text/plain",
          url: "https://foreign.example.net/file",
        },
      ],
    },
  }));
  await assert.rejects(fixture.transport.submit(input()), /artifact_invalid/);
});
test("output bytes are bound to the exact attempt, MIME, length and independently calculated SHA-256", async () => {
  const text = "Verified output bytes";
  const bytes = new TextEncoder().encode(text);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const binding = { runId: RUN, ownerId: OWNER, epoch: 1, stepId: STEP, inputHash: "b".repeat(64) };
  const output = { artifactId: RES, sha256: digest, bytes: bytes.length, mimeType: "text/plain" };
  const response = { ...binding, ...output, contentBase64: btoa(text) };
  const fixture = fetchFixture(() => response);
  assert.deepEqual((await fixture.transport.artifact(binding, output)).content, bytes);
  await assert.rejects(
    fetchFixture(() => ({
      ...response,
      contentBase64: btoa("wrong output bytes!"),
    })).transport.artifact(binding, output),
    /hash_invalid/,
  );
  await assert.rejects(
    fetchFixture(() => ({ ...response, ownerId: RUNNER })).transport.artifact(binding, output),
    /binding/,
  );
});
test("unsigned and oversized streaming payloads cannot be parsed as ready", async () => {
  const oversized = createWorkRunnerTransport(
    configuration,
    async () =>
      new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(oversized.heartbeat(), /too_large/);
});

test("dispatcher callback authentication binds operation, runner, build, freshness and owner-derived run only", async () => {
  const body = {
    protocol: "kova-work-v1",
    runnerId: RUNNER,
    build: configuration.build,
    requestId: RES,
    at: Date.now(),
    operation: "dispatch",
    payload: { runId: RUN },
  };
  const raw = JSON.stringify(body),
    signature = await signRunnerEnvelope(configuration.signingKey, "request", raw);
  assert.equal((await verifyRunnerInvocation(configuration, raw, signature)).runId, RUN);
  await assert.rejects(verifyRunnerInvocation(configuration, raw, "f".repeat(64)), /signature/);
  for (const change of [
    { at: Date.now() - 16000 },
    { payload: { runId: RUN, ownerId: OWNER } },
    { operation: "execute_shell" },
  ]) {
    const wrong = JSON.stringify({ ...body, ...change });
    await assert.rejects(
      verifyRunnerInvocation(
        configuration,
        wrong,
        await signRunnerEnvelope(configuration.signingKey, "request", wrong),
      ),
      /invalid/,
    );
  }
  const drain = JSON.stringify({ ...body, operation: "drain", payload: {} });
  assert.equal(
    (
      await verifyRunnerInvocation(
        configuration,
        drain,
        await signRunnerEnvelope(configuration.signingKey, "request", drain),
      )
    ).runId,
    null,
  );
});
