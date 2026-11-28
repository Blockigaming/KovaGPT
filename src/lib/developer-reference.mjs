// Public reference for the implemented source contracts. This does not enable execution.
const endpoint = (slug, title, path, methods, request, behavior) => ({
  slug,
  title,
  path: `/api/v1/${path}`,
  methods: methods.split(" "),
  request,
  behavior,
});

export const DEVELOPER_ENDPOINTS = [
  endpoint(
    "mcp-connections",
    "Reviewed MCP connections",
    "mcp-connections",
    "GET POST",
    "GET lists active reviewed read tools explicitly delegated to this key. POST id, tool, query (1–300 characters) and approved:true to invoke that exact tool.",
    "Requires mcp_read scope and a current owner grant (up to 24 hours). No arbitrary endpoint, write tool or credential access. Remote discovery revalidates read-only tool schema on every invocation. Kova inference credit is not charged; third-party charges may apply. Revoking the grant, rotating the key or changing the linked connection invalidates access.",
  ),
  endpoint(
    "models",
    "Models",
    "models",
    "GET",
    "List models without parameters, or supply id for one public alias. Only approved contracts visible to the authenticated key are returned.",
    "Inspect capabilities and model-specific parameters before obtaining a quote. An unknown or out-of-scope alias returns 404; do not substitute an upstream deployment name.",
  ),
  endpoint(
    "quotes",
    "Quotes",
    "quotes",
    "POST",
    "Send operation and input as JSON. The input must match the exact later execution request. The response contains quoteToken, pricingVersion, currency, maximumCharge and expiresAt.",
    "The quote is bound to the key, canonical input and approved pricing and expires within two minutes. It does not reserve credit or execute a provider request. Compare the maximum with an explicit budget.",
  ),
  endpoint(
    "responses",
    "Responses",
    "responses",
    "POST",
    "Supply model, input and max_output_tokens; optionally instructions, stream, supported reasoning effort, strict JSON schema, function tools, file_ids or conversation references.",
    "Quote operation responses and send X-Kova-Quote and Idempotency-Key. Provider storage is disabled; function calls are proposals, not executed functions. Inspect incomplete and refusal outcomes before consuming output.",
  ),
  endpoint(
    "chat-completions",
    "Chat Completions",
    "chat/completions",
    "POST",
    "Supply model, text-only messages, exactly one of max_tokens or max_completion_tokens, and optional stream and reasoning_effort.",
    "Quote chat/completions, not responses. The adapter converts native Responses to the supported Chat Completions JSON or SSE subset; advanced tools and multimodal inputs require Responses.",
  ),
  endpoint(
    "images",
    "Images",
    "images",
    "POST",
    "Supply model, prompt, size, quality and optional n (1–4). Approved edit contracts accept one canonical inline PNG in image, at most 32 KiB and 512 × 512.",
    "Quote the exact generation or edit input and require image-generation scope. No masks, remote images or provider file IDs are accepted. Editing needs separately approved image-input metering and activation.",
  ),
  endpoint(
    "embeddings",
    "Embeddings",
    "embeddings",
    "POST",
    "Supply model, input (text or up to 32 text inputs), and optional dimensions when supported by the model contract.",
    "Quote embeddings before execution. Store vectors with the public model alias and dimensionality; vectors from incompatible models cannot be mixed in a vector store.",
  ),
  endpoint(
    "search",
    "Web Search",
    "search",
    "POST",
    "Supply model, query, max_output_tokens and max_tool_calls from 1 to 3. Quote operation search. With research:true, use 2 or 3 calls and at most 2,048 output tokens; research release gates also apply.",
    "The native nonstreaming answer can contain source annotations. Search call and token receipts must qualify; unrestricted crawling and unsupported provider contracts are excluded.",
  ),
  endpoint(
    "moderations",
    "Moderation",
    "moderations",
    "POST",
    "Supply model and a nonempty text input up to 8,000 characters. Quote moderations using a moderation-scoped key.",
    "One classification result is required for settlement. This endpoint does not provide image moderation or bulk classification. Consult approved pricing rather than assuming the service is free.",
  ),
  endpoint(
    "realtime",
    "Native Realtime turns",
    "realtime",
    "POST",
    "Quote one text input (up to 1000 UTF-8 bytes) or raw base64 PCM16 mono audio (24 kHz, 0.1–5 seconds). Select text or audio output and max_output_tokens from 1–512.",
    "Opens a native provider WebSocket server-side for one bounded turn, returns text or base64 PCM16 audio and validated usage, and closes the connection. Separate text, audio and cached-token pricing requires approval. This is a request-scoped turn, not an interactive multi-turn WebSocket proxy.",
  ),
  endpoint(
    "browser-sessions",
    "Interactive Cloud Browser sessions",
    "browser-sessions",
    "POST GET DELETE",
    "Create a single-use grant with optional exact HTTPS origin, retrieve or close by ID. Connect to the returned WebSocket with the kova.browser.v1 protocol. Authenticate with client_secret, quote a browser input {model,url,interactive:true}, then send turn.create with the exact quote and request key.",
    "One independently metered isolated session. Receive turn.delta browser.snapshot views with snapshot_id; send turn.action with id, command {snapshot_id,approved:true,source,action}. Supports same-origin navigation, approved link click, scroll, wait, screenshot and finish. Computer source requires computer_use scope and a server-bound proposal. Send turn.computer_quote with command {snapshot_id,model,input,max_output_tokens}; after reviewing the returned maximum charge send turn.computer_propose with command {snapshot_id,approved:true,quote_token,request_key}. Review turn.computer_proposed before approving its exact action with turn.action. No forms, credentials, arbitrary scripts or writes. Cancel or disconnect closes the browser. Provider approval and activation remain required.",
  ),
  endpoint(
    "realtime-sessions",
    "Realtime sessions",
    "realtime-sessions",
    "GET POST DELETE",
    "POST optional exact HTTPS origin; GET or DELETE require the session id. A single-use grant expires in 30 seconds and establishes a five-minute WebSocket session.",
    "Connect to /api/developer/realtime/socket using kova.realtime.v1; authenticate in the first frame, then quote and explicitly authorize each turn. Up to eight independent turns, one at a time, with provisional streamed deltas, cancellation and close. No provider credentials or continuous microphone access. Each turn uses a separately bounded provider connection.",
  ),
  endpoint(
    "audio-speech",
    "Speech generation",
    "audio/speech",
    "POST",
    "Quote and submit model, input (1–1000 UTF-8 bytes), voice default and optional response_format mp3. Returns base64 MP3 and usage.",
    "Requires the audio_speech scope, an approved ElevenLabs Flash v2.5 price contract and a server-approved voice. Provider character-cost and request ID are mandatory. Disclose AI-generated speech; no voice cloning or arbitrary voice selection.",
  ),
  endpoint(
    "audio-transcription",
    "Audio transcription",
    "audio/transcriptions",
    "POST",
    "Supply model and audio as a canonical base64 PCM WAV data URI: mono, 16 kHz, 16-bit, 0.1–20 seconds. Quote audio/transcriptions.",
    "The audio_transcription scope and approved duration receipt are required. Submit only recordings you may process; native translation uses the separate audio/translations endpoint.",
  ),
  endpoint(
    "audio-translation",
    "Native audio translation",
    "audio/translations",
    "POST",
    "Quote model, target_language (en, es, fr, de, it, pt, ja, ko, zh) and canonical base64 raw PCM16 mono at 24 kHz, 0.2–10 seconds in exact 200 ms frames. Returns translated text and PCM16 audio.",
    "Requires audio_translation scope and an approved closed_input_frames duration accounting contract. A graceful native provider close confirms completion; usage is application-observed input duration, not a provider invoice. Provider qualification and explicit activation remain required. Only submit recordings you may process.",
  ),
  endpoint(
    "decisions",
    "Decisions",
    "decisions",
    "POST",
    "Supply model, text input and one to sixteen named questions. Question types are predicate, choice and score; provide instructions and choices or levels as applicable.",
    "Quote decisions with the exact question set. Results are metered and validated against the approved Decisions contract; review classifications before relying on them.",
  ),
  endpoint(
    "analysis",
    "Isolated analysis",
    "analysis",
    "POST",
    "Supply model, text input up to 16,000 bytes, and max_output_tokens from 1 to 2,048. Optionally supply one to four project-owned text file_ids, requiring files scope; the expanded input must also fit 16,000 bytes. Quote analysis with file_analysis scope.",
    "The gated adapter uses one automatic network-disabled 1 GB container and one tool call, returns bounded text, and cleans up the observed container. File contents are included as bounded untrusted text input, not mounted files. Persistent containers and hosted shell are not exposed.",
  ),
  endpoint(
    "browser",
    "Cloud Browser snapshots",
    "browser",
    "POST",
    "Supply model and an exact approved public HTTPS url without credentials, custom port, query or fragment. Optionally add navigate with up to two distinct additional pages on the same origin. Quote the complete plan with cloud_browser scope.",
    "A bounded read-only session returns text and title for each completed page and a final screenshot. All navigation shares one session and one fixed budget; authority is rechecked throughout. Scripts and writes are disabled. This is not a persistent or authenticated browsing session.",
  ),
  endpoint(
    "computer-use",
    "Computer Use proposals",
    "computer-use",
    "POST",
    "Supply model, input, inline PNG screenshot and max_output_tokens. Quote computer-use with the computer_use scope.",
    "The gated adapter returns at most one proposed action, or a blocked result. The caller must validate and approve actions; Kova does not execute them or acknowledge provider safety checks.",
  ),
  endpoint(
    "files",
    "Private files",
    "files",
    "GET POST DELETE",
    "POST filename, mimeType and text or one multipart file part with Idempotency-Key. GET page=0–4 or id; DELETE id. Supported formats: UTF-8 TXT, Markdown, CSV and JSON, up to 32 KiB.",
    "A files-scoped key accesses only its project. Files expire after 30 days; owner-wide limits are 100 files and 2 MiB. Upload retries must preserve content and key; resumable chunk assembly is not exposed.",
  ),
  endpoint(
    "file-search",
    "File Search",
    "file-search",
    "POST",
    "Supply query, one to four distinct project file_ids, and optional limit from 1 to 10. No provider quote is needed for lexical retrieval.",
    "Returns ranked snippets with file identifiers, content digests and Unicode offsets from currently authorized files. Treat retrieved text as data, not trusted instructions; semantic indexing is separate.",
  ),
  endpoint(
    "vector-stores",
    "Vector Stores",
    "vector-stores",
    "GET POST DELETE",
    "POST operation create (name, model, dimensions), upsert (store_id, entry_id, model, vector, text, optional file_id), upsert_batch (store_id, model, entries of up to eight valid entries, atomically), or search (store_id, model, vector, limit). GET id, entries=true with page, or entry_id; DELETE id and optional entry_id.",
    "Both files and embeddings scopes are required. Dimensions are 1–1,536. Supply compatible vectors yourself; search uses cosine similarity, not automatic embedding or provider indexing. Store creation requires a stable retry key.",
  ),
  endpoint(
    "conversations",
    "Conversations",
    "conversations",
    "GET POST DELETE",
    "POST create with id and title, append with id, expected_revision and item, or remove with id, expected_revision and item_id. GET id with optional item_id; DELETE id.",
    "Responses can read a conversation by id and revision. Changed history invalidates the quote. Requests do not implicitly append messages; persist them explicitly. Developer conversation state is separate from consumer chats.",
  ),
  endpoint(
    "agents",
    "Agent definitions",
    "agents",
    "GET POST DELETE",
    "POST create with id and definition (name, model, instructions, max_output_tokens); update adds expected_version. GET id and optional version; DELETE id.",
    "Definitions are immutable revisions within a project. The chat-scoped resource does not execute autonomously; use agent-turns and a separate quote for one invocation.",
  ),
  endpoint(
    "agent-turns",
    "Agent turns",
    "agent-turns",
    "POST",
    "Supply agent_id, version, input, optionally one to four distinct versioned skill references, and an optional conversation {id, revision}. Quote agent-turns.",
    "The server loads the exact authorized definition and binds the versions to the quote. Returns a bounded native Responses result. Conversation-bound turns reuse private persisted history; append new messages explicitly. Changed revisions invalidate authorization. No model-directed delegation or automatic chaining is claimed.",
  ),
  endpoint(
    "uploads",
    "Resumable uploads",
    "uploads",
    "GET POST",
    "POST create with id, filename, mime_type, total_bytes and sha256. Append base64 data with id and offset; complete or cancel with id. GET lists uploads or retrieves by id.",
    "Files scope required. Fixed one-hour expiry, 32 KiB total, 8 KiB chunks, 64 parts, eight pending uploads and 32 retained receipts per owner. Retries at already received offsets must match. Completion verifies digest, UTF-8 and file quotas and returns file_id. Cancel and complete erase temporary bytes; no inference or charge.",
  ),
  endpoint(
    "prompts",
    "Saved prompts",
    "prompts",
    "GET POST DELETE",
    "POST create with id and definition (name, description, prompt); update adds expected_version. GET id with optional version; DELETE id.",
    "Private saved text, up to 20 immutable versions per prompt and 20 prompts or 200 total versions per owner. Requires chat scope. Retrieve and submit text explicitly in a separately quoted request; storage never executes inference.",
  ),
  endpoint(
    "skills",
    "Skills",
    "skills",
    "GET POST DELETE",
    "POST create with id and definition (name, description, instructions); update adds expected_version. GET id with optional version; DELETE id.",
    "Private text-only bundles have up to 20 revisions per skill and owner quotas. Refer to exact revisions from agent turns. Executable archives and automatic tool permissions are unsupported.",
  ),
  endpoint(
    "webhooks",
    "Webhooks",
    "webhooks",
    "GET POST DELETE",
    "POST create with id, approved HTTPS url and request.settled or request.rejected events; rotate with expected_generation; test with event_id; retry pending delivery with event_id and expected_attempts. GET id or id and deliveries=true; DELETE id.",
    "Store the returned signing secret securely. Verify HMAC over event_id.timestamp.raw_body and a five-minute timestamp window; deduplicate event IDs. Delivery is bounded and retried, not exactly once. Manual retry accelerates only a pending previously attempted delivery, retains the same event ID and never resets the five-attempt cap or seven-day lifetime. Stale, leased, delivered and exhausted events cannot be retried.",
  ),
  endpoint(
    "batches",
    "Batches",
    "batches",
    "GET POST",
    "POST create with id, currency, maximum_charge and one to eight items. Each item has id, operation, input and quote_token. GET id or id and item_id; POST cancel with id.",
    "Supported operations are responses, chat/completions, agent-turns, moderations, embeddings, decisions, search and isolated analysis. Admission occurs at dispatch, not submission. Unknown outcomes are not automatically retried; cancel only prevents new claims.",
  ),
  endpoint(
    "automations",
    "Automations",
    "automations",
    "GET POST",
    "Use the batch creation envelope and give each item a strictly increasing canonical UTC run_at, one minute to 23 hours ahead. GET id or id and item_id; POST pause, resume or cancel with id.",
    "Finite schedules expire after 24 hours. Resume may execute overdue authorized work; require explicit approval. Indefinite recurrence and external actions are not supported by this resource.",
  ),
  endpoint(
    "research-runs",
    "Research runs",
    "research-runs",
    "GET POST",
    "Create with the batch envelope: one search item with research:true and two or three tool calls for autonomous research, or two to four separately quoted ordinary search items. GET id or list; POST cancel with id.",
    "The worker runs bounded autonomous question planning, web search and synthesis in one metered provider invocation, or explicit multi-query evidence collection. Retrieve mode, synthesis and settled provider citations. Cancellation stops queued work and signals running work; already incurred charges remain accountable. No unlimited browsing or unbounded research.",
  ),
  endpoint(
    "response-jobs",
    "Background responses",
    "response-jobs",
    "GET POST",
    "POST create with id, currency, maximum_charge, input and quote_token. Input is one nonstreaming Responses request with at most 2,048 output tokens, bounded text history, optional strict structured output or up to four client-owned function proposals. GET id or list; POST cancel with id.",
    "An exact lost-acknowledgement retry uses the original ID and identical input including quote. The worker rechecks authority and price. Only settled completed jobs expose output; in-flight work cannot be canceled by this resource.",
  ),
  endpoint(
    "usage",
    "Usage and request logs",
    "usage",
    "GET",
    "GET limit (1–100) and offset (0–10,000), or id for a single request; never combine id with pagination.",
    "Returns sanitized request identifiers, public model, capability, settlement state, currency and available usage dimensions for the authenticating key. Charge values use minor currency units. No provider request is made.",
  ),
];

