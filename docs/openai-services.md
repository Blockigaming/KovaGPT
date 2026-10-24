# OpenAI services

Kova's existing Responses adapter uses the selected chat models. Image and
embedding routing stays independent, including existing Azure deployments.
The unconfigured image fallback is `gpt-image-2.5-flare`, replacing the retired
`gpt-image-1`. Explicit image model and Azure deployment settings are preserved.
`KOVA_IMAGE_PROVIDER=openai` explicitly routes image generation and editing to
OpenAI with the existing key. Its default `auto` retains Azure routing when an
endpoint is configured. An explicit Azure selection requires that endpoint;
missing credentials or provider errors never trigger an automatic fallback.
The additional server integration uses the pinned OpenAI JavaScript SDK
7.30.0 and the existing `OPENAI_API_KEY`. No provider credential reaches the
browser. The SDK base URL is pinned to OpenAI, redirects are refused, and
automatic provider retries are disabled.

## Search and composer analysis

When `KOVA_TEXT_PROVIDER=openai`, web search uses the OpenAI `web_search`
tool. An explicit `KOVA_WEB_SEARCH_PROVIDER` can select `openai` or the existing
`firecrawl` integration. A successful search requires a completed search call;
only returned HTTP(S) citations become Kova source links. Explicit search
failure returns an error instead of presenting an ordinary reply as a search.

With `KOVA_OPENAI_SERVICES_ENABLED=true`, signed-in composer data analysis
uses a dedicated 1 GB OpenAI container with networking disabled. File analysis
uses temporary provider files and a vector store. These operations retain the
selected chat model, server instructions, owner/context checks, original chat
usage reservation and completion accounting. They complete through the normal
composer SSE parser with provider token usage. Context is bounded at 64,000
characters. Output is capped at the selected mode's ceiling or 2,048 tokens,
whichever is lower. This path does not run connected-app planning.

Files expire after one hour, vector stores after one day, and analysis
containers after one minute of inactivity as fallback retention limits.
Normal completion deletes the resources immediately. Cleanup uses a separate
timeout after cancellation. Unconfirmed cleanup is an error and logs the
specific temporary resource identifiers for operator reconciliation.

## Authenticated service API

`GET /api/ai/services` reports configuration and plan availability, not live
provider acceptance. `POST` accepts these operations:

| Operation     | Input                                              | Result                                                     |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `decisions`   | `input`, 1–8 named predicate or choice `questions` | Typed answers or explicit refusals                         |
| `moderation`  | `input`                                            | Moderation result                                          |
| `analysis`    | `input`                                            | Actual Python analysis in an isolated container            |
| `file_search` | `input`, 1–2 `documents` with `name` and `text`    | Answer from newly uploaded and indexed documents           |
| `browser`     | `input`, public-page task on configured domains    | Completed hosted browser task with actual browser activity |
| `agent`       | `input`                                            | Completed root Agents API turn                             |

Requests require a verified session, the current origin, an
`x-kova-service-owner` matching the authenticated principal, JSON, and a stable
`idempotency-key`. Provider model names, tool configurations, existing provider
resource identifiers, and server instructions are not client fields. Decisions
uses its dedicated `gpt-6-luna` model without changing chat model selection.
Agents uses the configured deep model with a small OpenAI-hosted sandbox,
disabled networking and subagents disabled. Agents, browser tasks and standalone analysis currently require Plus or Pro.
Hosted browser tasks enable the desktop and `computer_use` tool. They require
`KOVA_OPENAI_BROWSER_ALLOWED_DOMAINS_JSON`, an exact server-controlled domain
allowlist used for both sandbox network restrictions and browser origin approval.
Browser authentication and unknown approvals stop the task. This public-page
operation does not provide interactive sign-in, purchases or website mutations.

Admission checks bans, current sessions, durable duplicate protection, minute
and global daily budgets, and chat quota. File search also reserves the
existing plan's upload allowance using stable document fingerprints.
Output is withheld after session revocation. A failed request is not
automatically submitted again under the same identifier.

## Webhook receiver

`POST /api/openai/webhook` requires `OPENAI_WEBHOOK_SECRET`. It verifies the
exact bounded request body with the SDK's standard signature and timestamp
verification. Recognized response and Agents lifecycle events receive an
atomic durable receipt. Replays acknowledge the same event, and a failed
receipt store returns 503 so OpenAI can retry. Payloads cannot invoke tools,
run commands, or change user records.

Register the endpoint only after this source is deployed. Save the returned
signing secret directly to the deployment secret store and bind it server-side.
Registration and actual signed delivery are separate from local signature
tests. Neither API configuration nor a successful list request proves
production execution.

## Verification

The service tests cover completed-tool evidence, safe citations, resource
ownership and cleanup, interrupted Agents turns, quota and account guards,
duplicate prevention, signature verification, replay handling, and the
composer SSE contract. Real provider execution and deployed application
acceptance must be recorded separately. The existing Work browser runtime,
interactive preview and takeover controls remain a separate integration.
