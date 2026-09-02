import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createManagedIdentityTokenFetcher,
  createRequestDeadline,
  fetchWithDeadline,
} from "../../src/lib/ai/provider-transport.server.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertProviderTimeout(error) {
  assert.equal(error?.name, "AbortError");
  assert.equal(error?.code, "provider_timeout");
  return true;
}

test("stalled managed-identity authentication is bounded and logs no credentials", async () => {
  const secrets = {
    IDENTITY_ENDPOINT: "http://127.0.0.1:41742/msi/token",
    IDENTITY_HEADER: "identity-header-secret-value",
    AZURE_CLIENT_ID: "83736eec-abe1-4748-beaa-8e46a271c547",
  };
  const logs = [];
  let requestedUrl = "";
  let observedHeader = "";

  const fetchToken = createManagedIdentityTokenFetcher({
    env: (name) => secrets[name],
    resource: "https://cognitiveservices.azure.com",
    getTimeoutMs: () => 30,
    fetchImpl: (input, init) => {
      requestedUrl = String(input);
      observedHeader = new Headers(init?.headers).get("x-identity-header") ?? "";
      return new Promise(() => {});
    },
    log: (level, event, details) => logs.push({ level, event, details }),
  });

  const startedAt = Date.now();
  await assert.rejects(fetchToken(), assertProviderTimeout);
  assert.ok(Date.now() - startedAt < 500, "identity timeout must finish promptly");

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("resource"), "https://cognitiveservices.azure.com");
  assert.equal(url.searchParams.get("api-version"), "2019-08-01");
  assert.equal(url.searchParams.get("client_id"), secrets.AZURE_CLIENT_ID);
  assert.equal(observedHeader, secrets.IDENTITY_HEADER);
  assert.ok(logs.some((entry) => entry.event === "managed_identity.token.start"));
  assert.ok(logs.some((entry) => entry.event === "managed_identity.token.timeout"));

  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, new RegExp(secrets.IDENTITY_HEADER, "u"));
  assert.doesNotMatch(serializedLogs, new RegExp(secrets.IDENTITY_ENDPOINT, "u"));
  assert.doesNotMatch(serializedLogs, new RegExp(secrets.AZURE_CLIENT_ID, "u"));
});

test("a provider call that never returns headers is bounded even if fetch ignores AbortSignal", async () => {
  const deadline = createRequestDeadline(undefined, 30, "provider_request");
  const startedAt = Date.now();

  await assert.rejects(
    fetchWithDeadline(
      () => new Promise(() => {}),
      "https://example.invalid/openai/v1/responses",
      { method: "POST" },
      deadline,
    ),
    assertProviderTimeout,
  );
  assert.ok(Date.now() - startedAt < 500, "provider header timeout must finish promptly");
});

test("a response that arrives after the deadline is cancelled without being exposed", async () => {
  let resolveFetch;
  let cancelled = false;
  const deadline = createRequestDeadline(undefined, 25, "provider_request");
  const pending = fetchWithDeadline(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    "https://example.invalid/openai/v1/responses",
    { method: "POST" },
    deadline,
  );

  await assert.rejects(pending, assertProviderTimeout);
  resolveFetch(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await sleep(0);
  assert.equal(cancelled, true);
});

test("a parent-signal abort before headers is classified as aborted, not failed or timed out", async () => {
  const parent = new AbortController();
  const outcomes = [];
  const deadline = createRequestDeadline(parent.signal, 500, "provider_request");
  const pending = fetchWithDeadline(
    () => new Promise(() => {}),
    "https://example.invalid/openai/v1/responses",
    { method: "POST" },
    deadline,
    (outcome) => outcomes.push(outcome),
  );
  const reason = new Error("client_disconnected");
  reason.name = "AbortError";
  parent.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(deadline.didParentAbort(), true);
  assert.equal(deadline.didTimeout(), false);
  assert.deepEqual(
    outcomes.map((value) => value.outcome),
    ["aborted"],
  );
});

test("rejected provider responses preserve status and terminate their deadline on cancellation", async () => {
  const outcomes = [];
  const deadline = createRequestDeadline(undefined, 500, "provider_request");
  const response = await fetchWithDeadline(
    async () =>
      new Response('{"error":"busy"}', {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    "https://example.invalid/openai/v1/responses",
    { method: "POST" },
    deadline,
    (outcome) => outcomes.push(outcome),
  );

  assert.equal(response.status, 429);
  await response.body?.cancel("provider_rejected");
  await sleep(0);
  assert.deepEqual(
    outcomes.map((value) => value.outcome),
    ["cancelled"],
  );
});

test("wrapped response cancellation does not await an unbounded source cancel algorithm", async () => {
  const deadline = createRequestDeadline(undefined, 500, "provider_request");
  const response = await fetchWithDeadline(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return new Promise(() => {});
          },
        }),
      ),
    "https://example.invalid/openai/v1/responses",
    { method: "POST" },
    deadline,
  );

  await Promise.race([
    response.body.cancel("provider_rejected"),
    sleep(100).then(() => {
      throw new Error("wrapped cancellation did not settle");
    }),
  ]);
});

