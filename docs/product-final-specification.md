# KovaGPT — Complete Final Product Specification

Consumer AI · KovaGPT Developer API · Cloud Browser · Agents · Intelligent Interface · Connections · Security · Billing · Infrastructure

This is the finished product KovaGPT is supposed to become—not a development schedule, list of priorities, or another temporary architecture.

The final goal is to build one complete AI platform with two products powered by the same Kova AI system:

1. KovaGPT — the consumer and business assistant at `kovagpt.com`.
2. KovaGPT API for Developers — the commercial platform at `api.kovagpt.com`, allowing developers to integrate Kova models, agents, tools, images and other supported capabilities into their own applications.

Both use the same underlying Kova model gateway, security architecture, tool execution services and inference providers. They have separate permissions, credentials, quotas and billing.

## 1. The three official Kova AI models

Owner-approved November 8, 2026 update: use the OpenAI API now. Azure hosts Kova; OpenAI hosts inference. This supersedes the original foundation lock and the earlier three-model entitlement matrix.

| Kova product | Current foundation |
| ------------ | ------------------ |
| Argon 4.6    | `gpt-6-luna`       |
| Neon 4.6     | `gpt-6.1-terra`    |
| Xenon 5      | `gpt-6.1-sol`      |
| Argon 4.5    | `gpt-5.6-luna`     |
| Neon 4.5     | `gpt-5.6-terra`    |
| Xenon 4.6    | `gpt-6-sol`        |
| Xenon 6.1    | `gpt-6-astra`      |

Free: no model picker; regular chat is Argon 4.6 Lite, blue Thinking is Argon 4.6 Medium. Plus: all seven models, Lite through Max (35 combinations). Pro: all seven models, Lite through Ultra (42 combinations). Paid users use the model picker and effort slider, without a separate Thinking toggle.

All seven identify themselves by the selected Kova product name through trusted server instructions and accurately disclose OpenAI provenance when asked. Lite/Medium/High/Extra High/Max/Ultra use none/low/medium/high/xhigh/max native effort. GPT-6.1 Sol and Astra Lite use their supported minimum, low. Max reviews sequentially; Ultra uses four independent same-foundation reviewers. Increasing compute is not a guaranteed intelligence score.

Original future self-hosted targets remain DeepSeek V4 Flash July 2026, Llama 4 Maverick and Kimi K3, subject to a separately verified hosting cutover.

Kova Xenon 5

Flagship

Current foundation: GPT 6.1 Sol. Future target: Kimi K3

Highest-capability tier for demanding reasoning, programming, research and complex agent tasks.

Kova Neon 4.6

Current foundation: GPT 6.1 Terra. Future target: Llama 4 Maverick

Balanced model for everyday conversations, writing, analysis and tool-driven tasks.

Kova Argon 4.6

Current foundation: GPT 6 Luna. Future target: DeepSeek V4 Flash, July 2026 release

Speed-first model for quick conversations, simple tasks and responsive tool coordination.

### Exact developer-facing model identifiers

| Kova product | Kova API model ID |
| ------------ | ----------------- |
| Xenon 5      | `kova-xenon-5`    |
| Neon 4.6     | `kova-neon-4.6`   |
| Argon 4.6    | `kova-argon-4.6`  |

Kova owns the product branding, model selection, system behavior, tools and platform. The underlying foundation models remain the work of their respective developers.

The hosting provider may change to improve latency or availability only when the exact selected foundation-model version is preserved. Changing from Kimi to a different model, for example, is not an acceptable silent fallback.

Reasoning effort, context limits and supported inputs must reflect each model's actual capabilities; Kova cannot invent native reasoning features simply by labeling a model "high thinking."

### Consumer model efforts (owner update, November 7, 2026)

Free has no model picker or effort slider: its only model control is Thinking, off for Argon Lite and blue/on for Argon Medium. Plus and Pro have a model picker and response-effort slider, with no separate Thinking toggle.

There are exactly 18 model/effort configurations: each of the three foundations has Lite, Medium, High, Extra High, Max and Ultra. Free uses Argon Lite normally and Argon Medium with Thinking enabled. Plus unlocks Argon and Neon through High. Pro ($80/month) unlocks all three models and all six slider positions. Existing `thinking` ledger IDs represent Medium; obsolete `medium` saved requests normalize to that same position, not a seventh mode.

