# Versioned developer ingress

The source adds `/api/v1/models`, `/api/v1/quotes`, `/api/v1/responses`, `/api/v1/images`, `/api/v1/embeddings`, a scoped bearer-key `/mcp`, and `/developers/console`. Both `KOVA_DEVELOPER_API_ENABLED` and `KOVA_DEVELOPER_BILLING_ENABLED` must be explicitly true for API or MCP execution. No activation, prices, funded accounts, credentials, provider requests or payment calls are made by this change.

`DEVELOPER_KEY_PEPPER` must be an independent secret-manager value with at least 32 characters. Credentials contain a random UUID and 256 random bits; only a domain-separated HMAC digest and six-character suffix are stored. The full credential is returned once and remains only in the console's current memory. It is cleared on principal change, account selection, another mutation or explicit dismissal. Rotation creates the replacement and revokes the old key in one transaction. Revocation, capabilities and the account deletion fence are rechecked immediately before provider dispatch under the same account/billing lock order. Auth deletion cascades credential rows while retaining financial accounts.

The verified owner can create up to ten empty accounts, each with a separate default developer project. Each account supports at most 100 non-revoked keys. Keys have explicit chat, streaming, image generation, embedding and optional private-file capabilities. Organization, project and key budgets are explicit positive spending ceilings, measured in minor currency units. They do not set provider prices or grant credit. All three scopes must be configured before paid admission. The console returns all bounded active keys, paginates every budget in deterministic account/scope order, and labels usage as the latest 100 calls. Changing the signed-in principal immediately replaces the entire stateful console. Every authenticated console request pins that principal so a token refresh cannot apply an old form to a new account.

Clients first obtain a quote for an operation and its input. The server signs a two-minute token binding key ID, provider, capability, translated exact request body, pricing version and maximum charge. Execution must carry the token in `X-Kova-Quote` and a stable `Idempotency-Key`. Changed input, another key, expiry, a new pricing version or a higher recomputed price fails before dispatch. Billing context carries the accepted fingerprint, pricing version and ceiling into the common provider transport for another check after asynchronous setup. Configured Azure deployment aliases are preserved when a request crosses both ingress and transport; the approved pricing contract and registry must identify that final billed deployment, with no guessed canonical-to-deployment pricing substitution. Provider responses retain only their content type; private upstream headers and raw error bodies are not forwarded.

Account exports use a service-only, owner-scoped projection of accounts, projects, key metadata, budgets, requests, purchases and credit ledger records. It never includes raw keys, credential digests, key suffixes, request fingerprints, internal rate data or arbitrary processor metadata. Auth deletion removes ownership, projects and credentials. Financial account IDs and immutable financial records remain for reconciliation; this source does not establish a legal retention duration or grant access after the owner is deleted. The operator must approve the minimal retention schedule and processor retention policy before paid activation.

The native Responses endpoint accepts bounded text/message history, strict function declarations and paired client-owned tool results, encrypted reasoning continuation, strict JSON Schema output, an explicit output-token ceiling and optional streaming; provider storage is always disabled. Schema/tool/history bytes enter the same signed quote and reviewed input bound. Function declarations do not authorize the server to execute tools. Image generation requires explicit size and quality under the approved meter. Embeddings accept at most 32 bounded text inputs. Client account/usage/price/URL fields, hosted tools, remote attachments and multimodal Responses content are rejected. Existing consumer plan accounting and model routing are unchanged.

The MCP adapter implements stateless Streamable HTTP, protocol negotiation, initialize/ping, scoped tool listing, quoting and non-streaming generation calls. It authenticates every request with the same key boundary. It supports scoped bearer credentials and the separately gated [browser OAuth consent and registration flow](developer-mcp-oauth.md). OAuth grants are bound to one developer project and do not grant access to consumer Projects or Library. No installable ChatGPT App or widget is claimed. Reference: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Prepaid credit purchase and reversal source is described in [developer-prepaid-funding.md](developer-prepaid-funding.md). The first-party server JavaScript/TypeScript SDK lives in `sdk/javascript`; it enforces explicit client currency/budget, stable idempotency, bounded quotes and cancellation without implicit provider retries. Pricing administration is implemented separately. The bounded private text-file API and owner lifecycle are described in [developer-private-files.md](developer-private-files.md). Browser OAuth compatibility is a separate source package. Actual approved commercial rates, provider receipt contracts, payment/tax configuration, migration/deployment and live activation/canaries require the operator. Missing source is not classified as operator-only work.

Verification covers SQL ownership and privilege boundaries without service-role `SELECT auth.users`, atomic key rotation, secret deletion, scope changes/deletion fences between admission and dispatch, quote tampering/expiry/input/price changes, MCP scope/protocol handling, consumer/developer context isolation and the prior ledger conservation/fault suite. All provider calls in these tests are local fakes.

