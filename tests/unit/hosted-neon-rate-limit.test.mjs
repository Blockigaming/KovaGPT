import assert from "node:assert/strict";
import test from "node:test";
import { requestKovaHostedChat } from "../../src/lib/ai/kova-hosted-inference.server.mjs";
import { requestHostedEffort } from "../../src/lib/ai/hosted-effort.server.mjs";

const request = {
  model: "kova-neon-4.6",
  stream: false,
  messages: [{ role: "user", content: "19 times 23" }],
  max_tokens: 100,
};
const token = "synthetic-neon-retry-test-key";
const limited = (retryAfter = "0") =>
  new Response("rate limited", {
    status: 429,
    headers: { "Retry-After": retryAfter },
  });

test("a rejected Neon call retries the identical bounded request after revalidation", async () => {
  const calls = [];
  const rejected = limited();
  const accepted = Response.json({ answer: "437" });
  let fences = 0;
  const response = await requestKovaHostedChat({
    request,
    token,
    beforeRetry: async () => {
      fences++;
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? rejected : accepted;
    },
  });
  assert.equal(response, accepted);
  assert.equal(calls.length, 2);
  assert.equal(fences, 1);
  assert.equal(rejected.body.locked, false);
  assert.equal(rejected.bodyUsed, true);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].options, calls[1].options);
  assert.equal(JSON.parse(calls[1].options.body).model, "meta-llama/llama-4-maverick");
});

test("persistent Neon rate limits stop after four attempts and conceal upstream details", async () => {
  let calls = 0,
    fences = 0;
  await assert.rejects(
    requestKovaHostedChat({
      request,
      token,
      beforeRetry: async () => {
        fences++;
      },
      fetchImpl: async () => {
        calls++;
        return limited();
      },
    }),
    (error) => error.message === "kova_hosted_inference_unavailable" && error.status === 429,
  );
  assert.equal(calls, 4);
  assert.equal(fences, 3);
});

test("cancellation during provider backoff prevents another attempt or revalidation", async () => {
  const controller = new AbortController();
  let calls = 0,
    fences = 0;
  const timer = setTimeout(() => controller.abort(new Error("owner_cancelled")), 15);
  try {
    await assert.rejects(
      requestKovaHostedChat({
        request,
        token,
        signal: controller.signal,
        beforeRetry: async () => {
          fences++;
        },
        fetchImpl: async () => {
          calls++;
          return limited("1");
        },
      }),
      /owner_cancelled/,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.equal(calls, 1);
  assert.equal(fences, 0);
});

test("a caller revalidation failure prevents a provider retry", async () => {
  let calls = 0;
  await assert.rejects(
    requestKovaHostedChat({
      request,
      token,
      beforeRetry: async () => {
        throw new Error("reservation_expired");
      },
      fetchImpl: async () => {
        calls++;
        return limited();
      },
    }),
    /reservation_expired/,
  );
  assert.equal(calls, 1);
});

test("a Retry-After longer than the request deadline fails without an early retry", async () => {
  for (const header of ["60", new Date(Date.now() + 120_000).toUTCString()]) {
    let calls = 0;
    await assert.rejects(
      requestKovaHostedChat({
        request,
        token,
        fetchImpl: async () => {
          calls++;
          return limited(header);
        },
      }),
      (error) => error.status === 429,
    );
    assert.equal(calls, 1);
  }
});

test("other foundations, ambiguous failures and accepted streams are never replayed", async () => {
  for (const [model, status] of [
    ["kova-argon-4.6", 429],
    ["kova-xenon-5", 429],
    ["kova-neon-4.6", 503],
    ["kova-neon-4.6", 401],
  ]) {
    let calls = 0;
    await assert.rejects(
      requestKovaHostedChat({
        request: { ...request, model },
        token,
        fetchImpl: async () => {
          calls++;
          return new Response("unavailable", { status });
        },
      }),
      /kova_hosted_inference_unavailable/,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const accepted = new Response('data: {"error":"provider stream interrupted"}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
  assert.equal(
    await requestKovaHostedChat({
      request: { ...request, stream: true },
      token,
      fetchImpl: async () => {
        calls++;
        return accepted;
      },
    }),
    accepted,
  );
  assert.equal(calls, 1);
});

test("review backoff preserves one usage receipt and rechecks the original generation fence", async () => {
  let calls = 0,
    fences = 0;
  const usage = [];
  const response = await requestHostedEffort({
    request: { ...request, stream: true },
    mode: "thinking",
    token,
    beforeSend: async () => {
      fences++;
    },
    onUsage: (value) => usage.push(value),
    fetchImpl: async (_url, init) => {
      calls++;
      if (calls === 1) return limited();
      const body = JSON.parse(init.body);
      return body.stream
        ? new Response('data: {"choices":[{"delta":{"content":"437"}}]}\n\ndata: [DONE]\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          })
        : Response.json({
            model: body.model,
            choices: [{ message: { content: "437" } }],
            usage: { prompt_tokens: 80, completion_tokens: 2 },
          });
    },
  });
  assert.match(await response.text(), /437/);
  assert.equal(calls, 3);
  assert.equal(fences, 3);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].input, 80);
});
