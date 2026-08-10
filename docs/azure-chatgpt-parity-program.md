# KovaGPT Azure + ChatGPT parity program

Baseline date: 2026-08-10 17:31 America/New_York

## Program objective

Complete KovaGPT's production migration to Microsoft Azure while:

1. consuming zero Lovable credits;
2. minimizing fixed infrastructure and inference cost;
3. using the official OpenAI Responses API with the GPT-5.6 family;
4. reserving GPT-5.6 Sol for work that genuinely benefits from frontier reasoning;
5. matching the user-visible capability set of ChatGPT at the baseline date;
6. delivering a modern, highly polished, accessible, responsive UI/UX that is strongly familiar to ChatGPT users without copying proprietary source code, protected assets, or trademarks;
7. shipping only after security, correctness, cost, observability, and rollback gates pass.

This document is a program contract and implementation backlog. It does not authorize production deployment, real-user migration, or merging the isolated Auth rehearsal.

## Non-negotiable boundaries

- No Lovable gateway, API key, email sender, build service, runtime, or credits.
- AI generation goes only to `https://api.openai.com/v1`.
- Secrets are server-only and must never enter Vite-prefixed variables, browser bundles, logs, responses, analytics, or source control.
- Model IDs are selected server-side. A client can request a mode, never a provider model ID.
- GPT-5.6 Sol must be available for explicit Pro/deep work, but must not be the default for routine traffic.
- Production changes require a separately reviewed cutover plan and rollback path.
- The Auth rehearsal chain remains draft and isolated until its own evidence gate passes.
- The prohibited real Supabase project `mfbycmbjygcfkrsuepxf` must not be used by rehearsal tooling.

## Reviewed OpenAI model baseline

Official sources:

- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/models
- https://openai.com/api/pricing/

| Role                     | Default model            | Standard input / cached / output per 1M tokens  | Purpose                                                |
| ------------------------ | ------------------------ | ----------------------------------------------- | ------------------------------------------------------ |
| Routine chat             | `gpt-5.6-luna`           | $1.00 / $0.10 / $6.00                           | Low-latency, cost-controlled everyday work             |
| Deliberate reasoning     | `gpt-5.6-terra`          | $2.50 / $0.25 / $15.00                          | Thinking, larger analysis, multi-step work             |
| Frontier reasoning       | `gpt-5.6-sol`            | $5.00 / $0.50 / $30.00                          | Explicit Pro, deep research, hardest professional work |
| Image generation/editing | `gpt-image-2`            | Metered by text/image tokens and output quality | Current image generation and editing                   |
| Embeddings               | `text-embedding-3-small` | Catalog-controlled                              | Retrieval and project knowledge                        |

