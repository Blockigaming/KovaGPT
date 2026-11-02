import test from "node:test";
import assert from "node:assert/strict";
import {
  browserRunnerCommand,
  browserRunnerCapabilities,
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
test("signed public-web capabilities permit an empty allowlist only with explicit public scope", async () => {
  const fetcher = (publicWeb) => async (_, init) => {
    const request = JSON.parse(init.body);
    const raw = JSON.stringify({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: configuration.id,
      build: configuration.build,
      requestId: request.requestId,
      at: Date.now(),
      payload: {
        status: "ready",
        expiresAt: Date.now() + 10000,
        browserCapabilities: {
          protocol: "kova-browser-v1",
          available: true,
          origins: [],
          maxSessionSeconds: 300,
          siteRulesVersion: 1,
          publicWeb,
        },
      },
    });
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json",
        "X-Kova-Signature": await signRunnerEnvelope(configuration.signingKey, "response", raw),
      },
    });
  };
  const result = await browserRunnerCapabilities(configuration, undefined, fetcher(true));
  assert.equal(result.publicWeb, true);
  assert.equal(result.siteRulesVersion, 1);
  for (const value of [false, "true", undefined])
    await assert.rejects(browserRunnerCapabilities(configuration, undefined, fetcher(value)));
});
test("site-rule bindings accept only an origin, excluding credentials, paths and query tokens", async () => {
  async function verify(destination, siteRulesVersion = 1) {
    const raw = JSON.stringify({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: configuration.id,
      build: configuration.build,
      requestId: crypto.randomUUID(),
      at: Date.now(),
      operation: "browser_authorize",
      payload: { ...payload, destination, siteRulesVersion },
    });
    return verifyBrowserInvocation(
      configuration,
      raw,
      await signRunnerEnvelope(configuration.signingKey, "request", raw),
    );
  }
  assert.equal((await verify("https://example.com")).payload.destination, "https://example.com");
  for (const value of [
    "https://example.com/private",
    "https://example.com?token=secret",
    "https://user:pass@example.com",
    "http://example.com",
  ])
    await assert.rejects(verify(value));
  await assert.rejects(verify("https://example.com", 2));
});
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