## Key-scoped usage retrieval

`GET /api/v1/usage?limit=25&offset=0` returns recent request records for the authenticated API key only, with sanitized token dimensions and customer charges in currency minor units. It uses the normal key authentication and rate limits and does not call a provider or create a charge. Limit is 1–100, offset is 0–10000; other parameters are rejected. The response contains `data`, `has_more`, and `next_offset`; the live list may change between reads. Organization-wide usage remains available only through the verified owner console. `GET /api/v1/usage?id=<request-uuid>` returns one sanitized usage record for the authenticating key, or the same 404 for missing and inaccessible requests. The `id` selector cannot be combined with pagination. This read-only operation does not call a provider or reserve credits.

## Model-specific reasoning effort

Responses accept an optional `reasoning: { "effort": "high" }` field. An approved pricing contract must explicitly list the supported values in `allowedReasoningEfforts`. The model catalog exposes these as `reasoning_efforts`, and the playground displays only the approved options for the selected model. Changing the effort invalidates the current quote. Reasoning remains within the approved output-token ceiling and is included in the signed request and metered settlement. No additional provider capability is enabled by default.

## Bounded inline vision

A Responses user message may contain one inline PNG image of up to 32 KiB and 512 × 512 pixels, with `detail: "low"`. Remote image URLs, provider file IDs, other media and multiple images are rejected. Enable only for a model/provider contract with a reviewed `maximumInlineImageTokens` upper bound and verified input-token pricing; the server reserves sufficient input tokens for both request bytes and the image bound. The Playground shows an image selector only when the approved model catalog advertises inline-image support. Larger images, other formats and full vision compatibility remain outside this initial implementation.

## Streaming in the Playground

Select Streaming responses to use the approved streaming-capability model list. The Playground requests a Responses quote with `stream: true`, sends the identical signed request after explicit confirmation, and renders only public output-text and refusal deltas. Failed, incomplete or truncated streams are distinguished from successful completion; cancellation never implies a refund or confirmed settlement. Consult Logs before retrying. The UI does not expose encrypted reasoning or internal event payloads.

## Advanced Playground options

Responses and streaming requests support additional JSON for instructions, strict structured outputs, client-owned function definitions, tool selection and project file IDs. The controls do not permit overriding the model, input, stream mode, token bound, reasoning effort or storage settings. All options participate in the same signed quote and server-side validation. Files exposes the project file ID for this purpose. The Playground does not execute client-defined functions itself.

## Bounded hosted web search (disabled until qualified)

The Responses endpoint accepts a single native web-search tool with low search context, an explicit `max_tool_calls` of 1–3 and nonstreaming execution. Use a chat-scoped key and an approved OpenAI model contract with the `responses_search` meter. For example, the additional request fields are:

```json
{
  "tools": [{ "type": "web_search", "search_context_size": "low" }],
  "max_tool_calls": 2,
  "stream": false
}
```

The server selects the required tool, rejects mixed hosted tools, and reserves the approved token and call dimensions before dispatch. A contract needs an approved `web_search_calls` price, a reviewed maximum search input bound, and evidence that search-content charges are included in the returned input-token meter. Fixed-block search pricing and unqualified Azure contracts are excluded. Only actual, uniquely identified completed search calls contribute to settlement; malformed or missing required tool evidence leaves the reservation for reconciliation. The user can supply these fields through Advanced request options. The API catalog advertises support only when a matching contract and runtime gate exist. `KOVA_DEVELOPER_WEB_SEARCH_ENABLED` remains off pending provider-specific metering verification. No upstream rates, provider calls, or payment activity were authorized by this implementation.

## Standalone moderation (disabled until qualified)

`POST /api/v1/moderations` accepts a public model alias and one nonempty text input of at most 8,000 characters. A separately scoped `moderation` key, reviewed `moderation_requests` pricing contract, signed quote and idempotency key are required. Only explicitly approved standard OpenAI moderation models are supported. The response must contain one matching classification result and a valid provider request ID before settlement. No token counts are invented; request counts appear separately in usage analytics and CSV exports.

OpenAI's standard moderation endpoint is free to use; Kova's own reviewed infrastructure and collection-cost policy determines any customer charge. This implementation does not establish a commercial rate. The staged workspace migration adds the new key scope, and `KOVA_DEVELOPER_MODERATION_ENABLED` plus the configured provider capability must be enabled only after migration replay, provider verification and owner review. Image moderation, bulk classification and specialized restricted classifiers are not part of this implementation.

Reference: https://developers.openai.com/api/reference/resources/moderations/methods/create