The November 7 owner usage contract replaces exact public usage counts with relative allowances: Free is very limited, Plus has 5× Free usage, and Pro ($80/month) has 20× Plus usage, advertised as 100× Free. Free and Plus remain limited on every model. Pro has unlimited basic chat, defined as server-resolved Argon 4.6 in Lite mode; all other model/effort combinations remain limited. Included Pro basic chat does not consume message or token allowances for advanced usage. Per-request sizing, concurrency, identity, security, and separate feature quotas still apply.

Higher efforts increase allowed generation budgets and bounded same-model verification work. Actual usage determines cost; a higher setting does not guarantee that every simple question takes longer or costs more. Argon and Xenon use supported native none/low/high/max reasoning controls. Neon has no native reasoning switch, so additional same-foundation review passes provide its extra compute. Only Ultra runs four independent subagents in parallel, with the selected foundation coordinating the final answer. Max remains sequential self-review. All internal calls are reserved before execution, included in usage accounting, cancelled with the request, and inherit its account/context scope. Reviewers cannot call external tools or execute actions.

## 2. One unified Kova intelligence platform

KovaGPT

Consumer and business assistant

Developer API

External applications and services

Kova Intelligence Gateway

Model routing · Streaming · Tool policy · Usage accounting · Moderation · Security

Xenon 5

Hosted inference

Neon 4.6

Hosted inference

Argon 4.6

Hosted inference

Browser

Tools

Files

Images

Search

Agents

The architecture must share capability implementations wherever possible. A web-search tool used by Kova chat and a web-search tool called through the Developer API should use the same authorized execution service, rather than two unrelated implementations.

Consumer and developer accounts must nevertheless remain isolated.

# Part I — The Finished KovaGPT Application

## 3. Main chat experience

When users visit `kovagpt.com`, they see a complete Kova-branded AI experience.

The interface keeps the approved Kova typography, colors, rounded controls and dark-mode-first design. It uses familiar interaction conventions without duplicating another company's branding or presenting itself as another product.

### Main chat capabilities

- Continuous conversations with streaming responses, editing, retrying, branching and chat search.
- Model selection between the three Kova models, based on plan entitlements.
- Thoughtful reasoning controls where supported.
- Attachments, images, documents, pasted text and code.
- Web search, research, browsing, images, file analysis and agent actions directly from the composer.
- Context-aware follow-up questions, source links and truthful activity updates.
- Message copy, selection, export, sharing, archiving and project organization.
- Temporary chats that do not create persistent conversational memory.
- Conversation memory and personalized instructions, governed by user settings.

The empty composer displays the microphone/voice affordance when available; sending text switches to the send control. All interaction states—loading, disabled, offline, approval required, failures and limits—must be usable on both desktop and mobile.

A user should never see a provider implementation error, cryptic internal reference or fabricated tool-success message in place of an understandable product response.

## 4. Intelligent Interface — interactive answers that actually work

Kova's responses should not always be plain text.

When useful, Kova can return a structured, interactive interface that helps the user understand information and act on it.

Example Intelligent Interface

What kind of result should Kova prepare?

Detailed research report

Interactive chart and analysis

Concise summary

Include sources and supporting evidence

Prepare this resultThis demonstrates the intended interactive chat behavior. It is not a control connected to KovaGPT's backend.

The production Intelligent Interface supports charts, maps, tables, forms, selectors, progress displays, file previews, code blocks, editable drafts and action confirmations.

All interactions must use validated structured data and real backend actions. A button that says "Connect account" must initiate an actual authorized connection, not merely add another chat message pretending the action occurred.

Interactive elements must remain correctly sized on mobile, with keyboard-safe bottom sheets, scrollable dialogs and accessible controls. No fullscreen image or tooltip should obscure unrelated chat content.

## 5. Secure cloud browser and in-chat website automation

Kova's cloud browser must function as a real, isolated browser, operated by the AI under the user's permission policy.

It supports navigation, reading pages, clicking, typing, scrolling, form submission, tabs, pop-ups, downloading permitted files, and interacting with authenticated websites.

