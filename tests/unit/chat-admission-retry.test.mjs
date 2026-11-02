import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["src/lib/chat-admission-retry.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { fetchChatWithAdmissionRetry } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

test("brief admission contention reuses the identical generation identifier", async () => {
  const init = {
    headers: { "Idempotency-Key": "same-generation" },
    signal: new AbortController().signal,
  };
  const calls = [],
    delays = [];
  const result = await fetchChatWithAdmissionRetry(
    async (_, options) => {
      calls.push(options);
      return calls.length === 1
        ? Response.json({ code: "global_concurrency", retryable: true }, { status: 429 })
        : new Response("data: done");
    },
    "/api/chat",
    init,
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(delays, [500]);
  assert.ok(calls.every((call) => call === init));
});

test("quotas, provider limits, duplicate requests and ambiguous failures are never replayed", async () => {
  for (const code of ["daily_tokens", "provider_rate_limited", "duplicate", undefined]) {
    let calls = 0;
    await fetchChatWithAdmissionRetry(
      async () => {
        calls++;
        return Response.json({ code, retryable: true }, { status: 429 });
      },
      "/api/chat",
      {},
      async () => assert.fail("no retry"),
    );
    assert.equal(calls, 1);
  }
});

test("contention retries are bounded and cancellation prevents dispatch", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return Response.json({ code: "principal_concurrency", retryable: true }, { status: 429 });
  };
  assert.equal(
    (await fetchChatWithAdmissionRetry(transport, "/api/chat", {}, async () => {})).status,
    429,
  );
  assert.equal(calls, 4);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    fetchChatWithAdmissionRetry(transport, "/api/chat", { signal: controller.signal }, async () =>
      controller.abort(),
    ),
    /abort/i,
  );
  assert.equal(calls, 1);
});
