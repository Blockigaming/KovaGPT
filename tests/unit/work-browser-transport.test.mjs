import test from "node:test";
import assert from "node:assert/strict";
import {
  browserRunnerCommand,
  createBrowserBackendAuthority,
  verifyBrowserInvocation,
} from "../../src/lib/work-browser-transport.mjs";
import { signRunnerEnvelope } from "../../src/lib/work-runner-transport.mjs";
import { WORK_EXECUTION_PROTOCOL } from "../../src/lib/work-execution-protocol.mjs";
const configuration = {
  id: crypto.randomUUID(),
  origin: "https://runner-fixture.net",
  build: "a".repeat(40),
  token: "t".repeat(64),
  signingKey: "s".repeat(64),
};
const payload = {
  phase: "check",
  actor: "owner",
  ownerId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  sequence: 1,
};
test("backend authorizer verifies exact signed principal binding and signed requestId response", async () => {
  const authority = createBrowserBackendAuthority(
    configuration,
    "https://app-fixture.net",
    async (url, init) => {
      assert.equal(url, "https://app-fixture.net/api/internal/work-browser");
      assert.equal(init.redirect, "error");
      const verified = await verifyBrowserInvocation(
        configuration,
        init.body,
        init.headers["X-Kova-Signature"],
      );
      assert.deepEqual(verified.payload, payload);
      const raw = JSON.stringify({
        protocol: WORK_EXECUTION_PROTOCOL,
        runnerId: configuration.id,
        build: configuration.build,
        requestId: verified.requestId,
        at: Date.now(),
        payload: { allowed: true, sequence: 1, expiresAt: Date.now() + 10000 },
      });
      return new Response(raw, {
        headers: {
          "Content-Type": "application/json",
          "X-Kova-Signature": await signRunnerEnvelope(configuration.signingKey, "response", raw),
        },
      });
    },
  );
  assert.equal((await authority(payload)).allowed, true);
  await assert.rejects(verifyBrowserInvocation(configuration, "{}", "a".repeat(64)));
});
test("a valid signature cannot substitute an unrelated command response or replay stale invocation", async () => {
  const command = browserRunnerCommand(configuration, payload, undefined, async () => {
    const raw = JSON.stringify({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: configuration.id,
      build: configuration.build,
      requestId: crypto.randomUUID(),
      at: Date.now(),
      payload: { text: "private" },
    });
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json",
        "X-Kova-Signature": await signRunnerEnvelope(configuration.signingKey, "response", raw),
      },
    });
  });
  await assert.rejects(command);
  const raw = JSON.stringify({
    protocol: WORK_EXECUTION_PROTOCOL,
    runnerId: configuration.id,
    build: configuration.build,
    requestId: crypto.randomUUID(),
    at: Date.now() - 60000,
    operation: "browser_authorize",
    payload,
  });
  await assert.rejects(
    verifyBrowserInvocation(
      configuration,
      raw,
      await signRunnerEnvelope(configuration.signingKey, "request", raw),
    ),
  );
});