const guide = (slug, title, request, behavior) => ({ slug, title, request, behavior });
export const DEVELOPER_GUIDES = [
  guide(
    "quickstart",
    "Quickstart",
    "Create a scoped server-side key and configure budgets. Discover a visible model with GET /api/v1/models, then POST /api/v1/quotes with operation responses and your exact input.",
    "Review the maximum charge and currency before sending the same input with the quote and a stable Idempotency-Key. If the transport fails, inspect usage or retry only the same logical operation.",
  ),
  guide(
    "authentication",
    "Authentication",
    "Use Authorization: Bearer with a developer key over HTTPS. The console uses a separate verified account session, never a caller-supplied owner ID.",
    "Store secrets server-side, rotate exposed keys and limit capabilities to the project. Browser OAuth discovery is available only when the configured MCP issuer and execution gates are enabled.",
  ),
  guide(
    "api-keys",
    "API keys",
    "Create, scope, rotate and revoke credentials in the console. A full secret is shown once; retain it in a secret manager rather than source code.",
    "Rotation atomically replaces the key. Revocation and current scope are checked before dispatch; consumer sessions and unrelated project resources are not authorized by the key.",
  ),
  guide(
    "usage-billing",
    "Billing and usage",
    "Configure account, project and key ceilings in the account currency’s minor units. A signed quote is an upper bound, not a completed transaction.",
    "Reservations are made before provider dispatch and settled with authoritative receipts. An uncertain request may retain a hold; check usage and reconcile before initiating new work.",
  ),
  guide(
    "rate-limits",
    "Rate limits",
    "HTTP 429 indicates an exhausted rate window. REST and WebSocket upgrade throttles return Retry-After: 60 (a conservative full window). A limiter outage returns 503; do not treat that as authorization.",
    "A quote does not override a quota, credit balance, key scope or budget. All current ingress and resource request windows are 60 seconds. The per-request, daily, monthly and concurrent limits apply at account, project and key levels; configured concurrency is 1–8. Retry reads after the delay; never replay ambiguous paid work with a new key.",
  ),
  guide(
    "errors",
    "Errors and troubleshooting",
    "Read the structured error.code and HTTP status rather than arbitrary text. Invalid input must be corrected; unauthorized or forbidden requests require credential and scope review. A missing resource may be inaccessible rather than nonexistent.",
    "When a quote expires or input changes, obtain a new quote before any new dispatch. For timeouts and server errors, inspect existing request or job status and contact support with sanitized identifiers, never credentials.",
  ),
  guide(
    "streaming",
    "Streaming",
    "Use stream: true in a supported Responses or Chat Completions input, including the same setting when quoting. Read SSE events incrementally rather than splitting arbitrary transport chunks.",
    "Handle explicit completion, incomplete or failure events. A closed stream without a terminal event is not proof of completion. Aborting after dispatch can still incur verified provider cost.",
  ),
  guide(
    "tool-calling",
    "Function calling and structured output",
    "Declare function schemas or strict JSON Schema output through Responses. Validate arguments and schemas locally; function results require an explicit follow-up with the matching call identifier.",
    "Kova does not automatically execute client functions. Review authorization and consequential actions yourself. Refusals and incomplete outputs must be handled before parsing the expected schema.",
  ),
  guide(
    "image-generation",
    "Image generation and editing",
    "Discover an approved image contract, choose a supported size and quality, and quote the exact prompt and optional inline PNG.",
    "Generation and editing have different qualified input meters. Reject remote URLs and unsupported masks; treat output as generated content and respect rights and consent.",
  ),
  guide(
    "safety",
    "Security and developer safety",
    "Separate projects and credentials, validate inputs and tool outputs, and avoid placing secrets in prompts, source files or client bundles.",
    "Use explicit budgets and review externally consequential tool calls. Retention is resource-specific: private files expire after 30 days, while financial records may need reconciliation. Do not infer a contractual retention period from source behavior.",
  ),
  guide(
    "sdks",
    "JavaScript and Python SDKs",
    "The repository-local JavaScript ESM client (Node 22+) and Python client use server-side credentials, scoped model discovery, explicit quotes and stable idempotency keys. Neither package is announced as published.",
    "Use JavaScript responseEvents or Python response_events and async_response_events for Responses streams. Both SDKs expose bounded file, job and resource operations. Inspect uncertainty errors rather than automatically retrying.",
  ),
  guide(
    "javascript",
    "JavaScript SDK",
    "Import KovaGPT from the repository-local sdk/javascript/index.mjs with Node.js 22 or newer. Instantiate KovaGPT with apiKey from your server secret manager. Use client.models() for discovery, client.quote(operation, input) for a quote and client.responses.create(input, options) for budget-controlled execution.",
    "The options include currency, maximumCharge and idempotencyKey. Use responseEvents for native Responses SSE or chatCompletionEvents for the compatibility stream. KovaError.requestMayHaveStarted distinguishes ambiguous paid failures. The package is not publicly published.",
  ),
  guide(
    "python",
    "Python SDK",
    "Import Client, KovaError and response_events from the repository-local kovagpt package under sdk/python. Configure Client with an API key from a server-side secret manager. Call models() before selecting a public alias, then responses with an explicit currency, maximum_charge and idempotency_key.",
    "Consume response_events for native streaming or chat_completion_events for compatible chat. AsyncClient exposes awaitable equivalents and async_response_events or async_chat_completion_events for streaming. KovaError.request_may_have_started and AsyncRequestCancelled indicate potentially dispatched work; cancellation is not a refund. This package is not publicly published.",
  ),
  guide(
    "privacy",
    "Developer privacy and data retention",
    "Developer keys grant access only to their scoped project. Consumer Projects, chats, connected accounts and Library are not granted by developer credentials. The owner console uses its separate verified session.",
    "Private developer text files expire after 30 days; queue jobs expire after 24 hours and are eligible for cleanup seven days later. Provider-side Responses storage is disabled. Financial records may be retained for reconciliation; consult current legal policies rather than assuming a fixed global retention period.",
  ),
  guide(
    "api-pricing",
    "API pricing",
    "Use GET /api/v1/models to discover approved contracts. No static customer rate is established by this preview. POST /api/v1/quotes returns the maximum for the exact input, model, capability and pricing version in the account currency's minor units.",
    "The quote is not a price guarantee for changed requests and does not reserve funds. Admission checks current account, project and key limits; settlement uses verified usage. Do not assume provider list prices are Kova customer prices.",
  ),
  guide(
    "examples",
    "Integration examples",
    "For a background summary, first quote a nonstreaming Responses input with max_output_tokens at most 2,048. Submit that input and quote token with a stable job UUID, currency and explicit maximum_charge.",
    "Poll the same job ID until a terminal status. Only a settled completed job contains output. Cancellation prevents new claims; an uncertain outcome is not a signal to create a replacement paid job.",
  ),
  guide(
    "migration-guides",
    "Migration guides",
    "When moving from another API, replace upstream model names with discovered public aliases and add the quote step, stable idempotency and explicit budgets.",
    "Qualify model-specific features and streaming event handling independently. The Chat Completions route is a bounded compatibility subset, not universal upstream SDK compatibility.",
  ),
  guide(
    "changelog",
    "Developer changelog",
    "The current development candidate contains scoped private files, versioned agent and skill resources, conversation state, queue operations and metered provider adapters.",
    "These are source changes awaiting release qualification; this page does not announce a deployed feature or publication date. Consult the platform status and model discovery before integration.",
  ),
  guide(
    "status",
    "Service status",
    "Use the console to determine whether the authenticated account is enabled and GET /api/v1/models to discover currently approved capabilities.",
    "Run the current public liveness, platform readiness and developer authentication-gate checks below without credentials or billable model calls. These point-in-time observations do not establish provider health, historical uptime or a service-level guarantee. Treat unknown status as unverified; contact support with request identifiers.",
  ),
  guide(
    "release-notes",
    "Release notes",
    "The developer platform candidate is not a published production release. The migration and capability qualification gates remain independent of source implementation.",
    "No dated production launch is claimed here. Release notes will describe only verified deployed changes; consult status and the changelog for the present source boundaries.",
  ),
  guide(
    "deprecations",
    "Deprecations and compatibility",
    "No deprecation dates are established by this reference. Clients must use discovered public models and the versioned contract rather than assuming upstream lifecycle parity.",
    "Before changing versions, test quotes, response shapes, streaming and retries in an isolated environment. Do not infer a replacement model or deadline from an upstream announcement.",
  ),
  guide(
    "articles",
    "Engineering articles",
    "Designing recoverable requests: a signed price quote and an idempotency key solve different problems. The quote binds what can be charged; the key identifies the logical operation.",
    "A durable queue needs both. On a lost acknowledgement, retrieve the original job and accounting record; reissuing a different ID could authorize a second operation. Keep trace IDs and uncertainty distinct from successful output.",
  ),
  guide(
    "tutorials",
    "Tutorials and cookbooks",
    "Private-document workflow: upload a UTF-8 file with a stable upload key, use File Search with the returned file ID, and select relevant snippets or pass file_ids to Responses.",
    "Quote the exact generation input separately. Review retrieved offsets and generated claims, then delete the file when no longer needed. Retrieval itself is not proof that a claim is true.",
  ),
  guide(
    "support",
    "Developer support and FAQ",
    "For a failed request, record the route, public model, UTC timestamp, status, error code and request or job ID. Never include an API key or webhook signing secret.",
    "Contact KovaGPT support through the support page. If execution is uncertain, retain the original request ID rather than creating a new paid operation while investigating.",
  ),
  guide(
    "mcp",
    "MCP integrations",
    "The /mcp endpoint uses stateless Streamable HTTP with scoped bearer credentials or separately enabled owner-approved OAuth. Send Accept: application/json, text/event-stream and MCP-Protocol-Version: 2025-11-25.",
    "Tool discovery is scope-bound; paid tools use the ordinary quote and wallet. OAuth grants are limited to the approved developer project and do not authorize consumer Projects or Library.",
  ),
];

