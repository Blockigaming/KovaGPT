import test from "node:test";
import assert from "node:assert/strict";
import {
  createBrowserUseClient,
  validateBrowserUseConfig,
} from "../../work-runner/browser-use-client.mjs";
const id = "00000000-0000-4000-8000-000000000001";
const key = "fixture-only-key";
const secretUrl = "wss://cdp.browser-use.com/session?token=fixture-secret";
function fixture(handler) {
  const calls = [];
  const client = createBrowserUseClient(
    { enabled: true, apiKey: key },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options, body: JSON.parse(options.body) });
        if (handler) return handler(calls.at(-1));
        return Response.json({
          id,
          status: options.method === "POST" ? "active" : "stopped",
          cdpUrl: secretUrl,
        });
      },
    },
  );
  return { client, calls };
}
test("default off, no implicit fetch, strict bounded config and redacted key", async () => {
  await assert.rejects(createBrowserUseClient().create(), /disabled/);
  await assert.rejects(
    createBrowserUseClient({ enabled: true, apiKey: key }).create(),
    /transport_required/,
  );
  for (const input of [
    { enabled: "true" },
    { enabled: true, apiKey: key, maxSessionMinutes: 6 },
    { enabled: true, apiKey: "a\nb" },
    { enabled: true, apiKey: key, origin: "https://evil.test" },
  ])
    assert.throws(() => validateBrowserUseConfig(input), /invalid_config/);
  assert.equal(
    JSON.stringify(validateBrowserUseConfig({ enabled: true, apiKey: key })).includes(key),
    false,
  );
});
test("create, explicit no-proxy, bounded timeout, redacted handle, and confirmed stop", async () => {
  const { client, calls } = fixture();
  const result = await client.withSession(async (handle) => {
    assert.equal(handle.cdpUrl, secretUrl);
    assert.equal(JSON.stringify(handle).includes("fixture-secret"), false);
    return "page read";
  });
  assert.equal(result, "page read");
  assert.deepEqual(calls[0].body, {
    timeout: 5,
    proxyCountryCode: null,
    enableRecording: false,
    solveCaptchas: false,
  });
  assert.equal(calls[0].url, "https://api.browser-use.com/api/v4/browsers");
  assert.equal(calls[0].redirect, "error");
  assert.deepEqual(calls[1].body, { action: "stop" });
  await assert.rejects(client.stop(id), /unowned_session/);
});
test("operation failure is redacted and still stops", async () => {
  const { client, calls } = fixture();
  await assert.rejects(
    client.withSession(() => {
      throw Error(secretUrl);
    }),
    /^Error: browser_use_operation_failed$/,
  );
  assert.equal(calls[1].method, "PATCH");
});
test("cancellation releases browser even when operation ignores abort", async () => {
  const { client, calls } = fixture();
  const controller = new AbortController();
  await assert.rejects(
    client.withSession(
      () => {
        controller.abort();
        return new Promise(() => {});
      },
      { signal: controller.signal },
    ),
    /canceled/,
  );
  assert.equal(calls[1].signal.aborted, false);
  assert.equal(calls[1].method, "PATCH");
});
test("pre-canceled task never creates a browser", async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.create({ signal: AbortSignal.abort() }), /canceled/);
  assert.equal(calls.length, 0);
});
test("invalid credential URL causes cleanup without exposing raw URL", async () => {
  const { client, calls } = fixture((call) =>
    Response.json({
      id,
      status: call.method === "POST" ? "active" : "stopped",
      cdpUrl: "wss://evil.test/?token=secret",
    }),
  );
  await assert.rejects(client.create(), /^Error: browser_use_invalid_response$/);
  assert.equal(calls[1].method, "PATCH");
});
test("provider errors are redacted and ambiguous creation is not retried", async () => {
  const { client, calls } = fixture(() => {
    throw Error(secretUrl + key);
  });
  await assert.rejects(client.create(), /^Error: browser_use_request_failed$/);
  assert.equal(calls.length, 1);
});
test("oversized response rejected and never used as a session", async () => {
  const { client, calls } = fixture(() => Response.json({ id, extra: "a".repeat(17000) }));
  await assert.rejects(client.create(), /request_failed/);
  assert.equal(calls.length, 1);
});
test("cannot stop another client's session", async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.stop(id), /unowned_session/);
  assert.equal(calls.length, 0);
});
test("stop must be confirmed; cleanup failure is not reported as success", async () => {
  const { client, calls } = fixture(() =>
    Response.json({ id, status: "active", cdpUrl: secretUrl }),
  );
  await assert.rejects(
    client.withSession(() => "ok"),
    /stop_unconfirmed/,
  );
  assert.equal(calls.length, 2);
});
