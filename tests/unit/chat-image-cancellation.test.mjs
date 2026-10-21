import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

function fixture() {
  const source = readFileSync("src/routes/api/chat.ts", "utf8");
  const start = source.indexOf("async function handleImageRequest(");
  const end = source.indexOf("\nexport const Route", start);
  assert.ok(start > -1 && end > start);
  const body = stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });
  const calls = [],
    logs = [];
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const context = vm.createContext({
    Response,
    ReadableStream,
    TextEncoder,
    AbortController,
    DOMException,
    imageGenerations: (body, init) => {
      calls.push({ body, init });
      return response;
    },
    imageModel: () => "synthetic-retained-image-model",
    MAX_IMAGE_PROVIDER_RESPONSE_BYTES: 1024,
    readProviderJsonObject: (upstream) => upstream.json(),
    logSafeFailure: (...args) => logs.push(args),
    sseEvent: (event) => "data: " + JSON.stringify(event) + "\n\n",
    sseChunk: (content) =>
      "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n",
    sseDone: () => "data: [DONE]\n\n",
  });
  vm.runInContext(body + "\nglobalThis.handle = handleImageRequest;", context);
  return { handle: context.handle, calls, logs, release };
}
const image = () => Response.json({ data: [{ b64_json: "c3ludGhldGlj" }] });

test("chat image generation forwards request cancellation and discards a late provider image", async () => {
  const f = fixture();
  const controller = new AbortController();
  const response = await f.handle("Synthetic image", {}, controller.signal);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /image_pending/);
  controller.abort(new DOMException("Synthetic navigation", "AbortError"));
  f.release(image());
  const remaining = await new Response(
    new ReadableStream({
      async pull(stream) {
        const result = await reader.read();
        if (result.done) stream.close();
        else stream.enqueue(result.value);
      },
    }),
  ).text();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init?.signal?.aborted, true);
  assert.doesNotMatch(remaining, /generated image|Sorry|c3ludGhldGlj/);
  assert.equal(f.logs.length, 0);
});

test("canceling the image response stream aborts its provider work without waiting for image completion", async () => {
  const f = fixture();
  const response = await f.handle("Synthetic image", {}, new AbortController().signal);
  const reader = response.body.getReader();
  await reader.read();
  const canceled = reader.cancel("Synthetic Stop");
  let timer;
  try {
    await Promise.race([
      canceled,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("image_cancel_waited_for_provider")), 100);
      }),
    ]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init?.signal?.aborted, true);
    assert.equal((await reader.read()).done, true);
  } finally {
    clearTimeout(timer);
    f.release(image());
  }
});

test("already canceled chat image requests cannot generate or emit a pending image", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  const response = await f.handle("Synthetic image", {}, controller.signal);
  f.release(image());
  assert.equal(await response.text(), "");
  assert.equal(f.calls.length, 0);
});

test("normal chat image response retains pending, image and terminal frames", async () => {
  const f = fixture();
  const response = await f.handle("Synthetic image", {}, new AbortController().signal);
  f.release(image());
  const body = await response.text();
  assert.match(body, /image_pending/);
  assert.match(body, /generated image/);
  assert.match(body, /\[DONE\]/);
  assert.equal(f.calls[0].body.model, "synthetic-retained-image-model");
  assert.equal(f.logs.length, 0);
});