Browser session rules

Idle termination

# 15 min

Maximum active duration

# No limit

Browser compute

On demand

Security isolation

Per user and task

The browser launches only when needed. Actual authorized activity renews the 15-minute idle lease. UI refreshes, status polling and animations do not.

An actively used browser may remain open for hours without a Kova-imposed absolute cutoff. External session expiry, provider restrictions and infrastructure interruptions remain possible, and Kova must recover gracefully where permitted.

The user's browser preferences include allowed websites, denied websites, site-specific permissions, saved session controls, downloads, pop-up policies and revocation settings.

## 6. Secure sign-ins directly from chat

Kova must reproduce the functional experience in your screenshots:

A user asks Kova to do something → Kova opens the website → authentication is required → a trusted sign-in interface appears → the user completes verification → Kova resumes the task.

The AI coordinates authentication but never receives the user's password, passkey private key, one-time verification code or browser cookie as conversational content.

Example: Google sign-in during an agent task

Opened the expected website

Identified the official authentication provider

Authentication required

Trusted provider: Google · accounts.google.com

Complete the provider's sign-in and verification in its supported secure interface.

Continue in secure sign-inIllustrative UI only

Verify successful authentication

Resume the original authorized browser task

### Supported authentication flows

| Authentication               | Required behavior                                                           |
| ---------------------------- | --------------------------------------------------------------------------- |
| Google/Microsoft/other OAuth | Official authorization flow with scoped consent and secure callback         |
| Password login               | Trusted credential broker or supported browser handoff, never model-visible |
| Passkeys                     | Native, provider-supported WebAuthn authentication                          |
| Authenticator codes          | User completes MFA in the trusted surface                                   |
| Email/SMS codes              | Private verification UI; codes excluded from model context and logs         |
| Device approval              | Pause while the user authorizes on their device                             |
| Account selection            | Display the provider's real choices and honor the selected account          |
| Session expiry               | Pause safely, reauthenticate if permitted, then resume                      |

For providers such as Google that prohibit certain embedded webviews, Kova must use a supported browser-based authentication handoff rather than attempting to bypass the restriction.

For websites that permit remote-browser logins, a trusted credential channel can pass user-entered information to the isolated browser without allowing the AI model to read the secrets.

Kova must not bypass MFA, CAPTCHAs, passkey security, account eligibility rules or website restrictions. It must not declare authentication complete until the expected provider and account have been verified.

### Authentication security boundary

Secrets are processed only by the trusted authentication service or provider. They are excluded from AI prompts, page summaries, screenshots sent to the model, DOM snapshots exposed to the model, memory, logs and exported conversations.

Stored OAuth tokens and permitted browser sessions are encrypted, scoped and revocable. Users can disconnect providers, clear website sessions and terminate active browsers.

Website content is untrusted even after authentication. A malicious page cannot instruct Kova to reveal credentials or expand permissions.

## 7. Kova Work and autonomous agents

Kova Work is the multi-step execution experience.

A customer can describe an outcome rather than manually issue every individual tool command. Kova then constructs a bounded execution plan, performs authorized steps, requests approval for sensitive actions and produces a verifiable result.

The system supports task state, pause/resume, user approvals, progress history, retries, cancellation, context attachments and recoverable execution checkpoints.

For example, a Work task might research a business, produce a website audit, compile evidence into a document and prepare a message for approval. Each externally consequential action goes through the appropriate permissions.

A completed task must link to its actual output. A progress indicator cannot claim "sent," "saved," "connected" or "published" until the corresponding service confirms success.

## 8. Research, search, media, files and voice

The completed Kova platform also supports:

| Product capability | Required result                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Search             | Live web results, relevance, source attribution and links                                                     |
| Deep Research      | Multiple searches, evidence synthesis, citations and an inspectable task timeline                             |
| Images             | Generate and edit images through authorized image services                                                    |
| Vision             | Analyze supported image inputs; use an explicit auxiliary tool if the chosen text model lacks that capability |
| Files              | Upload, parse, search, convert, summarize and generate downloadable artifacts                                 |
| Code               | Structured code output, approved sandbox execution, diagnostics and artifacts                                 |
| Data analysis      | Tables, calculations, plots, spreadsheet processing and charts                                                |
| Voice              | Consumer voice input/output using configured speech providers, including the planned ElevenLabs integration   |
| Live activity      | Show true tool status, operations, approvals, failures and completion                                         |
| Sharing            | Share, revoke, export and manage access to produced content                                                   |

