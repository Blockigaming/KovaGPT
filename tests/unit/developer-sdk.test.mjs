import assert from "node:assert/strict";
import test from "node:test";
import { readDeveloperMultipartFile } from "../../src/lib/pricing/developer-file-policy.mjs";
import {
  KovaGPT,
  KovaError,
  responseEvents,
  chatCompletionEvents,
  verifyWebhookSignature,
} from "../../sdk/javascript/index.mjs";
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

test("SDK exposes scoped usage reads and model filtering without quote or inference calls", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({ data: [] }));
  await f.client.usage.list({ limit: 100, offset: 10000 });
  await f.client.usage.retrieve(id);
  await f.client.models({ id: "kova-argon-4.6" });
  assert.deepEqual(
    f.calls.map((call) => [call.url, call.method]),
    [
      ["https://kovagpt.com/api/v1/usage?limit=100&offset=10000", "GET"],
      [`https://kovagpt.com/api/v1/usage?id=${id}`, "GET"],
      ["https://kovagpt.com/api/v1/models?id=kova-argon-4.6", "GET"],
    ],
  );
  for (const invalid of [{ limit: 101 }, { limit: 0 }, { offset: 10001 }, { offset: 1.5 }])
    await assert.rejects(f.client.usage.list(invalid), /usage_pagination_invalid/);
  await assert.rejects(f.client.usage.retrieve("x&offset=2"), /usage_id_invalid/);
  await assert.rejects(f.client.models({ id: "../quotes" }), /model_id_invalid/);
  assert.equal(f.calls.length, 3);
});
test("SDK moderation uses the same exact signed quote and budget boundary", async () => {
  const f = fixture();
  const body = { model: "kova-moderation", input: "Synthetic test" };
  await assert.rejects(f.client.moderations.create(body, {}), /budget_required/);
  await f.client.moderations.create(body, options);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "moderations", input: body });
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/moderations");
  assert.deepEqual(JSON.parse(f.calls[1].body), body);
  assert.equal(f.calls[1].headers["Idempotency-Key"], options.idempotencyKey);
  assert.match(f.calls[1].headers["X-Kova-Quote"], /^e30\./);
});

test("image edit SDK requires an inline source and uses the quoted images contract", async () => {
  const f = fixture();
  const body = {
    model: "kova-image",
    prompt: "edit",
    size: "1024x1024",
    quality: "medium",
    image:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9h8AAAAASUVORK5CYII=",
  };
  await assert.rejects(
    f.client.images.edit({ ...body, image: undefined }, options),
    /image_required/,
  );
  await f.client.images.edit(body, options);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "images", input: body });
  assert.deepEqual(JSON.parse(f.calls[1].body), body);
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/images");
});

test("vector SDK uses scoped resources, fixed operations and stable creation identity", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({}));
  await f.client.vectorStores.create(
    { name: "index", model: "embedding", dimensions: 2 },
    { idempotencyKey: "stable" },
  );
  await f.client.vectorStores.upsert({
    store_id: id,
    entry_id: "item",
    model: "embedding",
    vector: [1, 0],
    text: "example",
  });
  await f.client.vectorStores.search({ store_id: id, model: "embedding", vector: [1, 0] });
  await f.client.vectorStores.listEntries(id, { page: 1 });
  await f.client.vectorStores.deleteEntry(id, "item");
  assert.deepEqual(
    f.calls.slice(0, 3).map((c) => JSON.parse(c.body).operation),
    ["create", "upsert", "search"],
  );
  assert.equal(f.calls[0].headers["Idempotency-Key"], "stable");
  assert.equal(
    f.calls[3].url,
    "https://kovagpt.com/api/v1/vector-stores?id=" + id + "&entries=true&page=1",
  );
  assert.equal(f.calls[4].method, "DELETE");
  assert.ok(f.calls.every((c) => !c.headers["X-Kova-Quote"]));
  await assert.rejects(
    f.client.vectorStores.retrieveEntry(id, "x&other=1"),
    /vector_entry_invalid/,
  );
  await assert.rejects(f.client.vectorStores.deleteEntry(id), /vector_entry_invalid/);
  await assert.rejects(f.client.vectorStores.retrieveEntry(id), /vector_entry_invalid/);
  assert.equal(f.calls.length, 5);
});

