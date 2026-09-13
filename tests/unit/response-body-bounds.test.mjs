import assert from "node:assert/strict";
import test from "node:test";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";

function response(chunks, headers = {}, onCancel = () => {}) {
  return {
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
      cancel: onCancel,
    }),
  };
}

test("remote body checks declared and actual decoded byte ceilings before buffering", async () => {
  assert.deepEqual(
    await readResponseBytesBounded(
      response([new Uint8Array([1, 2]), new Uint8Array([3])], { "content-length": "3" }),
      3,
    ),
    new Uint8Array([1, 2, 3]),
  );
  for (const headers of [
    {},
    { "content-length": "1" },
    { "content-encoding": "gzip", "content-length": "1" },
  ]) {
    await assert.rejects(readResponseBytesBounded(response([new Uint8Array(4)], headers), 3), {
      code: "response_too_large",
    });
  }
  await assert.rejects(readResponseBytesBounded(response([], { "content-length": "4" }), 3), {
    code: "response_too_large",
  });
  await assert.rejects(readResponseBytesBounded(response([], { "content-length": "-1" }), 3), {
    code: "invalid_response_length",
  });
});

test("identity length mismatch fails while compressed wire length is not compared to decoded length", async () => {
  await assert.rejects(
    readResponseBytesBounded(response([new Uint8Array(2)], { "content-length": "3" }), 3),
    { code: "response_length_mismatch" },
  );
  assert.equal(
    (
      await readResponseBytesBounded(
        response([new Uint8Array(3)], { "content-length": "1", "content-encoding": "gzip" }),
        3,
      )
    ).length,
    3,
  );
});

test("stalled reader and stalled cancel cannot defeat the response deadline", async () => {
  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    readResponseBytesBounded({ headers: new Headers(), body }, 3, { timeoutMs: 15 }),
    { code: "response_timeout" },
  );
  assert.equal(canceled, true);
});

test("an abort cancels a pending response read and returns its original reason", async () => {
  const controller = new AbortController();
  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
    },
  });
  const result = readResponseBytesBounded({ headers: new Headers(), body }, 3, {
    signal: controller.signal,
  });
  const error = new Error("scope ended");
  controller.abort(error);
  await assert.rejects(result, (actual) => actual === error);
  assert.equal(canceled, true);
});
