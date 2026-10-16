import test from "node:test";
import assert from "node:assert/strict";
import { readGraphText } from "../../src/integrations/launch-file-content.server.mjs";
const metadata = {
  size: 5,
  eTag: "rev",
  file: { mimeType: "text/plain" },
  "@microsoft.graph.downloadUrl": "https://tenant.sharepoint.com/download",
};
function deadline(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("test_deadline_exceeded")), 150);
    }),
  ]).finally(() => clearTimeout(timer));
}
test("rejected HTTP bodies never await a stalled cancellation", async () => {
  for (const variant of [206, 200]) {
    const response = new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), {
      status: variant,
      headers: variant === 200 ? { "content-range": "bytes 0-1/5" } : {},
    });
    await assert.rejects(
      deadline(readGraphText(metadata, { fetchImpl: async () => response })),
      /file_content_unavailable/,
    );
  }
});
test("caller abort rejects a stalled stream even when cancellation never settles", async () => {
  const controller = new AbortController();
  const promise = readGraphText(metadata, {
    signal: controller.signal,
    fetchImpl: async () =>
      new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })),
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(deadline(promise), /request_aborted/);
});
test("adapter deadline rejects a stalled stream without waiting on cancel", async () => {
  const original = AbortSignal.timeout;
  let configured;
  AbortSignal.timeout = (ms) => {
    configured = ms;
    return original(5);
  };
  try {
    await assert.rejects(
      deadline(
        readGraphText(metadata, {
          fetchImpl: async () =>
            new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })),
        }),
      ),
      /file_content_unavailable/,
    );
    assert.equal(configured, 15000);
  } finally {
    AbortSignal.timeout = original;
  }
});
