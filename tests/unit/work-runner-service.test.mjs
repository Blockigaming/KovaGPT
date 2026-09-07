import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkAttemptStore } from "../../work-runner/store.mjs";
import { createWorkRunnerService } from "../../work-runner/service.mjs";
import { configuredProvider } from "../../work-runner/provider.mjs";
import { createWorkRenderer } from "../../work-runner/render.mjs";
import { createWorkActionBroker } from "../../work-runner/action-broker.mjs";
import { createWorkRunnerTransport } from "../../src/lib/work-runner-transport.mjs";
import {
  admitWorkRun,
  transitionWorkRun,
  canonicalWorkInput,
  workInputHash,
} from "../../src/lib/work-execution-protocol.mjs";
import { executeIsolatedWorkStep } from "../../src/lib/work-runner-protocol.mjs";
import { publishWorkProjectOutput } from "../../src/lib/work-output-publisher.mjs";
const OWNER = "11111111-1111-4111-8111-111111111111",
  RUN = "33333333-3333-4333-8333-333333333333",
  RUNNER = "66666666-6666-4666-8666-666666666666";
const config = {
  origin: "https://runner.example.net",
  id: RUNNER,
  build: "a".repeat(40),
  token: "t".repeat(64),
  signingKey: "s".repeat(64),
};
const uuid = () => crypto.randomUUID();
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
function binding(input) {
  return {
    runId: input.runId,
    ownerId: input.ownerId,
    epoch: input.epoch,
    stepId: input.stepId,
    inputHash: input.inputHash,
  };
}
async function fixture(t, { results = [], provider, ready = true, actionBroker, sandbox } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "kova-runner-test-"));
  const requests = [],
    notifications = [];
  const configured =
    provider ??
    configuredProvider(
      {
        responsesUrl: "https://provider.example.net/responses",
        providerKey: "k".repeat(32),
        models: ["gpt-5.6-luna"],
        actionBroker,
        sandbox,
      },
      async (url, init) => {
        requests.push({ url: String(url), ...init });
        return Response.json({
          output_text: JSON.stringify(results.shift()),
          usage: { input_tokens: 20, output_tokens: 30 },
        });
      },
    );
  const store = new WorkAttemptStore(directory);
  const service = createWorkRunnerService({
    configuration: config,
    store,
    provider: configured,
    render: createWorkRenderer(),
    notify: async (...input) => notifications.push(input),
    readiness: async () => ready,
  });
  const transport = createWorkRunnerTransport(config, (url, init) =>
    service.handle(new Request(url, init)),
  );
  t.after(async () => {
    service.close();
    // close aborts active work; wait for the real owner drain barrier before
    // removing the fixture directory while a kernel-lock writer can still exit.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await transport.cleanupOwner(OWNER)) break;
      await pause();
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { transport, service, store, requests, notifications };
}
async function terminal(transport, input) {
  let attempt = await transport.submit(input);
  for (let tries = 0; ["accepted", "running"].includes(attempt.status) && tries < 300; tries++) {
    await pause();
    attempt = await transport.status(binding(attempt));
  }
  assert.ok(!["accepted", "running"].includes(attempt.status));
  return attempt;
}
const input = () => ({
  runId: RUN,
  ownerId: OWNER,
  epoch: 1,
  stepId: uuid(),
  reservationId: uuid(),
  model: "gpt-5.6-luna",
  objective: "Prepare output",
  directions: [],
  answer: null,
  approval: null,
  effectResult: null,
  maxTokens: 100,
  maxOutputTokens: 50,
  maxCostMicros: 1000,
});

test("real signed service requires current readiness and preserves private durable attempt idempotency", async (t) => {
  const unavailable = await fixture(t, { ready: false });
  await assert.rejects(unavailable.transport.heartbeat(), /unavailable/);
  const f = await fixture(t, {
    results: [
      {
        kind: "outputs",
        artifacts: [{ format: "text", title: "Result", content: "Verified bytes" }],
      },
    ],
  });
  assert.equal((await f.transport.heartbeat()).authenticated, true);
  const request = input(),
    finished = await terminal(f.transport, request);
  assert.equal(finished.status, "completed");
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.requests[0].body).max_output_tokens, 50);
  assert.equal((await f.transport.submit(request)).attemptId, finished.attemptId);
  assert.equal(f.requests.length, 1);
  const content = await f.transport.artifact(binding(finished), finished.receipt.outputs[0]);
  assert.equal(new TextDecoder().decode(content.content), "Verified bytes");
  assert.equal(Object.hasOwn(finished, "privateInput"), false);
  assert.equal(Object.hasOwn(finished, "artifacts"), false);
  await assert.rejects(f.transport.submit({ ...request, objective: "Changed" }), /unavailable/);
  await assert.rejects(
    f.transport.artifact({ ...binding(finished), ownerId: uuid() }, finished.receipt.outputs[0]),
    /unavailable/,
  );
});