test("a provider stream that starts and then stalls terminates with provider_timeout", async () => {
  let cancelled = false;
  const deadline = createRequestDeadline(undefined, 40, "provider_request");
  const encoder = new TextEncoder();
  const response = await fetchWithDeadline(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta"}\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    "https://example.invalid/openai/v1/responses",
    { method: "POST" },
    deadline,
  );

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /response\.output_text\.delta/u);
  await assert.rejects(reader.read(), assertProviderTimeout);
  await sleep(0);
  assert.equal(cancelled, true);
});

test("provider source covers authentication, connection, and full-body deadlines", () => {
  const provider = readFileSync("src/lib/ai/provider.server.ts", "utf8");
  const transport = readFileSync("src/lib/ai/provider-transport.server.mjs", "utf8");

  assert.match(provider, /createRequestDeadline\([\s\S]{0,180}config\.timeoutMs/u);
  assert.match(provider, /await providerHeaders\(deadline\.signal\)/u);
  assert.match(provider, /fetchWithDeadline\(/u);
  assert.match(provider, /getTimeoutMs:\s*\(\) => DEFAULT_MANAGED_IDENTITY_TIMEOUT_MS/u);
  assert.match(transport, /wrapResponseBodyWithDeadline/u);
  assert.match(transport, /didParentAbort/u);
  assert.match(transport, /lateResponse[\s\S]{0,220}cancelBodyWithoutWaiting/u);
  assert.match(transport, /waitForPromiseWithSignal\([\s\S]{0,220}fetchPromise/u);
  assert.match(provider, /bufferSuccessfulProviderResponse/u);
  assert.match(provider, /providerErrorFromResponse[\s\S]{0,220}void response\.body\?\.cancel/u);
  assert.match(provider, /provider\.request\.cancelled/u);
  assert.doesNotMatch(provider, /function mergeSignals/u);
});

test("Azure v1 Responses endpoint and deployment-name routing remain exact", () => {
  const provider = readFileSync("src/lib/ai/provider.server.ts", "utf8");
  const catalog = readFileSync("src/lib/ai/model-catalog.server.ts", "utf8");

  assert.match(provider, /return `\$\{endpoint\.origin\}\/openai\/v1`/u);
  assert.match(provider, /providerFetch\(\s*"\/responses"/u);
  assert.match(provider, /AZURE_OPENAI_DEPLOYMENT_CHAT/u);
  assert.match(provider, /AZURE_OPENAI_DEPLOYMENT_THINKING/u);
  assert.match(provider, /AZURE_OPENAI_DEPLOYMENT_DEEP/u);
  assert.match(provider, /AZURE_OPENAI_DEPLOYMENT_EMBEDDING/u);
  assert.match(catalog, /instant:[\s\S]{0,180}fallback: "gpt-5\.6-luna"/u);
  assert.match(catalog, /thinking:[\s\S]{0,180}fallback: "gpt-5\.6-terra"/u);
  assert.match(catalog, /deep:[\s\S]{0,180}fallback: "gpt-5\.6-sol"/u);
});

test("chat failures complete with a user-visible error and SSE terminator", () => {
  const chat = readFileSync("src/routes/api/chat.ts", "utf8");
  const client = readFileSync("src/routes/index.tsx", "utf8");

  assert.match(chat, /isProviderTimeoutError\(error\)/u);
  assert.match(chat, /KovaGPT took too long to respond/u);
  assert.match(chat, /providerTimedOut \? 504 : 502/u);
  assert.match(chat, /sseChunk\(providerFailureMessage\)[\s\S]{0,300}sseDone\(\)/u);
  assert.match(chat, /request\.signal\.aborted[\s\S]{0,220}status: 499/u);
  assert.match(
    chat,
    /final provider request failed[\s\S]{0,700}AI service is temporarily unavailable/u,
  );
  assert.match(client, /if \(!resp\.ok \|\| !resp\.body\)[\s\S]{0,500}errJson\.error/u);
});
