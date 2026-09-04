import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoundedProviderSseStream,
  createBoundedProviderStream,
  ProviderResponseError,
  readProviderBytes,
  readProviderJsonObject,
  readProviderText,
} from "../../src/lib/provider-response.server.mjs";

const SSE_HEADERS = { "Content-Type": "text/event-stream; charset=utf-8" };

test("bounded provider readers preserve exact bytes, text, and JSON objects", async () => {
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        controller.enqueue(new TextEncoder().encode("true}"));
        controller.close();
      },
    }),
    { headers: { "Content-Length": "11" } },
  );
  assert.deepEqual(await readProviderJsonObject(source, 11), { ok: true });
  assert.equal(await readProviderText(new Response("hello"), 5), "hello");
  assert.deepEqual(
    await readProviderBytes(new Response(new Uint8Array([0, 1, 255])), 3),
    new Uint8Array([0, 1, 255]),
  );
});

test("bounded provider readers reject invalid declarations and cancel unread bodies", async () => {
  let cancellations = 0;
  const source = (length) =>
    new Response(
      new ReadableStream({
        pull() {},
        cancel() {
          cancellations += 1;
        },
      }),
      { headers: { "Content-Length": length } },
    );

  await assert.rejects(readProviderBytes(source("01"), 8), (error) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "invalid_provider_content_length");
    return true;
  });
  await assert.rejects(readProviderBytes(source("9"), 8), (error) => {
    assert.ok(error instanceof ProviderResponseError);
    assert.equal(error.code, "provider_response_too_large");
    return true;
  });
  assert.equal(cancellations, 2);
});

test("bounded provider readers reject streamed overflow, invalid UTF-8, and non-object JSON", async () => {
  let cancelled = false;
  const overflow = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readProviderBytes(overflow, 8), (error) => {
    assert.equal(error.code, "provider_response_too_large");
    return true;
  });
  assert.equal(cancelled, true);

  await assert.rejects(readProviderText(new Response(new Uint8Array([0xc3, 0x28])), 8), (error) => {
    assert.equal(error.code, "invalid_provider_utf8");
    return true;
  });
  for (const value of ["[]", "null", '"text"', "{"]) {
    await assert.rejects(readProviderJsonObject(new Response(value), 32), ProviderResponseError);
  }
});

test("bounded provider readers and streams reject truncated declared bodies", async () => {
  const truncated = () => new Response("abc", { headers: { "Content-Length": "4" } });
  await assert.rejects(readProviderBytes(truncated(), 4), (error) => {
    assert.equal(error.code, "provider_response_truncated");
    return true;
  });
  const bounded = await createBoundedProviderStream(truncated(), 4);
  await assert.rejects(new Response(bounded).text(), (error) => {
    assert.equal(error.code, "provider_response_truncated");
    return true;
  });
});

test("bounded provider streams pass exact limits and cancel overflow", async () => {
  const exact = await createBoundedProviderStream(new Response("abcd"), 4);
  assert.equal(await new Response(exact).text(), "abcd");

  let cancelled = false;
  const overflowSource = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcd"));
        controller.enqueue(new TextEncoder().encode("e"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const overflow = await createBoundedProviderStream(overflowSource, 4);
  await assert.rejects(new Response(overflow).text(), (error) => {
    assert.equal(error.code, "provider_response_too_large");
    return true;
  });
  assert.equal(cancelled, true);
});

test("bounded provider streams cancel promptly when the caller aborts", async () => {
  let cancelled = false;
  const source = new Response(
    new ReadableStream({
      pull() {},
      cancel() {
        cancelled = true;
      },
    }),
  );
  const abort = new AbortController();
  const bounded = await createBoundedProviderStream(source, 8, abort.signal);
  const read = new Response(bounded).text();
  abort.abort();
  await assert.rejects(read, (error) => {
    assert.equal(error.code, "request_aborted");
    return true;
  });
  assert.equal(cancelled, true);
});

test("bounded provider SSE preserves complete lines across chunk and UTF-8 boundaries", async () => {
  const bytes = new TextEncoder().encode('data: {"text":"Kóva"}\n\ndata: [DONE]\n\n');
  const accentIndex = bytes.indexOf(0xc3);
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, accentIndex + 1));
        controller.enqueue(bytes.subarray(accentIndex + 1, accentIndex + 3));
        controller.enqueue(bytes.subarray(accentIndex + 3));
        controller.close();
      },
    }),
    { headers: SSE_HEADERS },
  );
  const bounded = await createBoundedProviderSseStream(source, bytes.byteLength);
  assert.equal(await new Response(bounded).text(), new TextDecoder().decode(bytes));
});

test("bounded provider SSE preserves a typed provider timeout", async () => {
  const timeout = Object.assign(new Error("provider_timeout"), {
    name: "AbortError",
    code: "provider_timeout",
  });
  const source = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
        controller.error(timeout);
      },
    }),
    { headers: SSE_HEADERS },
  );
  const bounded = await createBoundedProviderSseStream(source, 64);
  await assert.rejects(new Response(bounded).text(), (error) => {
    assert.equal(error, timeout);
    assert.equal(error.code, "provider_timeout");
    return true;
  });
});

test("bounded provider SSE rejects content type, missing terminator, and overflow at a clean line", async () => {
  let invalidTypeCancelled = false;
  const invalidType = new Response(
    new ReadableStream({
      pull() {},
      cancel() {
        invalidTypeCancelled = true;
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  await assert.rejects(createBoundedProviderSseStream(invalidType, 32), (error) => {
    assert.equal(error.code, "invalid_provider_content_type");
    return true;
  });
  assert.equal(invalidTypeCancelled, true);

  const missingDone = await createBoundedProviderSseStream(
    new Response('data: {"ok":true}\n\n', { headers: SSE_HEADERS }),
    64,
  );
  const missingReader = missingDone.getReader();
  assert.equal(new TextDecoder().decode((await missingReader.read()).value), 'data: {"ok":true}\n');
  assert.equal(new TextDecoder().decode((await missingReader.read()).value), "\n");
  await assert.rejects(missingReader.read(), (error) => {
    assert.equal(error.code, "provider_sse_missing_done");
    return true;
  });

  let overflowCancelled = false;
  const overflow = await createBoundedProviderSseStream(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n'));
          controller.enqueue(new TextEncoder().encode("data: runaway"));
        },
        cancel() {
          overflowCancelled = true;
        },
      }),
      { headers: SSE_HEADERS },
    ),
    24,
  );
  const overflowReader = overflow.getReader();
  assert.equal(
    new TextDecoder().decode((await overflowReader.read()).value),
    'data: {"ok":true}\n',
  );
  await assert.rejects(overflowReader.read(), (error) => {
    assert.equal(error.code, "provider_response_too_large");
    return true;
  });
  assert.equal(overflowCancelled, true);
});

test("SSE wrapper returns before the upstream stream completes", async () => {
  const encoder = new TextEncoder();
  let release;

  const upstream = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));

        release = () => {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        };
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    },
  );

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SSE wrapper blocked waiting for stream completion")), 250),
  );

  const wrapped = await Promise.race([createBoundedProviderSseStream(upstream, 4096), timeout]);

  assert.ok(wrapped instanceof ReadableStream);

  const reader = wrapped.getReader();
  const first = await reader.read();

  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /data:/);

  release();

  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }

  assert.match(text, /\[DONE\]/);
});