The system should use a shared capability registry so the UI and backend know whether a given model or tool supports vision, JSON output, streaming, file processing or another feature. Unsupported operations must be rejected or routed through a separately disclosed service, not silently simulated.

# Part II — KovaGPT API for Developers

## 9. The developer product

KovaGPT API for Developers is a paid developer platform powered by the same Kova models used inside KovaGPT.

KovaGPT Developer Platform

Build applications using Kova intelligence

Base API: `https://api.kovagpt.com/v1`

Model APIs

Agents

Browser API

Images

Files & Search

Webhooks

Developers can use Kova's capabilities in websites, applications, internal business tools, coding assistants, research products, customer-support systems and other authorized workflows.

They pay Kova for usage under Kova's commercial terms. Kova pays its underlying infrastructure and inference providers.

This is not simply exposing a third-party API key. The Kova API must own authentication, usage metering, capability validation, tool orchestration, security policies, developer billing, operational telemetry and versioned interfaces.

## 10. Official KovaGPT API endpoints

The target public API has a stable `/v1` namespace.

| Service            | Proposed public endpoint      | Function                                       |
| ------------------ | ----------------------------- | ---------------------------------------------- |
| Models             | `GET /v1/models`              | Discover Kova model IDs and capabilities       |
| Responses          | `POST /v1/responses`          | Generate structured/streamed AI responses      |
| Chat compatibility | `POST /v1/chat/completions`   | Familiar message-based generation              |
| Images             | `POST /v1/images/generations` | Generate images                                |
| Image edits        | `POST /v1/images/edits`       | Edit supported images                          |
| Embeddings         | `POST /v1/embeddings`         | Create vectors for semantic search             |
| Moderation         | `POST /v1/moderations`        | Analyze content under platform policies        |
| Files              | `/v1/files`                   | Upload, retrieve and manage files              |
| Vector stores      | `/v1/vector_stores`           | Manage retrieval-backed collections            |
| Agents             | `/v1/agents`                  | Create and configure agents                    |
| Agent runs         | `/v1/agent-runs`              | Start, inspect, pause or cancel runs           |
| Browser sessions   | `/v1/browser/sessions`        | Run authorized browser sessions                |
| Tasks              | `/v1/tasks`                   | Create and manage asynchronous/scheduled tasks |
| Containers         | `/v1/containers`              | Authorized isolated execution                  |
| Webhooks           | `/v1/webhooks`                | Configure event deliveries                     |
| Usage              | `GET /v1/usage`               | View metered usage                             |
| Limits             | `GET /v1/limits`              | Inspect applied quotas and spending limits     |

These are the final API contract targets, not claims that every endpoint already exists or is publicly available.

Each API must have a documented request/response schema, authentication scopes, rate-limit behavior, error codes and versioning policy.

Core supported functionality includes streaming events, tool calling, structured JSON outputs, asynchronous execution, request cancellation, idempotency keys and correlation IDs.

The API uses genuine Kova model identifiers rather than exposing a renamed third-party foundation as its sole identity. Documentation also accurately discloses the upstream model provenance.

### Example API usage

```
curl https://api.kovagpt.com/v1/responses \
  -H "Authorization: Bearer $KOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kova-xenon-5",
    "input": "Explain how solar panels generate electricity.",
    "stream": true
  }'
```

This is the intended public API interface. It becomes a real supported request only when the Responses endpoint and developer authentication are deployed.

The developer key stays on the customer's server. Client-side applications should use a developer-owned backend or appropriately scoped temporary credentials rather than exposing a permanent secret key.

## 11. Developer dashboard

At `kovagpt.com/developers`, a developer signs in and receives a complete workspace.

The navigation includes Overview, Projects, API Keys, Playground, Models, Agents, Files, Usage, Billing, Logs, Webhooks, Documentation and Settings.

Developer Overview

Illustrative UI

Requests

# 12,480

Usage spending

# $18.42

API success rate

# 99.8%