test("fake provider drives actual service, protocol, approvals, question and private publisher lifecycle", async (t) => {
  let externalCalls = 0;
  const operation = {
    id: "public_docs",
    action: "read_public_page",
    method: "GET",
    url: "https://docs.example.net/page",
    response: "text",
    public: true,
  };
  const broker = createWorkActionBroker(
    { operations: [operation], credentialFor: async () => null },
    async () => {
      externalCalls++;
      return new Response("<h1>Reference</h1><script>bad()</script>Source facts");
    },
  );
  const approvedInput = {
    operationId: operation.id,
    method: operation.method,
    url: operation.url,
    body: null,
  };
  const f = await fixture(t, {
    actionBroker: broker,
    results: [
      { kind: "question", text: "Which audience?" },
      { kind: "approval", action: operation.action, input: approvedInput },
      {
        kind: "outputs",
        artifacts: [
          { format: "markdown", title: "Report", content: "# Final report\nSource facts." },
        ],
      },
    ],
  });
  let state = await admitWorkRun(
    { mutationId: uuid(), objective: "Prepare report", source: "work", projectId: uuid() },
    {
      runId: RUN,
      ownerId: OWNER,
      model: "gpt-5.6-luna",
      plan: "plus",
      accountActive: true,
      lockdownAllowed: true,
      costAllowed: true,
      maxActions: 10,
      maxTokens: 10000,
      maxCostMicros: 100000,
      runtimeMs: 900000,
    },
    await f.transport.heartbeat(),
  );
  const settle = [],
    stored = [];
  const repository = {
    load: async () => structuredClone(state),
    authorize: async () => {},
    assertLease: async (run) => {
      assert.equal(run.epoch, state.epoch);
      assert.ok(state.lease.expiresAt > Date.now());
    },
    commit: async (next, revision) => {
      assert.equal(revision, state.revision);
      state = next;
      return structuredClone(state);
    },
  };
  const runnerContext = () => ({
    actor: "runner",
    runnerId: RUNNER,
    epoch: state.epoch,
    expectedRevision: state.revision,
  });
  const ownerCommand = async (command) => {
    state = await transitionWorkRun(state, command, {
      actor: "owner",
      ownerId: OWNER,
      expectedRevision: state.revision,
    });
  };
  const step = async () => {
    state = await transitionWorkRun(
      state,
      { type: "claim" },
      { ...runnerContext(), runner: await f.transport.heartbeat() },
    );
    return executeIsolatedWorkStep(
      {
        repository,
        adapter: {
          attestation: () => f.transport.heartbeat(),
          reason: async (payload) => (await terminal(f.transport, payload)).receipt,
        },
        costBroker: {
          reserve: async (run) => ({
            id: uuid(),
            ownerId: OWNER,
            runId: RUN,
            epoch: run.epoch,
            model: run.model,
            verified: true,
            tokens: 100,
            outputTokens: 50,
            costMicros: 1000,
            expiresAt: Date.now() + 25000,
          }),
          releaseUnused: async () => assert.fail("unexpected release"),
          settle: async (run, receipt) => {
            assert.equal(receipt.inputHash, run.step.inputHash);
            settle.push(receipt);
          },
        },
      },
      RUN,
      uuid(),
    );
  };
  const finish = async (result, outputRefs = []) => {
    state = await transitionWorkRun(
      state,
      { type: "finish_step", id: result.receipt.stepId, outputRefs },
      { ...runnerContext(), accountingSettled: true, outputsVerified: true },
    );
  };
  await finish(await step());
  assert.equal(state.status, "waiting_for_user");
  assert.equal(state.step, null);
  await ownerCommand({ type: "answer", questionId: state.question.id, text: "Technical readers" });
  await finish(await step());
  assert.equal(state.status, "approval_required");
  assert.equal(externalCalls, 0);
  assert.equal(state.approval.canonicalInput, canonicalWorkInput(approvedInput));
  await ownerCommand({
    type: "approve",
    approvalId: state.approval.id,
    actionRevision: state.approval.revision,
    inputHash: state.approval.inputHash,
    canonicalInput: state.approval.canonicalInput,
  });
  await finish(await step());
  assert.equal(state.status, "queued");
  assert.equal(externalCalls, 1);
  assert.equal(state.approval.status, "consumed");
  assert.equal(state.effect.status, "completed");
  assert.doesNotMatch(state.effect.result.text, /bad/);
  const final = await step();
  const refs = await Promise.all(
    final.receipt.outputs.map((output) =>
      publishWorkProjectOutput(
        {
          assertLease: async () => {},
          readArtifact: (receipt, descriptor) => f.transport.artifact(binding(receipt), descriptor),
          publishProjectFile: async (args) => {
            stored.push(args);
            return { id: uuid(), status: "ready", project_id: state.request.projectId };
          },
          bindOutput: async () => ({ kind: "library", id: uuid() }),
        },
        state,
        final.receipt,
        output,
      ),
    ),
  );
  await finish(final, refs);
  state = await transitionWorkRun(
    state,
    {
      type: "complete",
      outputRefs: refs,
      evidence: ["Actual service transport and verified bytes; fake provider/test publisher."],
    },
    { ...runnerContext(), outputsVerified: true },
  );
  assert.equal(state.status, "completed");
  assert.equal(settle.length, 4);
  assert.equal(externalCalls, 1);
  assert.equal(f.requests.length, 3);
  assert.equal(stored.length, 1);
});

