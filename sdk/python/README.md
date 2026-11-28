# KovaGPT Python SDK

Repository-local server SDK for Python 3.10 or newer. No runtime dependencies, no automatic retries, and no registry publication. Run its offline tests with:

```sh
cd sdk/python
python -m unittest -v
```

Use a local source import or install this directory in a controlled development environment. Supply credentials only from your server secret manager. A model and enabled, funded project must be obtained from the real platform.

```python
import os
import uuid
from kovagpt import Client, response_events

client = Client(os.environ["KOVA_API_KEY"])
catalog = client.models()
with client.responses(
    {
        "model": os.environ["KOVA_PUBLIC_MODEL"],
        "input": "Summarize this text.",
        "max_output_tokens": 200,
        "stream": True,
    },
    currency=os.environ["KOVA_BUDGET_CURRENCY"],
    maximum_charge=float(os.environ["KOVA_REQUEST_BUDGET_MINOR"]),
    idempotency_key=str(uuid.uuid4()),
) as response:
    for event in response_events(response):
        if event.get("type") == "response.output_text.delta":
            print(event["delta"], end="")
```

The client supports scoped model discovery, usage list and retrieval, private text-file upload/list/retrieve/delete, Responses, images and gated image editing, embeddings, and gated text moderation. All inference operations use an explicit caller budget in minor currency units and an identical signed quote. Hosted tools and reasoning options are passed as ordinary validated Responses fields. The server determines real capability availability and pricing.

`quote` and `execute` can be used separately for an explicit confirmation screen. Always use the original idempotency key for retries of the same operation. An uncertain dispatch sets `KovaError.request_may_have_started`; inspect the real usage history before retrying. Never treat cancellation as proof of a refund.

The HTTPS transport verifies certificates, does not follow redirects, and applies a socket I/O timeout rather than a total wall-clock streaming deadline. Use a trusted service origin. Read JSON or use the response as a context manager to close its connection. Streaming requires an explicit terminal event; incomplete or failed events are not treated as successful output. No API key, price, provider or live account is bundled.

For a bounded text-only Chat Completions request use `client.chat_completions(data, **budget)`. The `client.search(data, **budget)` alias uses the gated native search meter and returns the Responses envelope, including native source annotations. The same quote and retry rules apply. Use `chat_completion_events` for Chat Completions SSE and `response_events` for native Responses SSE.

Use `file_search`, `vector_create`, `vector_upsert`, `vector_search`, `vector_list`, `vector_retrieve`, `vector_entries`, `vector_entry` and `vector_delete` for scoped resource operations. Vector creation requires a stable idempotency key, and vectors are supplied by the caller. No implicit inference occurs. Runtime activation and vector migration replay are required.

## Verify webhook deliveries

Use `verify_webhook_signature(secret=secret, event_id=event_id, timestamp=timestamp, body=raw_body, signature=signature)` with your endpoint's signing secret, the original HTTP body (bytes or UTF-8 string), and the `X-Kova-Webhook-Id`, `X-Kova-Webhook-Timestamp` and `X-Kova-Webhook-Signature` headers. Reject false results before parsing JSON. The helper checks the HMAC and five-minute timestamp window. Persist processed event IDs atomically to prevent duplicate side effects; legitimate delivery retries are possible within the window. Never reserialize JSON before verification.

### Multipart file upload

Use `client.file_upload_multipart(data, idempotency_key=key)` with `data` containing `filename`, `mimeType` and `text` to send a multipart upload without manually constructing the boundary. The SDK validates the UTF-8 file and never retries automatically. The same `POST /api/v1/files` route also accepts `multipart/form-data` containing exactly one `file` part. Send the scoped bearer key and a stable `Idempotency-Key` header. Supported UTF-8 text formats are TXT, Markdown, CSV and JSON, with the corresponding MIME type and a maximum of 32 KiB of file content. The multipart envelope is limited to 64 KiB. The existing file activation flag, project ownership, storage quotas and retention still apply. This is a single-request upload, not resumable chunk assembly.