// Frozen 29-page baseline, including the overview and dedicated routes.
export const DEVELOPER_BASELINE_PATHS = [
  "/developers",
  ..."agents api-keys api-reference authentication authorize changelog connections console docs errors examples files image-generation images migration-guides models pricing quickstart rate-limits responses safety sdks search status streaming tool-calling usage-billing webhooks"
    .split(" ")
    .map((slug) => `/developers/${slug}`),
];
export const DEVELOPER_DEDICATED_PATHS = [
  "/developers",
  "/developers/authorize",
  "/developers/connections",
  "/developers/console",
  "/developers/pricing",
  "/developers/docs",
  "/developers/api-reference",
];
export const DEVELOPER_SOURCE_HISTORY = [
  {
    date: "2026-11-28",
    commit: "6488d5c08c2244c132a0db1196d3f4729c0cd300",
    title: "Error and retry contracts",
    change:
      "REST throttles advertise Retry-After; limiter outages return 503. SDKs expose delay without automatically retrying paid requests.",
  },
  {
    date: "2026-11-28",
    commit: "dfb196cb9795e04c44df77b7468039458a4bedcb",
    title: "Scoped discovery and usage",
    change:
      "The console reads the selected key's approved catalog. Usage includes existing authoritative meter dimensions; unknown is not zero.",
  },
  {
    date: "2026-11-28",
    commit: "ae0b0f25bff40a2b69554b5a56b2a4273d1080d9",
    title: "Resumable uploads",
    change:
      "Bounded chunk lifecycle adds offset replay, digest verification, cancellation and expiry without replacing existing file uploads.",
  },
  {
    date: "2026-11-28",
    commit: "2da44babfcef22165a6c26d408155a1c7e2c9781",
    title: "Saved prompts",
    change:
      "Project-scoped immutable versions and explicit resolution support reproducible quoted inputs.",
  },
  {
    date: "2026-11-28",
    commit: "d18e67687",
    title: "Response schemas",
    change:
      "Method-specific resource responses replace generic success shapes in the source OpenAPI reference.",
  },
  {
    date: "2026-11-28",
    commit: "0f572c20d",
    title: "Realtime sessions",
    change:
      "Authenticated metered WebSocket sessions add explicit turn quotes and resource lifecycle controls.",
  },
  {
    date: "2026-11-27",
    commit: "1c3632e1e",
    title: "Versioned OpenAPI preview",
    change:
      "Source contracts describe supported operations; no public package or service launch is implied.",
  },
  {
    date: "2026-11-26",
    commit: "4b8500a0b",
    title: "Conversation persistence",
    change:
      "Scoped state and revision fences require explicit revision management rather than implicit consumer-chat access.",
  },
];
export const DEVELOPER_REFERENCE = [...DEVELOPER_ENDPOINTS, ...DEVELOPER_GUIDES].map((entry) => ({
  ...entry,
  searchText: developerReferencePage(entry)
    .sections.flatMap((section) => [section.title, section.body, ...section.points])
    .join(" "),
}));
export const DEVELOPER_PAGE_PATHS = [
  ...new Set([
    ...DEVELOPER_DEDICATED_PATHS,
    ...DEVELOPER_REFERENCE.map((entry) => `/developers/${entry.slug}`),
  ]),
].sort();
export const DEVELOPER_REFERENCE_BY_SLUG = new Map(
  DEVELOPER_REFERENCE.map((entry) => [entry.slug, entry]),
);