test("known provider usage survives malformed or empty output and cannot trigger objective replay", async (t) => {
  for (const result of [{ kind: "outputs", artifacts: [] }, { kind: "unexpected" }]) {
    const f = await fixture(t, { results: [result] });
    const outcome = await terminal(f.transport, input());
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.receipt.inputTokens, 20);
    assert.equal(outcome.receipt.directive.kind, "failure");
  }
});

test("restart returns interrupted evidence without invoking the provider again", async (t) => {
  const f = await fixture(t);
  const request = input(),
    hash = await workInputHash(request);
  await f.store.put(request, {
    ...binding({ ...request, inputHash: hash }),
    attemptId: uuid(),
    status: "running",
    privateInput: request,
  });
  const outcome = await f.transport.reconcile(binding({ ...request, inputHash: hash }));
  assert.equal(outcome.status, "unknown");
  assert.equal(f.requests.length, 0);
});

test("typed API actions reject changed target/body, absent owner grant and expired approval", async () => {
  let calls = 0;
  const operation = {
    id: "message",
    action: "send_message",
    url: "https://api.example.net/message",
    method: "POST",
    response: "json",
  };
  let grant = null;
  const broker = createWorkActionBroker(
    { operations: [operation], credentialFor: async () => grant },
    async (url, init) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, `Bearer ${"k".repeat(32)}`);
      return Response.json({ sent: true });
    },
  );
  const value = {
    operationId: "message",
    url: operation.url,
    method: "POST",
    body: { message: "Exact text" },
  };
  const command = {
    ...input(),
    approval: {
      id: uuid(),
      action: "send_message",
      status: "approved",
      expiresAt: Date.now() + 50000,
      canonicalInput: canonicalWorkInput(value),
      inputHash: await workInputHash(value),
    },
  };
  await assert.rejects(
    broker.execute(command, { signal: AbortSignal.timeout(1000) }),
    /grant_missing/,
  );
  grant = {
    ownerId: uuid(),
    operationId: "message",
    token: "k".repeat(32),
    expiresAt: Date.now() + 50000,
  };
  await assert.rejects(
    broker.execute(command, { signal: AbortSignal.timeout(1000) }),
    /grant_missing/,
  );
  grant.ownerId = OWNER;
  assert.equal(
    (await broker.execute(command, { signal: AbortSignal.timeout(1000) })).outcome,
    "completed",
  );
  assert.equal(calls, 1);
  assert.throws(
    () => broker.validate("send_message", { ...value, url: "https://evil.example.net" }),
    /not_allowed/,
  );
  await assert.rejects(
    broker.execute(
      {
        ...command,
        approval: {
          ...command.approval,
          canonicalInput: canonicalWorkInput({ ...value, body: { message: "Changed" } }),
        },
      },
      { signal: AbortSignal.timeout(1000) },
    ),
    /stale/,
  );
});

