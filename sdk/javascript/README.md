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

Responses also accept `text.format` with `type: "json_schema"`, a name, `strict: true`, and a bounded strict schema. Supported schema types are object, array, string, number, integer, boolean and null; nullable types, enums, nested anyOf and root-local `$defs` references are supported. Every object requires `additionalProperties: false` and all properties in `required`. Remote references, arbitrary schema keywords, hosted tools and remote/multimodal attachments are rejected. KovaGPT private text attachments use `files.upload/list/retrieve/delete` and explicit Responses `file_ids`; see [private files](../../docs/developer-private-files.md). A file upload has its own stable retry key and each later model use has its own explicitly accepted budget. Refusal or incomplete model output must be handled before trusting/parsing the expected schema; this SDK does not mislabel those outcomes as valid structured output.

API and billing flags remain off until the operator supplies verified provider pricing, funds, infrastructure and activation. No price, model contract or funded key is bundled in the SDK.

References: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
