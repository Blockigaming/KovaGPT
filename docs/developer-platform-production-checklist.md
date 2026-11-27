# Developer platform production release checklist — PR #779

This is the consolidated release gate, expanding the original 50 requirements without replacing or weakening them. All items remain open until exact evidence is attached. Staged code, mocks, skipped workflows, screenshots, and documentation alone do not establish a production-ready service.

## Evidence and execution

For each requirement record implementation paths, focused test results, exact-head CI links, provider verification where applicable, database replay, authenticated UI verification where applicable, and production evidence. Distinguish implemented, locally tested, CI verified, provider verified, production verified, and blocked. Never promote an item on the strength of an unrelated check or a previous commit unless the evidence is explicitly reusable.

Work exclusively on the existing PR branch. Group related changes, preserve existing gates, and validate formatting, types, focused tests and the production bundle before pushing whenever a checkout is available. Continue independent work while CI runs rather than repeatedly canceling checks. Do not activate paid execution, mutate production balances, apply production migrations or make live test charges without the applicable approval. No unsupported or retiring upstream capability may be represented as available.

Baseline evidence: commit 253c97a failed KovaGPT CI, verify job 140701612832, at 202627 gzip bytes against the 202000 ceiling. The prepared follow-up 7d5378f is a direct descendant, containing staged background response management and replay/settlement protections. This checklist does not certify either commit. The public article catalog contains 105 total entries, including 14 developer entries; the broader developer route inventory must reconcile the required 29 baseline routes and legacy documentation before declaring coverage.

## Original 50 release requirements

- [ ] R01 — **Resolve exact-head CI failures.** Keep all existing gates, including 202000-byte main gzip ceiling; use real code splitting.
- [ ] R02 — **Responses.** Create, retrieve, cancel, background lifecycle and correct terminal settlement.
- [ ] R03 — **Chat Completions.** Document and test supported compatibility including unsupported-field errors.
- [ ] R04 — **Streaming.** SSE framing, cancellation, terminal errors, metering and disconnect recovery.
- [ ] R05 — **Structured output and function calling.** Schema validation, tool arguments, output results and capability checks.
- [ ] R06 — **Reasoning.** Supported effort discovery, validation and usage metering.
- [ ] R07 — **Conversations and persistent state.** Items, ownership, pagination, retention, compaction and token accounting.
- [ ] R08 — **Vision and documents.** Bounded inputs, formats, extraction and ownership checks.
- [ ] R09 — **Images.** Generation, edits, supported streaming, output and image-specific meters.
- [ ] R10 — **Embeddings.** Batch text inputs, dimensions, model capability and limits.
- [ ] R11 — **Audio.** Speech, transcription and translation; consent-aware voice controls.
- [ ] R12 — **Realtime.** Authorized sessions, ephemeral credentials, events and supported transport.
- [ ] R13 — **Web Search.** Sources, bounded calls, prices and provider verification.
- [ ] R14 — **Deep Research.** Durable asynchronous execution, references and cancel/retrieve.
- [ ] R15 — **Agents.** Definitions, orchestration, tools and bounded execution.
- [ ] R16 — **Agent sessions, artifacts and traces.** Persisted runs, turns, outputs and redacted traces.
- [ ] R17 — **Cloud Browser.** Isolated sessions, approved navigation and explicit access controls.
- [ ] R18 — **Computer Use.** Authorized operations, isolated execution and safety confirmations.
- [ ] R19 — **Code Interpreter and shell.** Sandbox, bounded execution, file ownership and runtime limits.
- [ ] R20 — **Containers.** Lifecycle, resource ceilings, retention and file access.
- [ ] R21 — **Decisions API.** Versioned inputs, outputs, authorization and metering.
- [ ] R22 — **Files and multipart uploads.** Upload, list, retrieve, delete, complete or cancel multipart and retention.
- [ ] R23 — **File Search.** Project-owned retrieval, filters and sources.
- [ ] R24 — **Vector Stores.** Create, index, search, file batches, retrieve and delete.
- [ ] R25 — **MCP and hosted tools.** Scoped connection grants, discovery, allowlists, invocation and revocation.
- [ ] R26 — **Moderation.** Supported categories, safe errors and documented model contracts.
- [ ] R27 — **Webhooks.** Endpoint lifecycle, signature verification, retry, rotation and delivery history.
- [ ] R28 — **Batch API.** Submission, cancellation, status, result retrieval and idempotent settlement.
- [ ] R29 — **Automations.** Scheduling, invocation history, pause, resume, cancel and ownership.
- [ ] R30 — **Skills.** Versioned bundles, scoped access, revisions and lifecycle.
- [ ] R31 — **Embedded chats.** Scoped session creation, authorized threads and safe origin handling.
- [ ] R32 — **Model catalog and pricing.** Authoritative current capabilities, eligibility, public aliases and reviewed prices.
- [ ] R33 — **Developer console.** Complete independent URL-addressable functional views listed below.
- [ ] R34 — **Organizations and permissions.** Organization, project and member lifecycle; roles and service accounts.
- [ ] R35 — **Security and data controls.** Permissions, retention, privacy, audits and secret handling.
- [ ] R36 — **Limits and alerts.** Organization, project and key quotas, concurrency, budgets and notifications.
- [ ] R37 — **Usage analytics.** Complete filtered history, time series, cost breakdowns and exports.
- [ ] R38 — **Billing and shared credits.** Separate included and purchased lots, expiry, opt-in and atomic cross-surface spending.
- [ ] R39 — **Stripe.** Verified payments, receipts, invoices, refunds, disputes and reconciliation.
- [ ] R40 — **JavaScript SDK.** Versioned package, typed methods, errors, streaming and tested examples.
- [ ] R41 — **Python SDK.** Versioned package, sync/async contracts, errors, streaming and tested examples.
- [ ] R42 — **OpenAPI.** Complete versioned request/response schemas, auth, errors and operation coverage.
- [ ] R43 — **Public developer pages.** Inventory all 29 required baseline routes; add every missing reference and guide.
- [ ] R44 — **Canonical database migrations.** Materialize staged SQL and regenerate release contracts without production writes.
- [ ] R45 — **Database replay and isolation.** Replay from supported baseline, two-principal isolation and rollback evidence.
- [ ] R46 — **Provider verification.** Verify exact supported provider contracts, prices, quotas and approved test evidence.
- [ ] R47 — **Desktop and mobile.** Real authenticated and public route checks, light/dark, keyboard and responsive behavior.
- [ ] R48 — **Final CI.** All required checks green on the exact proposed release commit; skips are not proof.
- [ ] R49 — **Production deployment.** Approved migration and revision rollout, health, release identity and rollback plan.
- [ ] R50 — **Live verification and cleanup.** Verify live routes, authorized smoke checks, traffic and safe retirement of old revisions.