test("account erasure retires the owner, drains attempts, removes bytes and forbids resurrection", async (t) => {
  const f = await fixture(t, {
    results: [
      {
        kind: "outputs",
        artifacts: [{ format: "text", title: "Private", content: "Private output" }],
      },
    ],
  });
  const request = input(),
    finished = await terminal(f.transport, request);
  assert.equal(await f.transport.cleanupOwner(OWNER), true);
  assert.equal(await f.transport.cleanupOwner(OWNER), true);
  assert.equal(await f.store.get(request), null);
  await assert.rejects(f.transport.submit({ ...input(), stepId: uuid() }), /unavailable/);
  await assert.rejects(f.transport.artifact(binding(finished), finished.receipt.outputs[0]));
  await assert.rejects(f.store.put(request, { ...finished }), /retired/);
});

test("cancelled late receipts stay cancelled and do not revive a removed account", async (t) => {
  let resolveProvider, providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  const pending = new Promise((resolve) => {
    resolveProvider = resolve;
  });
  const f = await fixture(t, {
    provider: {
      reason: async (request) => {
        providerStarted();
        await pending;
        return {
          status: "completed",
          receipt: {
            reservationId: request.reservationId,
            inputTokens: 1,
            outputTokens: 1,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            latencyMs: 1,
            costMicros: 0,
            outputs: [],
          },
        };
      },
    },
  });
  const request = input(),
    attempt = await f.transport.submit(request);
  await started;
  assert.equal((await f.transport.cancel(binding(attempt))).status, "cancelled");
  assert.equal(await f.transport.cleanupOwner(OWNER), false);
  resolveProvider();
  for (let i = 0; i < 100; i++) {
    await pause();
    if (await f.transport.cleanupOwner(OWNER)) break;
  }
  assert.equal(await f.transport.cleanupOwner(OWNER), true);
  assert.equal(await f.store.get(request), null);
});