Active projects

# 4

Sample numbers only; not KovaGPT's live usage.

Requests by model

02,0004,0006,0008,000Argon 4.6Neon 4.6Xenon 5

Example workload, not live telemetry.

The real dashboard must support filtering by project, model, time range, status, application and API key.

Each developer can inspect requests, input/output token counts, tool usage, latency, error responses, billed amounts and remaining credits.

Logs should contain safe operational metadata by default. Raw prompts and responses are not retained or displayed indiscriminately; any optional content logging must follow explicit account-level retention and privacy settings.

## 12. API keys, projects and organizations

Each developer organization can maintain separate projects, environments, service accounts and API keys.

API keys support scoped permissions, rotation, expiration, revocation, per-key usage limits, IP restrictions where appropriate, and audit history. Secret values are displayed only through a controlled creation flow and stored as non-recoverable verifiers or equivalent secure credentials.

Developers can assign individual budgets to projects and keys so one runaway application cannot consume the entire account balance.

Organization features include role-based access, project membership, service accounts, billing administrators and separate production/staging environments.

The consumer Kova subscription must not automatically grant unlimited Developer API usage.

## 13. Developer API billing and commercial model

The developer platform uses its own commercial billing system through Stripe.

The planned default is prepaid or funded API usage, with clear metering, spending limits and optional controlled automatic top-ups where supported.

Kova's business goal is a 60% gross margin, with a 50% emergency floor. That is a pricing objective, not a guarantee that every workload will naturally meet it.

Developer rates must account for foundation-model inference, tool calls, search, images, browser compute, storage, third-party provider charges, payment fees and operational overhead as applicable.

A metering ledger must record usage reservations, actual provider consumption, billing settlement, refunds/adjustments and idempotent retry handling. No request should be double-billed after a timeout or retry.

The system must expose hard spending caps and meaningful balance alerts. It must not silently swap a user's selected model to lower cost.

### Developer billing structure

| Resource        | Billing principle                                                             |
| --------------- | ----------------------------------------------------------------------------- |
| Text generation | Metered input/output token usage                                              |
| Images          | Metered image/processing operations                                           |
| Embeddings      | Metered processed tokens                                                      |
| Search          | Metered searches or provider usage                                            |
| Browser         | Metered browser execution/resources                                           |
| Agents          | Metered underlying model and tool usage, plus any disclosed orchestration fee |
| Storage         | Published storage/retention rates where applicable                            |

Exact public API prices should be published only after verifying real provider costs and sustainable margins.

## 14. Developer agents, browser API and human authentication

Third-party developers should be able to build applications using Kova agents, including agents that browse websites or operate connected tools.

But an API key alone does not grant access to a human user's Gmail, bank account or browser session.

To act on behalf of an end user, the developer must obtain an appropriately scoped authorization. Kova then associates the agent run with that user's authorized identity and permissions.

If an agent reaches a sign-in or MFA challenge, the API returns an explicit human-intervention state and an authorized handoff session. The developer application presents the trusted login experience to the user, and the agent resumes only after a verified completion event.

The API must never expose user passwords, verification codes, OAuth refresh tokens or session cookies inside tool results.

## 15. Developer tools and ecosystem

The finished developer offering includes an API reference, interactive playground, official SDKs for common development languages, sample applications, structured schemas, versioned documentation, troubleshooting guidance and status information.

Integrations support signed webhooks, tool schemas and Custom MCP-compatible connections where appropriate.

There is a published API versioning and deprecation policy. Developers receive clear notice of breaking changes, and model aliases must not silently change foundation models.

The initial public developer platform is centered on non-voice APIs; consumer voice integration remains a separate Kova capability. Any later public realtime/voice API requires its own explicit contract, licensing and metering rather than being implied by text API access.

# Part III — Connections, Workspaces and Consumer Features

## 16. The Kova connections marketplace

Kova's Connections area shows real provider integrations with clear states: Connected, Available, Requires setup, or Coming soon.

The intended catalog includes:

