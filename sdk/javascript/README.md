# KovaGPT JavaScript SDK

A dependency-free, server-side ESM client with TypeScript declarations for the versioned KovaGPT API. Node 22 or newer is required. This repository package is private until the operator approves registry publication. Use a local package/path import during development. Never include a developer key in a browser bundle.

```javascript
import { KovaGPT, responseEvents } from "./sdk/javascript/index.mjs";

const client = new KovaGPT({ apiKey: process.env.KOVA_API_KEY });
const models = await client.models(); // Only currently approved, scoped public models.
const response = await client.responses.create(
  {
    model: process.env.KOVA_PUBLIC_MODEL,
    input: "Explain this data.",
    max_output_tokens: 200,
    stream: true,
  },
  {
    currency: process.env.KOVA_BUDGET_CURRENCY,
    maximumCharge: Number(process.env.KOVA_REQUEST_BUDGET_MINOR),
    idempotencyKey: crypto.randomUUID(),
  },
);
for await (const event of responseEvents(response)) {
  if (event.type === "response.output_text.delta") process.stdout.write(event.delta);
}
```

The caller explicitly supplies a budget in **minor currency units**, its currency and a stable operation idempotency key. `run`/`responses.create` obtains a signed quote and only dispatches when its current maximum fits that budget. `quote` and `execute` are separate when an application must display or approve the exact quote first. Execution rejects stale or altered quotes at the server. Images and embeddings use the same boundary through `images.generate` and `embeddings.create`.

There are **no automatic generation retries**. An ambiguous transport failure sets `KovaError.requestMayHaveStarted`; retry only the same logical operation with its original idempotency key. Do not use a fresh key to bypass pending reconciliation. Cancellation after dispatch may still incur verified provider cost; it does not promise a refund. An AbortSignal or the configured timeout bounds transport. Breaking from `responseEvents` cancels and releases the reader. A stream lacking an explicit terminal event is rejected, and `response.incomplete`/`response.failed` remain visible events. Consume JSON bodies or cancel unused responses so the server can finalize metering.

Function tools are declarative schemas; the SDK does not execute model-suggested functions or follow returned URLs. The application validates and authorizes arguments, performs its own tool action, then sends the original user/history items, returned function-call and encrypted reasoning items, and the corresponding `function_call_output`. Each follow-up is a new explicit, separately quoted model operation. Do not accidentally reuse the previous round's idempotency key. Provider storage stays disabled.

Responses also accept `text.format` with `type: "json_schema"`, a name, `strict: true`, and a bounded strict schema. Supported schema types are object, array, string, number, integer, boolean and null; nullable types, enums, nested anyOf and root-local `$defs` references are supported. Every object requires `additionalProperties: false` and all properties in `required`. Remote schema references and arbitrary schema keywords are rejected. Approved models may accept explicit reasoning effort, a bounded low-detail inline PNG, or a single low-context native web search with `max_tool_calls` 1–3 and `stream: false`. Search requires the provider and pricing gate; check the model catalog. Remote attachments and other hosted tools are not supported. KovaGPT private text attachments use `files.upload/list/retrieve/delete` and explicit Responses `file_ids`; see [private files](../../docs/developer-private-files.md). A file upload has its own stable retry key and each later model use has its own explicitly accepted budget. Refusal or incomplete model output must be handled before trusting/parsing the expected schema; this SDK does not mislabel those outcomes as valid structured output.

API and billing flags remain off until the operator supplies verified provider pricing, funds, infrastructure and activation. No price, model contract or funded key is bundled in the SDK.

References: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Model discovery, request history and moderation

`client.models({ id: "kova-fast" })` filters the scoped model catalog to one public alias and returns all visible capability entries for that alias. Unknown or unauthorized aliases return the same 404. Use the model IDs and capability flags actually returned by the enabled API.

`client.usage.list({ limit: 25, offset: 0 })` lists the authenticating key's usage; `client.usage.retrieve(requestId)` reads one record. Both use GET, do not invoke providers, and require no inference quote. They expose sanitized usage and settlement status, not private prompts, credentials or provider receipts. A 404 does not distinguish another key's request from a missing one.

`client.moderations.create({ model, input: "Text to classify" }, budget)` uses the same signed quote, explicit budget and idempotency contract as inference. The moderation scope, runtime gate and approved model contract are required. Only bounded single-text input is currently supported; this SDK does not assert live activation.

`client.chat.completions.create` supports bounded text-message history, explicit `max_completion_tokens` or `max_tokens`, optional reasoning effort and streaming. `client.search` requests bounded gated hosted search using `query`, `max_output_tokens` and `max_tool_calls` (1–3). These paths use the same explicit quote, budget and idempotency checks. Search returns the native Responses envelope; Chat Completions uses a separate text-only compatibility envelope. Use `chatCompletionEvents` for Chat Completions SSE and `responseEvents` for native Responses SSE.

`client.files.search({ query, file_ids, limit })` performs scoped lexical retrieval. `client.vectorStores` provides create, upsert, search, list, retrieve, listEntries, retrieveEntry, delete and deleteEntry for project-owned stores. Creation requires an idempotency key. Vector operations use caller-supplied embeddings and never implicitly invoke a model; use a separately quoted embeddings request when needed. Both resource capabilities require operator activation; the vector schema requires migration replay.

## Verify webhook deliveries

Use the server-side `verifyWebhookSignature({ secret, eventId, timestamp, body, signature })` export with your endpoint's signing secret, the original raw HTTP body (UTF-8 string or bytes), and the `X-Kova-Webhook-Id`, `X-Kova-Webhook-Timestamp` and `X-Kova-Webhook-Signature` headers. Reject false results before parsing JSON. The helper checks the HMAC and five-minute timestamp window. Persist processed event IDs atomically to prevent duplicate side effects; legitimate delivery retries are possible within the window. Never reserialize JSON before verification.

### Multipart file upload

The same `POST /api/v1/files` route also accepts `multipart/form-data` containing exactly one `file` part. Send the scoped bearer key and a stable `Idempotency-Key` header. Supported UTF-8 text formats are TXT, Markdown, CSV and JSON, with the corresponding MIME type and a maximum of 32 KiB of file content. The multipart envelope is limited to 64 KiB. The existing file activation flag, project ownership, storage quotas and retention still apply. This is a single-request upload, not resumable chunk assembly.