All GPT-5.6 text variants have a 1,050,000-token context window, a 128,000-token maximum output, image input, tool support through the Responses API, and reasoning efforts `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Requests above the documented long-context threshold must receive the correct cost multiplier in preflight and final accounting.

## Cost-first routing contract

| Kova mode  | Model role | Reasoning effort | Default output cap |
| ---------- | ---------- | ---------------- | ------------------ |
| Instant    | Luna       | `none`           | 700                |
| Medium     | Luna       | `low`            | 1,600              |
| Thinking   | Terra      | `medium`         | 3,000              |
| High       | Terra      | `high`           | 4,000              |
| Extra high | Sol        | `xhigh`          | 6,000              |
| Pro        | Sol        | `max`            | 8,000              |

Additional controls:

- Utility calls such as titles, classification, summaries, query generation, and formatting use Luna with a 256-token cap.
- Sol is never selected automatically for ordinary free or Plus chat.
- Long context, tool hops, and output ceilings must be included in maximum-cost reservation before provider execution.
- A request that exceeds the configured budget fails closed before provider use.
- Idempotency and distributed generation leases remain mandatory.
- Cacheable stable prefixes should be ordered consistently to maximize prompt-cache reuse.
- Batch processing should be used for non-interactive maintenance work when operationally appropriate.

## Target Azure architecture

### Production request path

1. Azure Front Door or the lowest-cost approved ingress layer terminates public traffic and provides WAF/rate-limiting where needed.
2. Azure Container Apps hosts the TanStack application image from Azure Container Registry.
3. A separate Container Apps worker handles scheduled/background jobs so web replicas do not perform unattended work.
4. Direct OpenAI Responses API calls originate from Azure compute using a server-only `OPENAI_API_KEY`.
5. Existing Supabase Auth/Postgres remains the application data plane until a separate database migration is approved. Moving the app to Azure does not by itself authorize replacing or modifying production Supabase.
6. Azure Key Vault becomes the preferred production secret source. Container App secret references may be retained during a staged transition.
7. Azure Monitor / Application Insights receives structured redacted operational telemetry, not prompts, messages, secrets, OAuth tokens, or file contents.
8. User files use a reviewed private object-storage path with short-lived access. Migration to Azure Blob Storage is a separate controlled phase if it lowers cost and risk.

### Environment isolation

- production app: independently gated and never modified by rehearsal commands;
- disposable Auth rehearsal app: isolated, single replica, ingress disabled except during an explicitly guarded request;
- preview/staging app: synthetic or test accounts only;
- background worker: no public ingress;
- secrets and managed identities scoped to the minimum resource and operation.

## Zero-Lovable exit checklist

- [x] AI provider adapter locked to official OpenAI base URL.
- [x] Provider model IDs pass through as official OpenAI IDs.
- [x] Lovable AI gateway key and model translation removed from the runtime adapter.
- [x] Credit-consuming legacy Lovable email webhook/queue/send routes return `410 Gone`.
- [x] Environment template contains no Lovable credential.
- [ ] Remove `@lovable.dev/email-js` and `@lovable.dev/webhooks-js` from `package.json` and regenerate `package-lock.json` with the repository's locked npm version.
- [ ] Remove or rename all remaining legacy `/lovable/*` route surfaces after confirming no external caller depends on them.
- [ ] Replace transactional/auth email delivery with an Azure-native or direct low-cost provider after deliverability, DKIM/SPF/DMARC, retry, suppression, and webhook security review.
- [ ] Add a release gate that rejects `LOVABLE_`, `@lovable.dev`, and `lovable.dev` in executable runtime paths and deployment settings.
- [ ] Verify production Container App has no Lovable environment variable, secret reference, DNS dependency, or outbound call.

## ChatGPT capability parity matrix

Official capability baseline:

- https://help.openai.com/en/articles/9260256-chatgpt-capabilities-overview
- https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt

Status terms:

- **Present**: a meaningful implementation exists in the repository.
- **Partial**: foundation exists, but behavior, UX, reliability, or scope is below the baseline.
- **Missing**: no production-quality equivalent is proven.
- **Verify**: code appears to exist but requires an authenticated end-to-end test.

| Capability                     | Current assessment                                               | Required acceptance evidence                                                                         |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| General chat and streaming     | Present                                                          | Correct SSE completion, stop/regenerate/edit, recovery after network interruption                    |
| GPT-5.6 model/mode selector    | Partial                                                          | Luna/Terra/Sol routing, all six reasoning efforts, entitlement enforcement, transparent UX           |
| Web search with citations      | Partial                                                          | Fresh search, source cards, inline citations, safe fallback, date-sensitive regression suite         |
| Deep research                  | Partial                                                          | Editable plan, progress, mid-run steering, source controls, full-screen cited report, persistence    |
| Image understanding            | Present/Verify                                                   | Multiple images, screenshot/chart interpretation, privacy-safe upload path                           |
| Image generation               | Partial                                                          | GPT Image 2 generation, editing, variation, transparent progress, library persistence                |
| Document/file uploads          | Partial                                                          | PDF, DOCX, PPTX, text, image, CSV/XLSX support, extraction quality, secure storage, reuse            |
| File Library                   | Partial                                                          | Automatic save, search/filter, previews, reuse in chat/project, deletion/export, quotas              |
| Data analysis/code interpreter | Missing/Partial                                                  | Isolated code execution, Python packages, files in/out, charts/tables, resource limits, audit trail  |
| Canvas                         | Missing/Partial                                                  | Side-by-side document/code workspace, inline edits, version history, apply/revert/download           |
| Memory                         | Partial                                                          | Saved memories, chat-history reference, user controls, temporary chat exclusion, deletion proof      |
| Projects                       | Partial                                                          | Chats/files/instructions/memory, sharing, roles, tool availability, project search and export        |
| Scheduled tasks/monitoring     | Partial                                                          | One-time/recurring/monitoring jobs, hourly floor, next-run UI, pause/edit/delete, useful-only alerts |
| Apps/plugins/connectors        | Partial                                                          | Directory, permission model, search/read/write capabilities, confirmation before external actions    |
| MCP/custom apps                | Missing/Partial                                                  | Remote MCP registration, tool discovery, consent, admin controls, safe execution and revocation      |
| Custom GPT equivalents         | Missing                                                          | Builder, instructions, knowledge, tool selection, sharing, versioning, moderation, directory         |
| GPT/plugin directory           | Missing                                                          | Discover/install/uninstall, ratings or trust metadata, permissions, dependency management            |
| Voice                          | Missing by prior product choice; new parity goal requires review | Realtime voice, transcript, interruption, voice picker, privacy, accessibility, cost controls        |
| Work/agent mode                | Missing/Partial                                                  | Long-running task plan, progress, checkpoints, connected apps, artifacts, approvals, continuation    |
| Computer use                   | Missing                                                          | Isolated browser, screenshots/actions, domain policy, confirmation, secrets boundary, audit logs     |
| Shopping/product cards         | Missing/Partial                                                  | Current products, comparison, images, price/source provenance, refinements, no fabricated inventory  |
| Rich visual answers            | Partial                                                          | Cards, tables, charts, maps/media where justified, responsive and accessible presentation            |
| Sharing                        | Partial                                                          | Public/private links, revocation, redaction, project sharing, permission and abuse controls          |
| Search/history/recents         | Partial                                                          | Fast full-text search, grouping, pin/archive/delete, unified recents, keyboard navigation            |
| Temporary chat                 | Verify                                                           | No durable memory/history side effects, clear UI state, deletion semantics                           |
| Notifications                  | Partial                                                          | Web/email/push policy, task notifications, user controls, deduplication and quiet hours              |
| Account/settings/billing       | Partial                                                          | Full preference, privacy, security, data export/delete, subscription, usage, invoice, failure states |
| Mobile/responsive/PWA          | Partial                                                          | 320px+ matrix, safe areas, keyboard/composer, drawers, touch targets, offline/reconnect behavior     |
| Accessibility                  | Partial                                                          | WCAG 2.2 AA target, keyboard-only, focus, screen reader, reduced motion, contrast, zoom              |

## UI/UX parity contract

The goal is functional familiarity and equivalent quality, not unauthorized copying.

Required qualities:

- coherent 4px spacing system, consistent radii, typography, icon sizing, and elevation;
- responsive sidebar/rail, unified recents, project navigation, pinned/search states;
- composer with attachment/tool controls, model/mode state, stop/send behavior, auto-grow, drag/drop, paste;
- smooth streaming, scroll anchoring, status transitions, tool activity, citations, code blocks, tables, files, and artifacts;
- clear empty, loading, offline, retry, quota, authorization, maintenance, and partial-success states;
- light/dark/system themes without hydration flash;
- no layout shift from fonts, toolbars, citations, attachments, or long responses;
- no fake controls, placeholder capabilities, or success states unsupported by server evidence;
- deterministic visual regression coverage for desktop, tablet, and mobile, including reduced motion and zoom.

## Delivery phases

### Phase 0 - foundations and truth

- lock official OpenAI-only runtime;
- correct GPT-5.6 pricing, context, reasoning, and long-context accounting;
- retire credit-consuming Lovable routes;
- publish this capability matrix and create tracked workstreams;
- make current CI green or explicitly classify pre-existing failures.

### Phase 1 - Azure staging

- build immutable image from reviewed SHA;
- deploy staging Container App and worker using managed identity and ACR;
- configure secrets without printing values;
- run health, auth, chat, file, image, search, and billing smoke tests;
- establish logs, metrics, alerts, budgets, and rollback.

### Phase 2 - Auth migration rehearsal

- complete the existing disposable strict database probe;
- diagnose TLS/network/authentication without weakening verification;
- execute one fresh synthetic request only after the gate passes;
- preserve exact evidence and keep production untouched.

### Phase 3 - capability convergence

- data analysis/code interpreter;
- Canvas/artifact workspace;
- File Library and project parity;
- reliable scheduled tasks and Work-style agent execution;
- plugin/app/MCP directory and permission system;
- voice and computer-use review/implementation;
- shopping and rich visual responses.

### Phase 4 - UI/UX convergence

- component/token audit;
- composer/sidebar/top-bar/settings/project/library/task surfaces;
- interaction, animation, responsive, accessibility, and visual regression passes;
- authenticated end-to-end parity matrix.

### Phase 5 - production cutover

- freeze reviewed release SHA and immutable image digest;
- export configuration inventory and verify no Lovable dependency;
- database and Auth migration according to approved evidence;
- canary traffic, synthetic checks, rollback rehearsal, then controlled promotion;
- post-cutover verification and cost review.

## Production release gates

A release is blocked unless all applicable gates pass:

1. `npm ci`, formatting, lint, typecheck, unit, API, integration, browser, accessibility, and production build.
2. No critical/high dependency or application security finding.
3. No executable Lovable reference or deployment setting.
4. All configured model IDs exist in the reviewed catalog.
5. Maximum and actual cost accounting agree with test vectors, including long context and tool hops.
6. No provider key or user content appears in client bundles, logs, source maps, analytics, or error responses.
7. Auth and storage RLS/authorization tests pass with two-user isolation.
8. Every visible capability has a real server implementation and a failure state.
9. Azure staging smoke suite passes against the immutable image.
10. Database migration evidence and rollback are independently verified.
11. Core Web Vitals, accessibility, mobile, and visual regression budgets pass.
12. Owner explicitly approves production promotion.

## Definition of complete

The program is complete only when:

- `kovagpt.com` is served from the approved Azure production architecture;
- no request can consume Lovable credits;
- GPT-5.6 Sol is available and verified for explicit frontier/deep work;
- cost-aware Luna/Terra/Sol routing and accounting are proven in production telemetry;
- every baseline ChatGPT capability is implemented, deliberately excluded with an approved reason, or unavailable due to a documented platform/legal constraint;
- the parity matrix is backed by automated and manual evidence;
- no known critical/high bug remains;
- the UI is modern, responsive, accessible, consistent, and independently implemented;
- production migration and rollback evidence are archived without secrets or private user content.