| Category               | Connections                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| Productivity           | Gmail, Google Calendar, Google Drive, Notion, Calendly, Linear              |
| Microsoft              | Outlook Mail, Outlook Calendar, OneDrive, SharePoint, Teams                 |
| Development            | GitHub, Vercel, Google Cloud BigQuery                                       |
| Design and media       | Canva, Figma, Excalidraw, Gamma, HyperFrames by HeyGen                      |
| Business and analytics | Salesforce, Stripe, Mixpanel, Meltwater, S&P Global                         |
| Storage                | Box                                                                         |
| Finance-related        | Supported eToro, Interactive Brokers, Webull and other authorized providers |
| Websites               | Wix                                                                         |
| Custom                 | User-configured MCP integrations                                            |

HubSpot is excluded from the intended catalog under the previously established removal decision.

Some services require organization admin consent, provider approval, specific account types or additional eligibility. Kova must show those requirements and must not label a connector as live until real authorization and tool calls work.

Health and financial data connectors are separate sensitive integrations with tighter consent, data minimization, retention and access requirements. Native Apple/Android health features require supported native-device interfaces where a web service cannot obtain that data directly.

## 17. Projects, Library, memory and saved work

Kova includes a complete organization system.

Projects contain project-specific instructions, files, memory and related conversations. A project can be used by an assistant or an agent only within its authorized scope.

Library provides grid and list views for chats, generated images, uploaded files, documents and other saved artifacts. Search, filters, rename, share, archive, restore and delete operate consistently.

Memory summarizes useful conversational context where enabled, with privacy controls and boundaries between personal memory, project memory and temporary conversations. Temporary chats do not enter persistent conversational memory.

Sharing provides scoped links, recipients, permissions and revocation. A shared chat or artifact never exposes private project files, authentication credentials or unrelated customer data.

## 18. Scheduled tasks and persistent automation

Kova users can create schedules and recurring assistant tasks directly through chat or the Scheduled Tasks page.

A scheduled task persists its instructions, authorized scope, chosen model, attached context, next execution time, result history and notification settings.

At its scheduled time, the execution worker invokes a real AI request and any authorized tools. It records results and reports failures rather than fabricating completion.

The intended consumer active-task limits remain:

| Plan | Active scheduled tasks                                      |
| ---- | ----------------------------------------------------------- |
| Free | 2                                                           |
| Plus | 5                                                           |
| Pro  | Unlimited by count, subject to fair-use and safety controls |

"Unlimited" does not mean unlimited unmetered compute. Execution frequency, concurrency, context and expensive tool use still require sensible controls.

Scheduled browser tasks may need user reauthorization if a session expires or sensitive action is required. They should pause and notify rather than bypass authentication.

## 19. KovaGPT subscriptions and billing

Consumer KovaGPT and Developer API billing are two distinct products sharing the same customer identity system where appropriate.

### Consumer entitlements

The intended consumer plans are Free, Plus and Pro.

Free provides the cheapest Kova model and tightly metered basic features. Plus expands capability and limits. Pro offers the broadest model selection and higher allowances, subject to documented fair-use rules.

The model availability design is:

| Plan | Model access                 |
| ---- | ---------------------------- |
| Free | Argon 4.6                    |
| Plus | Argon 4.6 and Neon 4.6       |
| Pro  | All three, including Xenon 5 |

Specific prices and usage allowances are controlled by the published billing catalog and must match the actual Stripe checkout price.

The upgrade button opens the subscription plan-selection experience directly—not a confusing Settings → Billing dead end. Checkout, renewals, cancellation, subscription changes, payment failures and entitlement restoration must all function.

Developer API consumption is independently metered and funded.

# Part IV — Infrastructure, Performance and Security

## 20. Always-on AI gateway with pay-per-use model hosting

Kova uses its existing Azure deployment rather than renting three expensive dedicated GPU machines.

Always-on Kova API Gateway

Minimum one Azure replica

Kimi K3

Usage-metered inference

Llama 4 Maverick

Usage-metered inference

DeepSeek V4 Flash

Usage-metered inference

No Kova-owned GPU cold start

Streaming from hosted models

Preserves selected foundation-model identity

The gateway handles authentication, prompt construction, model routing, tool orchestration, quotas, streaming, usage accounting and safety enforcement.

The inference providers serve the model weights on their own infrastructure. Kova pays based on actual usage and does not need to keep a dedicated GPU running when traffic is absent.