export function developerReferencePage(entry) {
  return {
    path: `/developers/${entry.slug}`,
    title: entry.title,
    description: entry.path
      ? `${entry.methods.join(" / ")} ${entry.path}`
      : entry.title + " — developer guide.",
    indexable: false,
    availability: "Preview documentation — activation requires verified configuration.",
    sections: [
      { title: "Request and integration", body: entry.request, points: [] },
      { title: "Behavior and limits", body: entry.behavior, points: [] },
      ...(entry.slug === "support"
        ? [
            {
              title: "Frequently asked questions",
              body: "Start with the original project and request. Do not issue a new paid request to diagnose a previous one.",
              points: [
                "401 or 403? Check the key expiry, revocation, project membership and operation scope in the console. Never paste a credential into a ticket.",
                "Model missing? Discover with GET /api/v1/models using the affected key. A consumer model name does not establish API eligibility.",
                "Quote expired or changed? Reconcile the original request first, then obtain a new quote for the exact input only if a new operation is intended.",
                "Uncertain charge or disconnected stream? Retrieve the original request with GET /api/v1/usage?id=<request UUID> or the original job resource; compare currency, settlement state and hold. A cancellation is not a refund.",
                "Upload incomplete? Retrieve upload state and resume at the returned offset or cancel the upload. Never submit a different payload for a previously accepted offset.",
                "Suspected credential leak? Revoke the key in the console immediately; issue a new narrowly scoped key, replace the server secret and review usage. Do not send the leaked key to support.",
              ],
            },
            {
              title: "Report an incident",
              body: "Use the Contact support link below or email support@kovagpt.com. The support route is separate from the API; no response-time guarantee is asserted.",
              points: [
                "Include UTC timestamp, HTTP method and route, public model, HTTP status and sanitized error.code, request or job UUID, SDK name and version.",
                "For billing incidents include account currency, settlement state and observed charge or hold in minor units. State whether the original request may have started.",
                "Describe expected versus observed behavior and whether the problem reproduces with an unpaid read. Remove API keys, quote tokens, webhook secrets, private payloads, file contents and raw provider responses.",
              ],
            },
          ]
        : []),
      ...(entry.slug === "changelog"
        ? [
            {
              title: "Source candidate history",
              body: "Dates below are source commit dates, not release dates. Compatibility changes apply only when the corresponding contract is activated; check discovery before use.",
              points: DEVELOPER_SOURCE_HISTORY.map(
                (item) => `${item.date} — ${item.title}: ${item.change}`,
              ),
            },
          ]
        : []),
      ...(entry.slug === "rate-limits"
        ? [
            {
              title: "Request windows",
              body: "Each figure is requests per 60 seconds; all applicable fences apply together. These are source-enforced ceilings, not a throughput guarantee.",
              points: [
                "Authentication per client and authenticated ingress per key: 120 each.",
                "Conversations, agent definitions, skills, prompts and file search: 30 per key for each family.",
                "Vector stores and webhooks: 20 per key for each family. Uploads: 60 per key.",
                "Batches (including response jobs and research) and automations: 10 per key per group.",
                "Reviewed MCP: 10 per key, and remote reads 20 per owner.",
                "Realtime and browser session REST: 12 per key per kind; socket opening 20 per client per kind; socket quotes 30 and turns 16 per key per kind.",
                "Browser Computer Use proposals 12 and approved turns 8 per key. Socket connections are also bounded to 32 per instance per kind.",
                "Owner console and owner file operations: 60 per owner. Funding requests: 20 per owner.",
              ],
            },
            {
              title: "Budget and retry behavior",
              body: "No SDK automatically retries. JavaScript KovaError.retryAfter and Python KovaError.retry_after expose bounded numeric delays. Socket messages after upgrade do not carry HTTP headers; consult the error event and close state.",
              points: [
                "Limit concurrency in the account, project and key controls; a rejected reservation must not dispatch.",
                "For 429 on discovery, wait at least Retry-After before issuing another read.",
                "For an uncertain paid request, inspect original usage or job ID. Only retry the same logical operation with the original idempotency key and a valid quote after reconciling it.",
              ],
            },
          ]
        : []),
      ...(entry.slug === "errors"
        ? [
            {
              title: "HTTP errors and recovery",
              body: "The server maps stable developer error categories into HTTP responses. The following are concrete emitted examples; unspecified service failures are deliberately redacted.",
              points: [
                "400 developer_input_invalid or developer_idempotency_key_required: correct the request; use a stable idempotency key for paid work.",
                "401 developer_unauthorized: check the server-side key, expiry and revocation. 403 developer_scope_required or developer_owner_required: review the project and granted scope.",
                "404 developer_request_not_found or developer_prompt_not_found: check the original ID and project; do not assume a foreign resource is nonexistent.",
                "409 developer_quote_expired, developer_quote_changed, developer_idempotency_conflict or developer_upload_quota_exceeded: retrieve original state; obtain a new quote only when safe, never blindly reissue a new paid request.",
                "413 developer_input_too_large: reduce the request within the documented bound. 429 developer_rate_limit: wait at least Retry-After.",
                "503 developer_rate_unavailable, developer_pricing_unavailable, developer_settlement_unavailable or developer_unavailable: stop and inspect current state; no success or refund is implied.",
              ],
            },
            {
              title: "Recover an ambiguous request",
              body: "A server error, disconnected stream or SDK transport_failed can occur after dispatch. JavaScript requestMayHaveStarted and Python request_may_have_started flag uncertain paid work; neither proves a debit occurred.",
              points: [
                "Retain the original stable idempotency key and any server request or job UUID.",
                "GET /api/v1/usage?id=<request UUID> returns a key-scoped settlement record if the ID is known; otherwise use the bounded usage list or the owner Logs view. For background work retrieve the original job.",
                "Only a settled result or authoritative reconciliation establishes the outcome. Escalate unresolved holds using the support guide; never send the key, request body or signing secret.",
              ],
            },
          ]
        : []),
    ],
    ...(entry.slug === "changelog"
      ? {
          sources: DEVELOPER_SOURCE_HISTORY.map((item) => ({
            label: `${item.date} — ${item.title}`,
            href: `https://github.com/Blockigaming/KovaGPT/commit/${item.commit}`,
          })),
        }
      : {}),
    related: [
      ...(entry.slug === "support"
        ? [
            { label: "Error recovery", to: "/developers/errors" },
            { label: "Usage and billing", to: "/developers/usage-billing" },
            { label: "API key management", to: "/developers/api-keys" },
          ]
        : []),
      { label: "Search developer documentation", to: "/developers/docs" },
      { label: "Developer console", to: "/developers/console" },
      { label: "Contact support", to: "/contact-support" },
    ],
  };
}