## Expanded console, documentation and release coverage

- [ ] R51 — **Console overview and navigation.** Real metrics, direct URLs, deep links and responsive navigation.
- [ ] R52 — **Playground.** Text, images, audio, agents, parameters, quotes, cancellation and error states.
- [ ] R53 — **Prompts.** Create, version, retrieve, update and delete saved prompts.
- [ ] R54 — **Model views.** Search, filters, model details and live capability eligibility.
- [ ] R55 — **Agents and sessions views.** Create agents, inspect runs, turns, artifacts and traces.
- [ ] R56 — **Files and vector-store views.** Real upload, indexing, retrieval and deletion.
- [ ] R57 — **Batch and background response views.** Submission, status, cancellation, results and error handling.
- [ ] R58 — **Container and browser session views.** Lifecycle, files, ownership and cleanup.
- [ ] R59 — **Skills and integration views.** Version management, scoped connection lifecycle and tool discovery.
- [ ] R60 — **Automations and webhooks views.** Schedule, test, retry, cancel, pause, rotate and delivery history.
- [ ] R61 — **Usage, costs and logs views.** UTC time series, complete filters, pagination, redaction and exports.
- [ ] R62 — **Trace and request detail views.** Scoped access to diagnostics, service health and request identifiers.
- [ ] R63 — **Organization, projects and members views.** Roles, invitations, membership and project switching.
- [ ] R64 — **Service accounts and API keys views.** Scope, create, rotate, revoke and audit.
- [ ] R65 — **Billing views.** Balances, lots, renewal, funding, payment history, receipts and limits.
- [ ] R66 — **Security, data controls and audit views.** Real configuration, retention and audit history.
- [ ] R67 — **Developer settings.** Profile, organization settings, project policies and preferences.
- [ ] R68 — **Developer homepage.** Clear platform entry points and truthful launch status.
- [ ] R69 — **Getting started and quickstart.** Verified minimal request with authentication, quote and retry.
- [ ] R70 — **API reference by endpoint.** Every supported operation, schema, response, example and availability.
- [ ] R71 — **Model and pricing documentation.** Current capability matrix, approved pricing and metering examples.
- [ ] R72 — **Feature-specific guides.** Separate guide per API family, including lifecycle and constraints.
- [ ] R73 — **JavaScript documentation.** Installation, configuration, usage, streaming and errors.
- [ ] R74 — **Python documentation.** Installation, configuration, usage, streaming and errors.
- [ ] R75 — **Interactive examples.** Runnable examples with explicit spending confirmation and no exposed secrets.
- [ ] R76 — **Tutorials and cookbooks.** Substantive verified end-to-end integration walkthroughs.
- [ ] R77 — **Developer articles and engineering blog.** Original factual articles with accurate publication metadata.
- [ ] R78 — **Release notes.** Dated releases tied to actual deployed changes and evidence.
- [ ] R79 — **Changelog.** Version history, compatibility changes, fixes and source links.
- [ ] R80 — **Migration guides.** Supported upgrade paths, behavior changes and validation instructions.
- [ ] R81 — **Deprecation notices.** Actual lifecycle decisions, affected versions, dates and alternatives; no invented events.
- [ ] R82 — **Error codes and troubleshooting.** Real error contracts, retries, request IDs and recovery examples.
- [ ] R83 — **Authentication and permissions docs.** Scoped keys, service accounts, credential lifecycle and tenant isolation.
- [ ] R84 — **Rate-limit docs.** Actual limits, concurrency, Retry-After and budget semantics.
- [ ] R85 — **Security, privacy and retention docs.** Accurate policies and capability-specific data handling.
- [ ] R86 — **Service status.** Current measured service status with failure and unknown states; no simulated uptime.
- [ ] R87 — **Developer support and FAQ.** Real support route, actionable FAQs and incident-reporting guidance.
- [ ] R88 — **Documentation search and navigation.** Searchable content, breadcrumbs, route integrity and accessible responsive UX.
- [ ] R89 — **Route inventory and navigation tests.** Enumerate all baseline and new pages, content coverage, no broken links or duplicates.
- [ ] R90 — **Canonical contracts and documentation parity.** Cross-check route methods, schemas, SDKs, pricing and reference content.
- [ ] R91 — **Atomic admission and idempotency.** Concurrent retries, exact input, stable keys, authorization before dispatch.
- [ ] R92 — **Settlement and reconciliation.** Verified usage, uncertain outcomes, no duplicated debit, original-lot releases.
- [ ] R93 — **Credit expiry and consumer integration.** One-year purchased lots, USD 80 eligible Pro allowance, default-off consumer use; coordinate #774.
- [ ] R94 — **Refund, dispute and funding replay.** Duplicate and out-of-order event tests, reconciled balances, no live charge without approval.
- [ ] R95 — **Background workers and recovery.** Bounded queues, retries, leases, deduplication, cancellation and health.
- [ ] R96 — **Rate, resource and cost ceilings.** Server-authoritative resource and spend limits, safe failure and no unapproved cost.
- [ ] R97 — **Security and privacy qualification.** Two-account negative tests, redaction, abuse controls and isolation of consumer resources.
- [ ] R98 — **SDK and integration test matrix.** Versioned SDK parity, provider contract fixtures, supported real smoke tests.
- [ ] R99 — **Release evidence and operational runbook.** Exact SHA, build digest, migration evidence, flags, rollback and cost approvals.
- [ ] R100 — **Post-release verification.** Verify public docs, enabled features, actual billing boundaries, runtime health and incident readiness.

## Release rule

Do not merge or deploy while any mandatory gate is unverified. When a provider, commercial permission, migration authority, or real test environment is unavailable, record the exact blocker and leave the relevant item open. Do not publish fake releases, simulated customer data, placeholder pages, unsupported model claims or invented uptime. Preserve the approved shared Kova identity, pricing rules and consumer/developer separation. Deployment and live checks are sequential gates; implementation completion is not the same as live acceptance.