Image models, browser workers and sandbox execution are separate services. They are activated or scaled based on demand.

## 21. Automatic capacity management

The final autoscaling design operates at two levels.

Immediate autoscaling reacts to current concurrent requests, queue depth, latency and errors.

Daily optimization looks at completed hourly prompt counts, recurring traffic patterns, observed peaks and actual performance to revise the permitted gateway capacity.

The initial configuration keeps at least one replica active, with a conservative upper range such as four replicas until workload measurements justify another ceiling.

Capacity decreases must be supported by several days of complete traffic evidence; stale or missing telemetry does not trigger automatic reduction.

The system cannot sacrifice model quality or silently change foundation models to reduce spending.

An Azure budget alert is not a hard spending cutoff. Kova needs independent server-side provider quotas and cost enforcement.

## 22. Reliability, latency and quality

The production platform should target at least 99.9% monthly availability, with actual uptime and exclusions measured and published appropriately.

The interface should acknowledge user requests nearly immediately. Model responses should begin streaming as quickly as the selected model and real workload permit.

A first-token target of roughly two seconds for fast everyday requests is useful, but longer reasoning and tool operations require transparent, task-specific progress. No user-visible guarantee should be made without production evidence.

Kova maintains health checks, readiness checks, request tracing, provider error monitoring, model latency measurements, quota metrics, job heartbeats, and failed-operation diagnostics.

Each deployment uses a versioned, immutable container image, a known release commit, migration compatibility checks, controlled rollout and a recoverable prior revision.

Provider failover is allowed between compatible deployments of the same foundation-model version. If that isn't possible, Kova reports an outage or asks for explicit permission to change models.

## 23. Security and privacy across the entire platform

The non-negotiable security principles are:

1. Verified authentication for protected features.
2. Minimum necessary permissions for people, services, connectors and agents.
3. Strict isolation between customers, projects, browser sessions and API organizations.
4. Credentials and secrets never included in public source, browser bundles, AI prompts or ordinary logs.
5. Server-side enforcement of all tool permissions and model entitlements.
6. User confirmation for material or irreversible actions.
7. Signed callbacks and webhooks, request integrity, replay protection and auditable authorization.
8. Prompt-injection defenses and untrusted-content boundaries for external websites and documents.
9. Configurable data retention, account export, deletion and session revocation.
10. Tested backup, restoration, monitoring, rollback and incident-response mechanisms.

For business and enterprise customers, the final platform also supports organization workspaces, role-based access, service accounts, SSO/SAML, SCIM provisioning where supported, retention controls, audit exports and enterprise policy administration.

Kova must not grant itself privileges or hide an unsuccessful security-sensitive operation.

# Part V — The Final Complete KovaGPT Product

## 24. All final application surfaces

The completed website should have consistent, functioning journeys across all of its main areas.

| Area                   | Finished experience                                                            |
| ---------------------- | ------------------------------------------------------------------------------ |
| Home                   | Clear Kova identity, composer and model selection                              |
| Chat                   | Complete intelligent conversational assistant                                  |
| Search and Research    | Real retrieval, citations and research workflows                               |
| Work and Agents        | Long-running authorized task execution                                         |
| Images                 | Image gallery, generation, editing and history                                 |
| Projects               | Instructions, files, memory and related chats                                  |
| Library                | Saved conversations, images, documents and files                               |
| Scheduled Tasks        | Creation, execution, results and limits                                        |
| Connections            | Discover, connect, authorize, manage and disconnect providers                  |
| Cloud Browser          | Live browser sessions, permissions and authentication handoffs                 |
| Developer Platform     | API keys, projects, usage, billing, documentation and playground               |
| Subscriptions          | Functional plan selection and checkout                                         |
| Settings               | Organized account, personalization, security, connections and privacy controls |
| Help and Support       | Documentation, issue reporting and account assistance                          |
| About and public pages | Modern, complete Kova-branded marketing and product information                |

The website must be fully responsive, accessible by keyboard, performant on mobile, and consistent in dark and light mode.

No visible button should be decorative when it promises a real action. No page should claim a coming-soon integration is functional.

## 25. What “100% complete” actually means

The final acceptance standard is observable functionality, not code coverage alone.