test("signed nonexecution tombstones survive restart and reject a late duplicate submit without provider work", async (t) => {
  const f = await fixture(t);
  const request = input(),
    bound = {
      ...binding(request),
      inputHash: await workInputHash(request),
      reservationId: request.reservationId,
    };
  const proof = await f.transport.sealUndispatched(bound);
  assert.equal(proof.status, "not_executed");
  assert.equal(proof.receipt.inputTokens, 0);
  assert.equal(proof.receipt.outputTokens, 0);
  assert.deepEqual(await f.transport.sealUndispatched(bound), proof);
  await assert.rejects(f.transport.sealUndispatched({ ...bound, reservationId: uuid() }));
  await assert.rejects(f.transport.sealUndispatched({ ...bound, inputHash: "b".repeat(64) }));
  let called = 0;
  const restarted = createWorkRunnerService({
    configuration: config,
    store: f.store,
    provider: {
      reason: async () => {
        called++;
        throw new Error("must not execute");
      },
    },
    render: createWorkRenderer(),
    notify: async () => {},
    readiness: async () => true,
  });
  const transport = createWorkRunnerTransport(config, (url, init) =>
    restarted.handle(new Request(url, init)),
  );
  assert.deepEqual(await transport.submit(request), proof);
  assert.equal(called, 0);
  assert.equal(f.requests.length, 0);
  restarted.close();
  const record = await f.store.get(bound);
  assert.equal("privateInput" in record, false);
  assert.equal(JSON.stringify(record).includes(request.objective), false);
});
test("existing uncertain attempts can never be sealed as zero-execution evidence", async (t) => {
  const f = await fixture(t);
  const request = input(),
    bound = {
      ...binding(request),
      inputHash: await workInputHash(request),
      reservationId: request.reservationId,
    };
  for (const status of ["accepted", "running", "unknown"]) {
    await f.store.put(bound, { ...binding(bound), attemptId: uuid(), status });
    const attempt = await f.transport.sealUndispatched(bound);
    assert.equal(attempt.status, status);
    assert.equal(attempt.receipt, undefined);
  }
});

test("status rereads a completed durable receipt instead of classifying a stale running snapshot as unknown", async (t) => {
  let releaseProvider;
  const waiting = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const f = await fixture(t, {
    provider: {
      reason: async () => {
        await waiting;
        return {
          status: "failed",
          receipt: {
            reservationId: request.reservationId,
            inputTokens: 1,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costMicros: 1,
            latencyMs: 1,
            outputs: [],
            directive: { kind: "failure", reason: "Expected failure" },
          },
        };
      },
    },
  });
  const request = input();
  const submitted = await f.transport.submit(request);
  const originalGet = f.store.get.bind(f.store);
  let intercepted = false,
    releaseRead,
    entered;
  const reading = new Promise((resolve) => {
      entered = resolve;
    }),
    blocked = new Promise((resolve) => {
      releaseRead = resolve;
    });
  f.store.get = async (bound) => {
    const row = await originalGet(bound);
    if (!intercepted) {
      intercepted = true;
      entered();
      await blocked;
    }
    return row;
  };
  const status = f.transport.status(binding(submitted));
  await reading;
  const originalPut = f.store.put.bind(f.store);
  let wroteReceipt;
  const receiptWritten = new Promise((resolve) => {
    wroteReceipt = resolve;
  });
  f.store.put = async (bound, value) => {
    const saved = await originalPut(bound, value);
    if (saved.status === "failed") wroteReceipt();
    return saved;
  };
  let timeout;
  try {
    releaseProvider();
    // Synchronize on the real durable write, not a machine-speed-dependent
    // number of three-millisecond polling attempts under the aggregate suite.
    await Promise.race([
      receiptWritten,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("receipt not written")), 10000);
      }),
    ]);
    assert.equal((await originalGet(submitted)).status, "failed");
  } finally {
    clearTimeout(timeout);
    releaseRead();
  }
  assert.equal((await status).status, "failed");
});