test("chat completion stream requires both finish reason and DONE", async () => {
  const chunk = {
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  const frame = "data: " + JSON.stringify(chunk) + "\n\n";
  for (const [data, valid] of [
    [frame + "data: [DONE]\n\n", true],
    [frame, false],
    ["data: [DONE]\n\n", false],
  ]) {
    const response = new Response(data, { headers: { "Content-Type": "text/event-stream" } });
    const collect = async () => {
      const result = [];
      for await (const event of chatCompletionEvents(response)) result.push(event);
      return result;
    };
    if (valid) assert.deepEqual(await collect(), [chunk]);
    else await assert.rejects(collect(), /stream_truncated/);
    assert.equal(response.body.locked, false);
  }
});

test("conversation SDK keeps explicit revisions and validates item paths before transport", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({}));
  await f.client.conversations.create({ id, title: "Example" });
  await f.client.conversations.append({
    id,
    expected_revision: 0,
    item: { id, role: "user", content: "hello" },
  });
  await f.client.conversations.retrieveItem(id, id);
  await f.client.conversations.delete(id);
  assert.equal(JSON.parse(f.calls[0].body).operation, "create");
  assert.equal(JSON.parse(f.calls[1].body).expected_revision, 0);
  assert.equal(
    f.calls[2].url,
    "https://kovagpt.com/api/v1/conversations?id=" + id + "&item_id=" + id,
  );
  assert.equal(f.calls[3].method, "DELETE");
  assert.ok(f.calls.every((call) => !call.headers["X-Kova-Quote"]));
  await assert.rejects(f.client.conversations.retrieveItem(id), /conversation_id_invalid/);
  assert.equal(f.calls.length, 4);
});

test("webhook verification authenticates the original bytes and rejects replay and tampering", () => {
  const input = {
    secret: "whsec_" + "a".repeat(43),
    eventId: "11111111-1111-4111-8111-111111111111",
    timestamp: "1795651200",
    body: '{"message":"café"}',
    signature: "v1=c9b338ec00ca9cbe82fba49f1a10e098931f373563745588c85a976b43c63478",
    now: 1795651200,
  };
  assert.equal(verifyWebhookSignature(input), true);
  assert.equal(verifyWebhookSignature({ ...input, body: Buffer.from(input.body) }), true);
  assert.equal(verifyWebhookSignature({ ...input, timestamp: 1795651200 }), true);
  for (const patch of [
    { body: input.body + " " },
    { body: "x".repeat(65537) },
    { timestamp: "01795651200" },
    { timestamp: "1795651201" },
    { timestamp: "1795651200, 1795651200" },
    { now: input.now + 301 },
    { now: input.now - 301 },
    { eventId: "22222222-2222-4222-8222-222222222222" },
    { secret: "whsec_" + "b".repeat(43) },
    { signature: "v1=" + "0".repeat(64) },
  ])
    assert.equal(verifyWebhookSignature({ ...input, ...patch }), false);
  assert.equal(verifyWebhookSignature(null), false);
});

test("transcription uses a dedicated quote and bounded larger audio request", async () => {
  const f = fixture();
  const input = { model: "transcribe", audio: "data:audio/wav;base64," + "A".repeat(80000) };
  await (await f.client.audio.transcriptions.create(input, options)).json();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "audio/transcriptions", input });
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/audio/transcriptions");
  assert.deepEqual(JSON.parse(f.calls[1].body), input);
  assert.equal(f.calls[1].headers["Idempotency-Key"], "stable-request");
  await assert.rejects(f.client.responses.create({ ...input, input: input.audio }, options));
  assert.equal(f.calls.length, 2);
});

test("response jobs use a stable ID, explicit quote and budget, and separate retrieval routes", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({ id, status: "queued" }));
  const job = {
    id,
    currency: "USD",
    maximum_charge: 10,
    quote_token: quote().quoteToken,
    input,
  };
  await f.client.responseJobs.create(job);
  await f.client.responseJobs.list();
  await f.client.responseJobs.retrieve(id);
  await f.client.responseJobs.cancel(id);
  assert.equal(f.calls[0].url, "https://kovagpt.com/api/v1/response-jobs");
  assert.deepEqual(JSON.parse(f.calls[0].body), { ...job, operation: "create" });
  assert.equal(f.calls[2].url, "https://kovagpt.com/api/v1/response-jobs?id=" + id);
  assert.deepEqual(JSON.parse(f.calls[3].body), { operation: "cancel", id });
  await assert.rejects(
    f.client.responseJobs.create({ ...job, quote_token: "" }),
    /budget_required/,
  );
  await assert.rejects(f.client.responseJobs.retrieve("../keys"), /response_job_id_invalid/);
  assert.equal(f.calls.length, 4);
});

