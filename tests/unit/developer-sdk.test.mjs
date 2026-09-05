import assert from "node:assert/strict";
import test from "node:test";
import { KovaGPT, KovaError, responseEvents } from "../../sdk/javascript/index.mjs";
const apiKey = `kova_11111111-1111-4111-8111-111111111111_${"a".repeat(43)}`;
const input = { model: "kova-fast", input: "hello", max_output_tokens: 100 };
const options = { currency: "USD", maximumCharge: 10, idempotencyKey: "stable-request" };
const quote = () => ({
  quoteToken: `e30.${"a".repeat(64)}`,
  currency: "USD",
  maximumCharge: 5,
  pricingVersion: "version",
  expiresAt: Date.now() + 119000,
});
function fixture(handler) {
  const calls = [];
  const client = new KovaGPT({
    apiKey,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return handler
        ? handler(url, init, calls)
        : url.endsWith("quotes")
          ? Response.json(quote())
          : Response.json({ output: [] });
    },
  });
  return { client, calls };
}
test("SDK refuses implicit budgets, browser secrets and unsafe origins before network", async () => {
  const f = fixture();
  await assert.rejects(f.client.responses.create(input, {}), /budget_required/);
  await assert.rejects(
    f.client.responses.create(input, { ...options, idempotencyKey: "" }),
    /idempotency/,
  );
  assert.equal(f.calls.length, 0);
  for (const baseURL of [
    "http://kovagpt.com",
    "https://user:pass@kovagpt.com",
    "https://kovagpt.com/other",
    "https://kovagpt.com?key=x",
  ])
    assert.throws(() => new KovaGPT({ apiKey, baseURL }), /origin_invalid/);
  globalThis.window = { document: {} };
  try {
    assert.throws(() => new KovaGPT({ apiKey }), /browser_secret_forbidden/);
  } finally {
    delete globalThis.window;
  }
  assert.equal(JSON.stringify(f.client).includes(apiKey), false);
});
test("SDK accepts only same-currency bounded quotes and snapshots data across awaits", async () => {
  const mutable = structuredClone(input),
    settings = { ...options };
  const f = fixture((url) => {
    if (url.endsWith("quotes")) {
      mutable.input = "changed";
      settings.maximumCharge = 0.1;
      return Response.json(quote());
    }
    return Response.json({ ok: true });
  });
  await f.client.responses.create(mutable, settings);
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1].body).input, "hello");
  assert.equal(f.calls[1].headers["Idempotency-Key"], options.idempotencyKey);
  assert.equal(f.calls[1].redirect, "error");
  assert.equal(f.calls[1].credentials, "omit");
  for (const patch of [
    { currency: "EUR" },
    { maximumCharge: 11 },
    { expiresAt: Date.now() - 1 },
    { quoteToken: "untrusted" },
  ])
    await assert.rejects(
      f.client.execute("responses", input, { ...options, quote: { ...quote(), ...patch } }),
      /quote_outside_budget/,
    );
  assert.equal(f.calls.length, 2);
});
test("uncertain dispatch never retries itself or exposes a secret from a transport error", async () => {
  const f = fixture((url) => {
    if (url.endsWith("quotes")) return Response.json(quote());
    throw new Error(apiKey);
  });
  await assert.rejects(
    f.client.responses.create(input, options),
    (error) =>
      error instanceof KovaError &&
      error.code === "transport_failed" &&
      error.requestMayHaveStarted &&
      !String(error).includes(apiKey),
  );
  assert.equal(f.calls.length, 2);
  const fail = fixture(() =>
    Response.json({ error: { code: apiKey, message: apiKey } }, { status: 503 }),
  );
  await assert.rejects(
    fail.client.execute("responses", input, { ...options, quote: quote() }),
    (error) => error.code === "request_failed" && !String(error).includes(apiKey),
  );
});
test("explicit retries preserve the caller idempotency key; already aborted requests do not dispatch", async () => {
  const f = fixture();
  await f.client.execute("responses", input, { ...options, quote: quote() });
  await f.client.execute("responses", input, { ...options, quote: quote() });
  assert.deepEqual(
    f.calls.map((call) => call.headers["Idempotency-Key"]),
    ["stable-request", "stable-request"],
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.client.execute("responses", input, { ...options, quote: quote(), signal: controller.signal }),
    (error) => error.code === "request_aborted" && !error.requestMayHaveStarted,
  );
  assert.equal(f.calls.length, 2);
});
test("stream iterator decodes split CRLF/multibyte events and releases upstream on break", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"response.output_text.delta","delta":"é"}\r\n\r\ndata: [DONE]\r\n\r\n',
  );
  let cancelled = false,
    offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  for await (const event of responseEvents(response)) {
    assert.equal(event.delta, "é");
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
test("stream iterator rejects oversized, malformed and truncated data", async () => {
  for (const data of [
    'data: {"x":',
    "data: bad\n\n",
    `data: ${"x".repeat(100)}\n\n`,
    'data: {"type":"response.output_text.delta","delta":"x"}\n\n',
  ]) {
    const response = new Response(data, { headers: { "Content-Type": "text/event-stream" } });
    await assert.rejects(async () => {
      for await (const event of responseEvents(response, { maximumEventBytes: 64 })) void event;
    }, /stream_/);
    assert.equal(response.body.locked, false);
  }
});
test("stream completion is explicit and preserves an incomplete provider result", async () => {
  for (const type of ["response.completed", "response.incomplete", "response.failed"]) {
    const response = new Response(`data: ${JSON.stringify({ type })}\n\ndata: [DONE]\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const events = [];
    for await (const event of responseEvents(response)) events.push(event);
    assert.deepEqual(events, [{ type }]);
  }
});

test("SDK files use explicit idempotency and a validated opaque identifier without an inference quote", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({ id, deleted: true }));
  await f.client.files.upload(
    { filename: "data.csv", mimeType: "text/csv", text: "A,1" },
    { idempotencyKey: "upload-1" },
  );
  await f.client.files.list({ page: 2 });
  await f.client.files.retrieve(id);
  await f.client.files.delete(id);
  assert.equal(f.calls[0].headers["Idempotency-Key"], "upload-1");
  assert.equal(f.calls[3].method, "DELETE");
  assert.ok(f.calls.every((call) => !call.url.endsWith("quotes")));
  await assert.rejects(f.client.files.retrieve("https://private.invalid"), /file_id_invalid/);
  await assert.rejects(f.client.files.list({ page: 5 }), /file_page_invalid/);
  assert.equal(f.calls.length, 4);
});
test("SDK forwards real AbortSignals through fetch and terminates an in-flight streamed body on timeout", async () => {
  let forwarded,
    ended = false;
  const client = new KovaGPT({
    apiKey,
    timeoutMs: 20,
    fetch: async (url, init) => {
      forwarded = init.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.output_text.delta","delta":"a"}\n\n',
              ),
            );
            init.signal.addEventListener(
              "abort",
              () => {
                ended = true;
                controller.error(init.signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const response = await client.execute("responses", input, { ...options, quote: quote() });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(async () => {
      for await (const event of responseEvents(response)) void event;
    }, /timed out|timeout/i);
    assert.ok(forwarded instanceof AbortSignal);
    assert.equal(forwarded.aborted, true);
    assert.equal(ended, true);
    assert.equal(response.body.locked, false);
  } finally {
    clearTimeout(keepAlive);
  }
});