Required production acceptance contract

- All three exact Kova models respond using the correct foundations.
- Kova chat and the public Developer API both stream real results.
- Secure authentication handoffs work with real supported providers.
- Passwords, passkeys, MFA codes and session secrets stay outside AI context.
- Cloud browser performs genuine user-authorized website operations.
- Browser closes after 15 minutes idle, with no Kova-imposed absolute active-session limit.
- Search, images, tools, files and agents execute and return verifiable results.
- Intelligent Interface components render and interact correctly on desktop and mobile.
- Projects, memory, sharing, Library and scheduled tasks persist and enforce permissions.
- Available connections authenticate, execute and disconnect correctly.
- Consumer Stripe billing and separate Developer API usage billing reconcile correctly.
- Azure gateway stays available and autoscaling obeys bounded capacity and budget rules.
- Customer isolation, secret protection, moderation, logging and rollback pass security tests.
- Every advertised feature passes authenticated live acceptance testing.

This is the standard for declaring the platform finished. A feature that works only in a local mock, screenshot or GitHub test is not yet complete.

## Final goal

KovaGPT becomes a complete AI company and developer platform, powered by three locked Kova-branded foundation-model products.

A consumer can open `kovagpt.com`, select Xenon 5, Neon 4.6 or Argon 4.6, and ask Kova to answer questions, research, create, analyze, browse, connect services and execute authorized tasks. When authentication is required, Kova securely pauses, presents the genuine provider flow, protects credentials and resumes after verified completion.

A developer can open the KovaGPT Developer Platform, create a funded project and scoped API key, and integrate those same models and supported capabilities into another application using `api.kovagpt.com/v1`. Usage is transparently metered, secured and billed.

Kova's Azure gateway remains responsive. Hosted model inference avoids expensive idle GPU ownership. Browser and execution resources launch on demand. Infrastructure adjusts to real traffic without silently changing model quality. Security, account isolation, permissions and honest execution reporting are enforced throughout.

The definition of success is simple: everything KovaGPT says it can do is real, functional, secure, measurable and available to the appropriate authorized customer—both in Kova chat and through the KovaGPT Developer API.&#x20;

## Interface and billing update — November 7, 2026

This owner update supersedes the earlier chat archive, Trash, sidebar Images, and sales-only Team descriptions.

- Projects use equally rounded filters and view controls, fill the available directory width, and support persisted emoji icons, raster logos, background colors, and raster background images.
- New Scheduled Tasks use the prompt and schedule form. The saved-context and connected-source/approval sections are removed from this editor. Existing tasks retain their stored authorization and execution configuration.
- Chat archiving and Chat Trash are removed from the product. Existing archived chats return to the ordinary chat list. Confirmed deletion is permanent, including Project chats; caller permissions still apply. Deletion queues content-free sync tombstones, removes legacy device duplicates, and cannot silently restore content during a concurrent cloud edit.
- Library omits Shared chats, Folders, Chat Trash, and Details. Old folder filters are reset so they cannot conceal saved items. Search, favorites, filters, and view controls have consistent touch geometry.
- Subscription checkout and management use Stripe's full-page hosted experiences.
- Team offers direct checkout for 2–150 seats, including the owner, with Standard at $25 monthly or $240 annually and Premium at $125 monthly or $1,200 annually. Users can buy both seat types, reserve paid seats through account invitations, accept invitations, remove members, and review changes to existing seat quantities in Stripe. Team and personal subscriptions remain separate. Both seat types currently resolve to the existing Pro model-access entitlement; an unimplemented usage multiplier must not be advertised.
- Team activation requires the additive database migration, the four verified Stripe recurring prices with the lookup keys in `team-billing-policy.mjs`, and subscription/risk webhook delivery. Existing tax registrations and Stripe tax configuration must be reviewed before asserting that checkout calculates applicable tax. No source or fixture test establishes live billing acceptance.
- The Images sidebar shortcut is removed; ordinary chat retains its image tools. Continue working displays at most two actual recommendations, with rounded cards and increased spacing.
- Settings and management pages must fit narrow mobile viewports. Sync respects rate-limit backoff, reconnects on return to the page, and distinguishes session verification and revision reconciliation from offline transport errors.