test("paid queue operations preserve uncertainty after dispatch and never retry", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const job = { id, currency: "USD", maximum_charge: 10, items: [] };
  const responseJob = {
    id,
    currency: "USD",
    maximum_charge: 10,
    quote_token: quote().quoteToken,
    input,
  };
  const actions = [
    (client) => client.batches.create(job),
    (client) => client.automations.create(job),
    (client) => client.automations.resume(id),
    (client) => client.responseJobs.create(responseJob),
  ];
  for (const action of actions) {
    for (const handler of [
      () => {
        throw new Error("lost acknowledgement");
      },
      () => new Response("invalid JSON", { status: 202 }),
      () => new Response("x".repeat(262145), { status: 202 }),
      () => Response.json({}, { status: 503 }),
    ]) {
      const f = fixture(handler);
      await assert.rejects(
        action(f.client),
        (error) => error instanceof KovaError && error.requestMayHaveStarted,
      );
      assert.equal(f.calls.length, 1);
    }
  }
  const f = fixture(() => {
    throw new Error("lost acknowledgement");
  });
  await assert.rejects(
    f.client.batches.cancel(id),
    (error) => error instanceof KovaError && !error.requestMayHaveStarted,
  );
});

test("multipart SDK uploads match the server validator and preserve the stable retry key", async () => {
  const input = { filename: "data.csv", mimeType: "text/csv", text: "A,é\nB,2" };
  const f = fixture(async (url, init) => {
    assert.equal(init.headers["Content-Type"], undefined);
    assert.equal(init.headers["Idempotency-Key"], "upload-1");
    assert.deepEqual(await readDeveloperMultipartFile(new Request(url, init)), input);
    return Response.json({ id: "file" });
  });
  await f.client.files.uploadMultipart(input, { idempotencyKey: "upload-1" });
  for (const invalid of [
    { ...input, filename: "../data.csv" },
    { ...input, mimeType: "text/plain" },
    { ...input, project: "foreign" },
    { ...input, text: "\ud800" },
    { ...input, text: "é".repeat(16385) },
    { filename: "bad.json", mimeType: "application/json", text: "NaN" },
  ])
    await assert.rejects(
      f.client.files.uploadMultipart(invalid, { idempotencyKey: "upload-1" }),
      /file_invalid/,
    );
  await assert.rejects(f.client.files.uploadMultipart(input), /idempotency_key_required/);
  assert.equal(f.calls.length, 1);
});

test("vector batch SDK sends one scoped atomic resource mutation", async () => {
  const f = fixture(() => Response.json({ object: "list", data: [] }));
  const data = {
    store_id: "11111111-1111-4111-8111-111111111111",
    model: "kova-embedding",
    entries: [{ entry_id: "a", vector: [1], text: "one" }],
  };
  await f.client.vectorStores.upsertBatch(data);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body), { ...data, operation: "upsert_batch" });
});

test("research runs use a separate scoped API and stable job identifiers", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const f = fixture(() => Response.json({ id, status: "queued" }));
  const job = { id, currency: "USD", maximum_charge: 1, items: [] };
  await f.client.researchRuns.create(job);
  await f.client.researchRuns.list();
  await f.client.researchRuns.retrieve(id);
  await f.client.researchRuns.cancel(id);
  assert.equal(f.calls[0].url, "https://kovagpt.com/api/v1/research-runs");
  assert.deepEqual(JSON.parse(f.calls[0].body), { ...job, operation: "create" });
  assert.equal(f.calls[2].url, "https://kovagpt.com/api/v1/research-runs?id=" + id);
  assert.deepEqual(JSON.parse(f.calls[3].body), { operation: "cancel", id });
  await assert.rejects(f.client.researchRuns.retrieve("../keys"), /response_job_id_invalid/);
  assert.equal(f.calls.length, 4);
});

test("speech SDK authorizes exactly the same input and never sends unquoted generation", async () => {
  const f = fixture();
  const speech = { model: "speech", input: "hello", voice: "default" };
  await assert.rejects(f.client.audio.speech.create(speech, {}), /budget_required/);
  assert.equal(f.calls.length, 0);
  await f.client.audio.speech.create(speech, options);
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/audio/speech");
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "audio/speech", input: speech });
  assert.deepEqual(JSON.parse(f.calls[1].body), speech);
});

test("analysis keeps the exact project file IDs in the signed request", async () => {
  const f = fixture();
  const data = { ...input, file_ids: ["55555555-5555-4555-8555-555555555555"] };
  await f.client.analysis.create(data, options);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "analysis", input: data });
  assert.deepEqual(JSON.parse(f.calls[1].body), data);
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/analysis");
});

