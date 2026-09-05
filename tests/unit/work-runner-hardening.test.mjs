import assert from "node:assert/strict";
import test from "node:test";
import { createWorkBackend, probeWorkRunner } from "../../work-runner/backend.mjs";
import { createWorkActionBroker } from "../../work-runner/action-broker.mjs";
import { createWorkRenderer } from "../../work-runner/render.mjs";
import { configuredProvider } from "../../work-runner/provider.mjs";
import { workRunnerMatchesOwnerHistory } from "../../src/lib/work-runner-transport.mjs";
import { canonicalWorkInput, workInputHash } from "../../src/lib/work-execution-protocol.mjs";
const config = {
  origin: "https://runner.example.net",
  id: crypto.randomUUID(),
  build: "a".repeat(40),
  token: "t".repeat(64),
  signingKey: "s".repeat(64),
};

test("negative isolation probe cannot advertise readiness even with a healthy backend", async () => {
  let calls = 0;
  const backend = async () => {
    calls++;
    return { status: "ready" };
  };
  for (const result of [null, {}, false, { ready: false }, { ready: "true" }])
    await assert.rejects(probeWorkRunner({ probe: async () => result }, backend), /isolation/);
  assert.equal(calls, 0);
  assert.equal(await probeWorkRunner({ probe: async () => ({ ready: true }) }, backend), true);
  await assert.rejects(
    probeWorkRunner({ probe: async () => ({ ready: true }) }, async () => ({
      status: "unavailable",
    })),
    /backend/,
  );
});

test("backend callback responses abort at the byte bound before buffering the complete body", async () => {
  let cancelled = false,
    pulls = 0;
  const backend = createWorkBackend(
    config,
    "https://kova.example.net",
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(2048).fill(32));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  await assert.rejects(backend("probe", null), /response_limit/);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4);
  const valid = createWorkBackend(config, "https://kova.example.net", async () =>
    Response.json({ status: "ready" }),
  );
  assert.equal((await valid("probe", null)).status, "ready");
});

test("owner-specific grant and approval expiry require actual integer timestamps", async () => {
  const owner = crypto.randomUUID(),
    operation = {
      id: "message",
      action: "send_message",
      url: "https://api.example.net/messages",
      method: "POST",
      response: "json",
    };
  const body = {
    operationId: operation.id,
    url: operation.url,
    method: "POST",
    body: { message: "Exact reviewed message" },
  };
  const input = {
    ownerId: owner,
    runId: crypto.randomUUID(),
    approval: {
      id: crypto.randomUUID(),
      action: operation.action,
      status: "approved",
      expiresAt: Date.now() + 50000,
      canonicalInput: canonicalWorkInput(body),
      inputHash: await workInputHash(body),
    },
  };
  let expiry = Date.now() + 50000,
    calls = 0;
  const broker = createWorkActionBroker(
    {
      operations: [operation],
      credentialFor: async () => ({
        ownerId: owner,
        operationId: operation.id,
        token: "k".repeat(32),
        expiresAt: expiry,
      }),
    },
    async () => {
      calls++;
      return Response.json({ sent: true });
    },
  );
  for (const invalid of [undefined, null, NaN, Infinity, "9999999999999", 0]) {
    expiry = invalid;
    await assert.rejects(broker.execute(input, {}), /grant/);
    expiry = Date.now() + 50000;
    await assert.rejects(
      broker.execute({ ...input, approval: { ...input.approval, expiresAt: invalid } }, {}),
      /approval/,
    );
  }
  assert.equal(calls, 0);
  assert.equal((await broker.execute(input, {})).outcome, "completed");
});

test("cleanup routes old and new builds of the same runner identity, but never skips another runner", () => {
  assert.equal(
    workRunnerMatchesOwnerHistory(config, [
      { state: { runnerId: config.id, runnerBuild: "old-build" } },
      { state: { runnerId: config.id, runnerBuild: config.build } },
    ]),
    true,
  );
  assert.equal(
    workRunnerMatchesOwnerHistory(config, [
      { state: { runnerId: crypto.randomUUID(), runnerBuild: config.build } },
    ]),
    false,
  );
  assert.equal(workRunnerMatchesOwnerHistory(config, [{}]), false);
});

test("CSV rejects formula-leading negative expressions while preserving literal negative numeric cells", async () => {
  const render = createWorkRenderer();
  const malicious = [
    "value\n-cmd|' /C calc'!A0",
    "value\n\"-cmd|' /C calc'!A0\"",
    "value\n-1+2",
    'value\n=HYPERLINK("https://evil.test")',
    "value\n+SUM(A1)",
    "value\n@SUM(A1)",
  ];
  for (const content of malicious) await assert.rejects(render({ format: "csv", content }), /csv/);
  const content =
    'name,value\n"Negative, number",-12.5\nScientific,-1.2e-3\nLeadingDecimal,-.5\nLiteral,"\'-formula"';
  assert.equal(new TextDecoder().decode((await render({ format: "csv", content })).bytes), content);
});

test("isolated CSV artifacts receive the same formula validation before publication descriptors exist", async () => {
  const provider = configuredProvider(
    {
      responsesUrl: "https://provider.example.net/responses",
      providerKey: "k".repeat(32),
      models: ["model"],
      sandbox: {
        run: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          outputs: [
            { name: "bad.csv", bytes: new TextEncoder().encode("value\n-cmd|' /C calc'!A0") },
          ],
        }),
      },
    },
    async () =>
      Response.json({
        output_text: JSON.stringify({ kind: "analysis", code: "print(1)", inputFiles: [] }),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
  );
  const result = await provider.reason(
    {
      model: "model",
      stepId: crypto.randomUUID(),
      reservationId: crypto.randomUUID(),
      maxOutputTokens: 100,
    },
    { render: createWorkRenderer() },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.receipt.outputs.length, 0);
  assert.equal(result.receipt.inputTokens, 1);
});