test("separate service instances atomically arbitrate submit versus nonexecution sealing", async (t) => {
  let calls = 0;
  const provider = {
    reason: async (request) => {
      calls++;
      return {
        status: "failed",
        receipt: {
          reservationId: request.reservationId,
          inputTokens: 1,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          costMicros: 1,
          latencyMs: 1,
          outputs: [],
          directive: { kind: "failure", reason: "test" },
        },
      };
    },
  };
  const f = await fixture(t, { provider });
  const other = createWorkRunnerService({
    configuration: config,
    store: new WorkAttemptStore(f.store.directory),
    provider,
    render: createWorkRenderer(),
    notify: async () => {},
    readiness: async () => true,
  });
  t.after(() => other.close());
  const transport = createWorkRunnerTransport(config, (url, init) =>
    other.handle(new Request(url, init)),
  );
  for (let i = 0; i < 8; i++) {
    const request = input(),
      bound = {
        ...binding(request),
        inputHash: await workInputHash(request),
        reservationId: request.reservationId,
      };
    const before = calls;
    const [submitted, sealed] = await Promise.all([
      f.transport.submit(request),
      transport.sealUndispatched(bound),
    ]);
    if (sealed.status === "not_executed") {
      assert.equal(submitted.status, "not_executed");
      assert.equal(calls, before);
    } else {
      assert.notEqual(submitted.status, "not_executed");
      for (let j = 0; j < 100 && calls === before; j++) await pause();
      assert.equal(calls, before + 1);
    }
  }
});

test("owner retirement waits for a cross-instance late writer before acknowledging private erasure", async (t) => {
  const f = await fixture(t),
    other = new WorkAttemptStore(f.store.directory),
    request = input();
  const bound = { ...binding(request), inputHash: await workInputHash(request) };
  let enter, release;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    blocked = new Promise((resolve) => {
      release = resolve;
    });
  const originalRetired = f.store.ownerRetired.bind(f.store);
  let first = true;
  f.store.ownerRetired = async (owner) => {
    const retired = await originalRetired(owner);
    if (first) {
      first = false;
      enter();
      await blocked;
    }
    return retired;
  };
  const writing = f.store.create(bound, {
    ...bound,
    attemptId: uuid(),
    status: "accepted",
    privateInput: "private draft",
  });
  await entered;
  await other.retireOwner(OWNER);
  let erased = false;
  const erasure = other.purgeOwner(OWNER).then(() => {
    erased = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(erased, false);
  release();
  await writing;
  await erasure;
  assert.equal(await other.get(bound), null);
  await assert.rejects(
    f.store.create({ ...bound, stepId: uuid() }, { ...bound, ownerId: OWNER, status: "accepted" }),
    /owner_retired/,
  );
});

test("a stale completion from another store preserves durable cancellation and real usage", async (t) => {
  const f = await fixture(t),
    other = new WorkAttemptStore(f.store.directory),
    request = input();
  const bound = { ...binding(request), inputHash: await workInputHash(request) },
    base = { ...bound, attemptId: uuid(), status: "running" };
  await f.store.create(bound, base);
  await other.put(bound, { ...base, status: "cancelled" });
  const receipt = {
    ...bound,
    reservationId: request.reservationId,
    inputTokens: 20,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costMicros: 1,
    latencyMs: 1,
    outputs: [],
    directive: { kind: "failure", reason: "Expected failure" },
  };
  await f.store.put(bound, { ...base, status: "failed", receipt });
  const current = await f.transport.status(bound);
  assert.equal(current.status, "cancelled");
  assert.equal(current.receipt.inputTokens, 20);
});

test("a cross-instance cancellation before the running transition prevents provider admission", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
      provider: {
        reason: async () => {
          calls++;
          throw new Error("must not execute");
        },
      },
    }),
    other = new WorkAttemptStore(f.store.directory),
    originalPut = f.store.put.bind(f.store);
  let enter, release;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    blocked = new Promise((resolve) => {
      release = resolve;
    });
  f.store.put = async (bound, row, options) => {
    if (row.status === "running") {
      enter();
      await blocked;
    }
    return originalPut(bound, row, options);
  };
  const submitted = await f.transport.submit(input());
  await entered;
  await other.put(submitted, { ...(await other.get(submitted)), status: "cancelled" });
  release();
  for (let i = 0; i < 30; i++) await pause();
  assert.equal(calls, 0);
  assert.equal((await f.transport.status(binding(submitted))).status, "cancelled");
});