### Batch and scheduled invocations

Batch items can explicitly select `chat/completions`, `agent-turns`, `responses`, `moderations`, `embeddings`, `decisions`, `search` or `analysis`. Each item needs a quote for its exact operation and input. Direct Responses items are non-streaming requests with at most 2,048 output tokens, optional strict JSON output, and up to four client-owned function proposals; hosted execution, file references and vision are excluded. Embedding items require an explicit dimension of 1–1,024 and at most two inputs to bound stored results. Batch and automation access still requires the chat scope as well as the relevant operation scope, approved pricing, runtime activation and replay of the staged schema. Image and interactive tool operations are not batch-supported. If creation or resumption returns an uncertain acknowledgement, retrieve the original job ID before retrying; do not submit a new job ID merely because the transport failed.

### Use stored conversation history in Responses

Supply `conversation: { id, revision }` and a new string `input` to Responses. Both quote preparation and execution read the authenticated project's current conversation snapshot; a changed revision or recreated conversation invalidates the quote. The quote expires no later than the stored conversation. This uses at most 99 stored text items and does not implicitly append the request or generated response. Use the explicit conversation append endpoint with stable item IDs and expected revisions to persist new messages. The conversation schema and runtime flags must be enabled.

### Recorded audio transcription

The gated `audio/transcriptions` operation targets a reviewed alias of the current OpenAI `gpt-transcribe` model. Submit an `audio` string containing a canonical base64 PCM WAV data URI (16 kHz, mono, 16-bit, 0.1–20 seconds), plus `model`. Use the usual identical signed quote, explicit budget and stable idempotency key. The server checks the audio duration and settles using the provider's duration receipt. The endpoint requires the `audio_transcription` scope, an approved duration rate, and runtime activation. Record and submit audio only with appropriate permission. This is recorded-audio transcription, not live microphone streaming or speech generation.

Reference: https://developers.openai.com/api/docs/guides/transcription

### Background Responses

Use `POST /api/v1/response-jobs` with `operation: "create"`, a stable UUID `id`, `currency`, `maximum_charge`, `input` (a non-streaming Responses request of at most 2,048 output tokens, optionally with strict structured output or client-owned functions) and the `quote_token` returned by quoting that exact input as `responses`. Creating a job authorizes paid execution by the existing durable worker and stores the input and result for bounded retrieval. No automatic provider retries occur. A job expires after 24 hours and is eligible for cleanup seven days after expiration. List or retrieve through GET, or cancel a queued job by POSTing `{ operation: "cancel", id }`. Cancel does not interrupt a job already claimed by a worker. Retrieval reports the actual job and settlement status and exposes output only for settled completed jobs. This feature requires the staged batch migration and background Responses runtime flag.

### Async Python

`AsyncClient` offers awaitable equivalents of every public `Client` method using the same bounded HTTPS transport. It uses worker threads for blocking I/O; it does not introduce automatic retries. Use `async with await client.responses(data, **budget) as response:` and either `await response.json()` or `async for event in async_response_events(response):`. For Chat Completions use `async_chat_completion_events`. Always use the async context manager when consuming a stream partially.

`AsyncRequestCancelled` subclasses `asyncio.CancelledError`. Its `request_may_have_started` and `mutation_may_have_started` flags distinguish potentially dispatched paid work and resource mutations. Canceling during a quote cannot start subsequent inference. Canceling after dispatch does not cancel work on the server: the bounded transport finishes in its worker and closes abandoned responses. Reconcile usage or retrieve the original resource before retrying.

### Saved prompts

Use `prompt_create`, `prompt_list`, `prompt_retrieve(id, version=...)`, `prompt_update`, and `prompt_delete`. The sync and async clients accept the same definition: `name`, `description`, `prompt`. Retrieve and explicitly quote text before running inference.