test("recorded audio translation is a separately quoted text request, never a hidden audio dispatch", async () => {
  const f = fixture();
  const data = {
    model: "kova-fast",
    transcription: {
      id: "req_test",
      status: "completed",
      text: "bonjour",
      usage: { type: "duration", seconds: 1 },
    },
    target_language: "en",
    max_output_tokens: 100,
  };
  await assert.rejects(
    f.client.audio.translations.create(
      { ...data, transcription: { ...data.transcription, status: "failed" } },
      options,
    ),
    /transcription_incomplete/,
  );
  assert.equal(f.calls.length, 0);
  await f.client.audio.translations.create(data, options);
  assert.equal(f.calls.length, 2);
  const body = JSON.parse(f.calls[1].body);
  assert.deepEqual(JSON.parse(body.input), { target_language: "en", transcript: "bonjour" });
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/responses");
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "responses", input: body });
});

test("research planning, quote-only preparation and separately authorized synthesis use durable run IDs", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const queryIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const data = { model: "kova-fast", question: "How does it work?", max_output_tokens: 100 };
  const response = {
    id: "resp_plan",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify({ queries: ["first", "second"] }) }],
      },
    ],
  };
  const item = {
    id: queryIds[0],
    query: "first",
    status: "completed",
    result_status: "completed",
    settlement_state: "settled",
    text: "Evidence",
    citations: [{ url: "https://example.com/report", title: "Report" }],
  };
  let run = {
    id,
    object: "research.run",
    status: "completed",
    items: [item, { ...item, id: queryIds[1], query: "second" }],
  };
  const f = fixture((url) =>
    url.endsWith("quotes")
      ? Response.json(quote())
      : url.includes("research-runs?id=")
        ? Response.json(run)
        : Response.json(response),
  );
  const plan = await f.client.researchRuns.plan(data, options);
  assert.deepEqual(plan, { queries: ["first", "second"], response_id: "resp_plan" });
  assert.equal(f.calls.length, 2);
  const draftInput = {
    id,
    currency: "USD",
    maximum_charge: 10,
    model: data.model,
    queries: plan.queries.map((query, i) => ({ id: queryIds[i], query })),
    max_output_tokens: 100,
    max_tool_calls: 1,
  };
  const draft = await f.client.researchRuns.prepare(draftInput);
  assert.equal(f.calls.length, 4);
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].quote_token, quote().quoteToken);
  assert.ok(f.calls.slice(2).every((call) => call.url.endsWith("quotes")));
  await assert.rejects(
    f.client.researchRuns.prepare({ ...draftInput, maximum_charge: 9 }),
    /quote_outside_budget/,
  );
  assert.equal(f.calls.length, 6);
  await f.client.researchRuns.synthesize(id, data, options);
  assert.equal(f.calls.length, 9);
  const body = JSON.parse(f.calls[8].body);
  assert.equal(JSON.parse(body.input).evidence.length, 2);
  assert.deepEqual(JSON.parse(f.calls[7].body), { operation: "responses", input: body });
  run = {
    ...run,
    status: "partial",
    items: [item, { ...item, id: queryIds[1], settlement_state: "uncertain", text: "NOT SETTLED" }],
  };
  await assert.rejects(f.client.researchRuns.synthesize(id, data, options), /research_not_ready/);
  assert.equal(f.calls.length, 10);
  await f.client.researchRuns.synthesize(id, { ...data, allow_partial: true }, options);
  assert.equal(JSON.parse(JSON.parse(f.calls[12].body).input).evidence.length, 1);
  assert.ok(!f.calls[12].body.includes("NOT SETTLED"));
});

test("Realtime SDK binds native text or audio to exact quotes and stable retry keys", async () => {
  const f = fixture();
  const body = {
    model: "kova-realtime",
    audio: Buffer.alloc(120000).toString("base64"),
    output_modality: "audio",
    max_output_tokens: 64,
  };
  await assert.rejects(f.client.realtime.create(body, {}), /budget_required/);
  assert.equal(f.calls.length, 0);
  await f.client.realtime.create(body, options);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "realtime", input: body });
  assert.deepEqual(JSON.parse(f.calls[1].body), body);
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/realtime");
});

test("native audio translation binds exact recording and language to dedicated quote", async () => {
  const f = fixture();
  const input = {
    model: "kova-translate",
    audio: Buffer.alloc(96000).toString("base64"),
    target_language: "es",
  };
  await assert.rejects(f.client.audio.translations.native(input, {}), /budget_required/);
  assert.equal(f.calls.length, 0);
  await f.client.audio.translations.native(input, options);
  assert.deepEqual(JSON.parse(f.calls[0].body), { operation: "audio/translations", input });
  assert.equal(f.calls[1].url, "https://kovagpt.com/api/v1/audio/translations");
  assert.deepEqual(JSON.parse(f.calls[1].body), input);
});
