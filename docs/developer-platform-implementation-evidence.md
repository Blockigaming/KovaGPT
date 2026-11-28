# Developer platform implementation evidence — PR #779

Updated for error and rate-limit contracts on base dfb196cb9795e04c44df77b7468039458a4bedcb, 2026-11-28. This is a living evidence record, not a replacement for the [frozen 100 requirements](developer-platform-production-checklist.md). Update affected rows after every implementation batch; preserve prior relevant test evidence and its commit. Never mark a production gate accepted without exact supporting evidence.

Implementation: I = supported source implementation covers the named requirement, P = partial, M = missing core implementation or not performed gate. Verification: T = targeted tests demonstrate the core requirement, F = narrower focused evidence or existing regression fixtures (not a full requirement-level pass), C = prior CI verified, N = verification not established. Counts classify source coverage, not production readiness. Provider and browser qualification remain separate. R44 is the sole formally accepted checklist item; its prior accepted replay is not exact-head qualification. Tests can overlap across rows. N does not mean no test exists.

## Counts

- Implemented: 34; partial: 58; missing: 8. Total 100.
- Verification: 18 targeted requirement-level tested; 1 prior CI verified; 66 narrower evidence; 15 unverified. Total 100.
- Formally accepted: 1/100. No production activation.

## Reusable evidence

- Error and rate-limit contracts: 103 focused Node tests and 39 Python SDK tests passed. Stable sanitized error mapping, distributed limiter exhaustion vs outage, conservative REST Retry-After, both SDKs expose delay without automatic paid retry, documented source ceilings and recovery examples. Funding driver fixture needs the unavailable Stripe package; full CI pending. R82/R84 source coverage. No provider calls or spending.

- Model discovery and usage: 26 focused Node tests passed; TS/TSX syntax transpilation passed. Project-key-scoped model eligibility replaces static consumer labels; filter by capability and search aliases, inspect contract features. Every existing authoritative public meter appears in filtered summaries and CSV, with zero distinguished from unmeasured and independent currency totals. R37/R54/R61 source coverage; authenticated browser/build qualification and full CI pending. No provider calls or spending.

- Resumable uploads: dedicated bounded byte-chunk lifecycle, SHA-256 and UTF-8 validation, idempotent completion into the existing private-file quota, cancellation erasure, one-hour expiry and maintenance, scoped SDK and console operations. 48 focused Node checks, one PGlite lifecycle test, 37 Python SDK tests and 12 canonical-history/migration checks passed; database references verified. Canonical version uses observed UTC time; full isolated Supabase replay and browser qualification remain pending. Upload gates remain off.

- Saved prompts: exact-head source bundle and pinned offline test kit recovered and checksum-verified. Dedicated versioned SQL resource, project/key fences, structured console controls, JS and sync/async Python SDK, OpenAPI and public guide. 63 Node tests (including 13 PostgreSQL fixture tests), 35 Python SDK tests, 12 canonical-history and migration inventory tests passed; expanded cross-project and erasure fixture rerun passed. Canonical SQL version uses the observed UTC clock; exact migration replay in full isolated Supabase and browser qualification still pending. Both activation flags remain off.

- Isolated analysis cleanup hardening on c7e0ca4: 5 focused Node tests passed using copied policy and fixture files, not a full repository checkout. Rejected/incomplete receipts now attempt bounded cleanup of up to two distinct typed provider container IDs, including when one deletion fails. No persistent reuse, guaranteed recovery of IDs missing from provider responses, or provider billing/cleanup qualification is claimed.

- 0d29ecc: snapshot-bound Computer Use, 20 focused tests passing.
- e7c5c78: bounded autonomous research; 103 Node, 32 Python, 11 canonical-history tests passing.
- Reviewed outbound MCP delegation: 67 focused Node, 33 Python, 11 canonical-history tests passing, including authorization fences, revoked access and redacted mock dispatch. No live third-party calls; schema and provider flags remain off.

- [8c14be3 isolated replay](https://github.com/Blockigaming/KovaGPT/actions/runs/46067432818) and [be68daf isolated replay](https://github.com/Blockigaming/KovaGPT/actions/runs/46070676725): prior successful migration workflows. Replay must be repeated for changed schema, not merely new SDK edits.
- 016b836: multipart and strict file requests; 29 Node / 16 Python passing.
- cb18641: async SDK, 24 Python passing. 43a29aa: searchable reference and guides; 25 existing endpoints and 25 guides at that time.
- dc071f1: vector batch/queued search/analysis, 58 Node / 25 Python passing.
- d1e5243: structured background Responses and agent sessions, 42 Node passing.
- be68daf: research runs, 51 Node / 26 Python passing.
- 8fec7aa: speech, 32 Node / 27 Python passing. 65996f1: 11 MCP/OAuth tests passing.
- 095b037: file-backed analysis, 54 Node / 28 Python passing. 1c3632e: OpenAPI and reference, 5 tests passing.
- d6de895: 46 Node tests passing (developer-browser-policy, developer-metering, developer-platform-ingress, developer-openapi, developer-reference).
- f9a4323: 26 Node SDK tests and 29 Python SDK tests passing (developer-sdk.test.mjs and sdk/python unittest suite).
- Latest MCP batch: 31 focused Node tests passing (MCP, MCP files, OAuth transport, developer platform ingress and file search); shared scope and rate checks, revoked-scope denial and redacted terminal errors.
- Native Realtime batch: 80 focused Node tests and 11 database/canonical tests passed; final SDK/contract regression subset 35 Node tests passed; Python SDK 30 tests passed. No live provider calls. Canonical history forward-extension inventory now pins exact new migration hashes; immutable historical proposal rejection test passed.
- Realtime session lifecycle: 43 focused protocol, SDK, contract and canonical migration tests; 14 session/database tests (3 protocol tests overlap); 30 Python tests; immutable historical proposal rejection passed. Exact runtime build and provider smoke test pending.
- Native translation: 53 focused Node tests, 32 route/ingress/identity tests and 31 Python tests passed; fixture-only provider transport. Translation usage derives from submitted frames after graceful close, not a provider invoice. Activation requires explicit approved accounting and provider validation.
- Interactive Browser and approved viewport actions: 82 focused Node tests, 13 database/canonical tests, 31 Python tests and immutable historical proposal rejection test passed. No real Browserbase sessions or full runtime build executed.
- Snapshot-bound Computer Use: 20 focused Node tests passed across proposal mapping, exact quote/action approval, replay and revocation, session transport, API policy, OpenAPI and reference. Provider execution and full runtime qualification remain separate.
- Tests listed without a pass count identify existing regression fixtures, not an assertion that every fixture was rerun on this snapshot. No real paid provider calls were made. Superseded 1c3632e full CI canceled; f9a4323 workflows had not registered at observation.

## Requirement ledger

<!-- prettier-ignore -->
| ID | Source | Verification | Evidence and remaining gap |
| --- | --- | --- | --- |
| R01 | P | F | Lazy catalog splitting (33ee41e); latest full build not qualified, keep 202000-byte gzip ceiling. |
| R02 | I | F | responses and response-jobs routes; d1e5243; response-jobs-migration and batch-policy tests. Retrieval/cancel apply to background jobs. |
| R03 | I | T | chat/completions, developer-chat-compat, developer-platform-ingress; d6de895 focused suite passed compatibility quote and rejection cases. |
| R04 | P | F | SSE SDK and playground stream support; complete disconnect/recovery matrix pending. |
| R05 | I | T | developer-responses-policy and ingress; d1e5243 and d6de895 bind schemas, function arguments/results, scopes. |
| R06 | P | F | Reasoning controls in Responses and quote validation; complete live effort eligibility/usage qualification pending. |
| R07 | P | F | Conversations, revision fences and retention tested in files-migration; compaction and complete token accounting pending. |
| R08 | P | F | Owned text attachments and bounded images exist; general document extraction and format coverage incomplete. |
| R09 | P | F | Generation and edit policies/meters exist; model-specific streaming not complete. |
| R10 | I | F | Embeddings route, bounded batch inputs and dimension checks; dc071f1 SDK/policy tests. |
| R11 | I | T | Bounded native speech, transcription and audio translation with scoped access, preapproved synthetic voice (no cloning), permission notice, exact-frame duration quote, graceful-close accounting and failure settlement. Live provider validation and owner approval of translation accounting remain activation gates; no live provider invoice receipt. |
| R12 | I | T | Native provider turns plus authenticated multi-turn WebSocket session gateway, durable single-redemption credentials, project/key fences, up to eight independently quoted turns, provisional events, cancellation/expiry and cleanup, JS socket client, Python grant lifecycle, Playground and OpenAPI. Provider socket is per turn; continuous microphone streaming and persistent upstream conversation state are not supported. Real Nitro socket and provider qualification remain release gates. |
| R13 | I | F | Search route, bounded calls, source receipts and metering; dc071f1 queue tests. Provider verification remains open separately. |
| R14 | I | T | Durable autonomous research: one exact signed research search with 2–3 native tool calls, provider-selected queries and synthesis, fixed output/token/search ceilings, isolated worker claim, settled citation projection, cancellation/lease revalidation, JS and Python quote-only preparation, console and OpenAPI. Existing reviewed 2–4 search mode retained. Provider qualification remains external; no unlimited research or dedicated long-running provider model. 103 Node + 32 Python + 11 canonical-history tests pass. |
| R15 | P | F | Versioned agents and explicit revision-bound turns, d1e5243; orchestration and hosted tool lifecycle incomplete. |
| R16 | P | F | Persistent conversations and agent turns; full artifacts and redacted traces missing. |
| R17 | I | T | Bounded interactive isolated Browserbase sessions with separate one-use project grants, approved same-origin navigation/link clicks/viewport actions, snapshot fences, quote-bound 60-second provider budget, cancellation and expiry, JS client, Playground, OpenAPI and Python grant lifecycle. No arbitrary scripts, form submission or authenticated browsing; provider/runtime qualification remains pending. |
| R18 | I | T | Isolated browser Computer Use with server-owned snapshot conversion, separate maximum-price proposal quote, one metered proposal dispatch, exact model-proposed action and second human confirmation, scope rechecks, stale/replay rejection and cancellation. JS socket and Playground controls; supported link clicks, scroll, wait and screenshot only. Broader desktop GUI, arbitrary input and write operations are not enabled. Provider/runtime validation remains a release gate. |
| R19 | P | F | 095b037 file-backed isolated analysis; bounded cleanup of identified containers on rejected receipts; persistent files, durable cleanup recovery and hosted shell not complete. |
| R20 | M | N | No public persistent container lifecycle. Provider containers refresh idle expiry on access and current pricing is duration-based with a five-minute minimum. Existing fixed isolated invocation meter cannot authorize indefinite reuse. Need approved time-based price contract and authoritative billed-duration/cleanup receipts (or separately approved hard-lifetime runner infrastructure). See https://developers.openai.com/api/docs/guides/tools-code-interpreter and https://openai.com/api/pricing/. |
| R21 | I | F | Decisions route and bounded typed receipts, developer-decisions-policy; dc071f1 queued policy and SDK tests. |
| R22 | I | T | 016b836 multipart form upload and private text file CRUD/retention; bounded resumable byte uploads now support create, append, list, retrieve, digest-verified completion, cancellation, quota and expiry. Focused policy, database, SDK and console tests passed. |
| R23 | I | F | file-search, developer-file-search-policy and project file ownership; scoped text retrieval with sources. |
| R24 | I | T | dc071f1 atomic vector upsert batches, CRUD, cosine retrieval and rollback; vector-policy and files-migration. |
| R25 | I | T | Owner-delegated reviewed MCP read grants (up to 24h), key/project/credential/config binding, discovery, approval, invocation, revocation, SDK/console/API and hosted tools. Database and mocked dispatch tests pass; approved live server/provider qualification pending. No arbitrary servers or writes. |
| R26 | I | F | moderations route and developer-moderation-policy; dc071f1 bounded queued invocation support. |
| R27 | I | F | Webhook endpoint CRUD, signing, rotation, history and retries; 8c14be3 replay and webhook/worker tests. |
| R28 | I | T | Batch API, cancellation, leases, results and settlement; dc071f1, be68daf batch-policy and response-jobs-migration. |
| R29 | I | F | Finite scheduled invocations, pause/resume/cancel, history; dc071f1 scheduled search/analysis, files-migration. |
| R30 | I | F | Versioned scoped skills and immutable revisions; files-migration and skill-policy; 8c14be3 replay. |
| R31 | M | N | No public embedded developer chat sessions/origin lifecycle. |
| R32 | P | F | Scoped approved model catalog and price contracts; real provider approval and final eligibility incomplete. |
| R33 | P | F | developers.console and resource panels; missing independent views below. |
| R34 | P | F | Owner/project/key management in workspace v2; organization membership, invitations and service accounts incomplete. |
| R35 | P | F | Scope and retention guards; complete audit/privacy configuration incomplete. |
| R36 | P | F | Budget and concurrency limits; full notification/alert lifecycle incomplete. |
| R37 | I | T | Owner-scoped UTC/account/project/key/model/service/status filters, stable bounded pages and complete observed range summary/export, independent currency totals, all existing authoritative usage dimensions, daily/model/service/status cost breakdowns. Focused summary tests passed; browser and live qualification pending. |
| R38 | P | F | Credit lots, expiry and wallet controls; legacy reconciliation and consumer integration remain gated. |
| R39 | P | F | Funding/payment event handling; live receipts, refunds/disputes and reconciliation not fully qualified. |
| R40 | P | F | Versioned JS package, declarations and streaming; f9a4323 26 SDK tests. Missing families still lack SDK parity. |
| R41 | P | F | Versioned Python sync/async package; f9a4323 29 tests. Missing families still lack SDK parity. |
| R42 | P | F | 1c3632e OpenAPI for 27 current routes; d6de895 updated browser contract; method/status-specific agent, skill, conversation, vector-store, webhook and response-job response contracts with three focused schema assertions executed in isolated JS. Remaining response schemas and missing route parity pending. |
| R43 | P | F | 43a29aa searchable reference and guides; 29 baseline routes and full content inventory not reconciled. |
| R44 | I | C | Accepted on frozen checklist; 8c14be3 isolated migration run 46067432818 and be68daf run 46070676725; current branch SQL unchanged since successful be68daf replay except speech scope migration, which needs exact-head qualification. |
| R45 | P | F | Isolated replay passed be68daf; two-principal fixtures exist; exact current schema replay and rollback evidence incomplete. |
| R46 | P | F | Bounded provider adapters and mocked receipts; approved live provider prices, quotas and real smoke tests outstanding. |
| R47 | P | N | Responsive console components exist; real authenticated light/dark mobile/desktop qualification incomplete. |
| R48 | M | N | No full exact-head green evidence; superseded 1c3632e CI canceled. |
| R49 | M | N | No approved production migration or rollout executed. |
| R50 | M | N | No approved live verification or revision retirement executed. |
| R51 | P | F | Console overview and navigation exist; complete URL-addressable section and real metric qualification pending. |
| R52 | P | F | Playground supports text, images, audio, isolated analysis and browser; agent/session UX and full browser checks incomplete. |
| R53 | I | T | Dedicated project-scoped saved prompts with immutable revision create/update/retrieve/list/delete, bounded text and owner quotas, exact retry/revision fences, structured console view, JS and sync/async Python SDK, OpenAPI, public guide and export/erasure. Local PostgreSQL fixture and SDK/console tests passed. Full replay and browser qualification remain release gates. |
| R54 | I | T | Actual selected-project bearer model discovery, bounded response, alias search, capability filter, reasoning/image/search detail, loading/error/empty states and pricing version. No static eligibility claims. Policy fixtures passed; authenticated browser qualification pending. |
| R55 | P | F | Agent definitions and session-bound turns; run/artifact/trace viewer incomplete. |
| R56 | I | F | DeveloperFilesPanel and vector-store resource CRUD/index controls; dc071f1 and resource-console tests. |
| R57 | I | F | Batch/background Responses resource controls with explicit quote submission, status and cancellation; d1e5243 console/policy tests. |
| R58 | P | F | Browser Playground and analysis exist; no persistent container/browser lifecycle UI. |
| R59 | P | F | Skills controls and DeveloperMcpAccess; full outbound connection management/discovery missing. |
| R60 | P | F | Automation and webhook resource controls; complete retry/delivery management UX pending. |
| R61 | I | T | Owner-scoped UTC time series, account/project/key/model/service/status filters, pagination, redacted rows, independently measured totals for all existing meters, complete filtered CSV including isolated container/browser counts. Focused analytics tests passed; browser qualification pending. |
| R62 | P | F | Request detail ownership check; full redacted trace/health diagnostics missing. |
| R63 | P | F | Project selection and owner controls; full organization/member invitation and role management missing. |
| R64 | P | F | Scoped developer keys and rotation/revocation; service accounts and audit views incomplete. |
| R65 | P | F | DeveloperCreditWallet and DeveloperFundingPanel; complete renewal/payment history and receipt experience pending. |
| R66 | P | F | Security and scope enforcement exists; comprehensive configuration and audit history views missing. |
| R67 | P | F | Workspace settings/limits; full organization policies/preferences view missing. |
| R68 | I | N | developers.index source and truthful preview entry links; full browser evidence not recorded. |
| R69 | P | F | Quickstart guide and SDK quote flow exist; live minimal request verification not authorized. |
| R70 | P | F | 27 route reference and OpenAPI checks; complete per-operation examples/schemas/availability pending. |
| R71 | P | F | Pricing route and approved model discovery; complete live matrix and verified pricing examples pending. |
| R72 | P | F | 25 guides in 43a29aa; full lifecycle guides for missing families not complete. |
| R73 | I | F | sdk/javascript README/package/stream and errors documentation; current API support only. |
| R74 | I | F | sdk/python README/package/async streaming and errors documentation; current API support only. |
| R75 | P | F | Playground explicit quote confirmation and SDK examples; complete interactive example matrix missing. |
| R76 | P | F | Reference guides and SDK examples exist; substantive verified end-to-end cookbook coverage incomplete. |
| R77 | P | N | Public article catalog exists; developer engineering publication coverage incomplete. |
| R78 | M | N | No verified deployed release to attach dated notes; do not invent launch. |
| R79 | P | N | Changelog content exists; complete version history and source links incomplete. |
| R80 | P | N | Migration guidance exists; all supported upgrade paths and validation missing. |
| R81 | P | N | Lifecycle guidance exists; verified complete deprecation notices not established. |
| R82 | I | T | Sanitized public error mapping, SDK retry metadata, documented status/code and request-ID recovery examples; focused ingress and SDK tests. |
| R83 | P | F | Key/MCP OAuth docs and tenant boundaries; service-account lifecycle absent. |
| R84 | I | T | Source-backed service and concurrency matrix, budget/quote semantics, fail-closed rate limits and Retry-After in REST/OpenAPI and SDKs; focused tests. |
| R85 | P | F | Private files and scope/retention docs; complete capability-specific privacy/security disclosures pending. |
| R86 | M | N | No verified measured developer service-status surface. |
| R87 | P | N | Support entry and FAQ content exist; complete actionable developer incident-reporting guidance pending. |
| R88 | P | F | Searchable references implemented 43a29aa; breadcrumbs/accessibility and full browser validation incomplete. |
| R89 | P | F | developer-reference and OpenAPI route tests; frozen 29-baseline inventory plus expanded navigation still incomplete. |
| R90 | P | F | 1c3632e contract/SDK checks and d6de895 schema sync; full pricing/method/schema/doc parity pending. |
| R91 | I | T | Signed quote, exact input, idempotency and admission locks; d6de895 ingress and prior replay fixtures. |
| R92 | I | F | Metered settlement, uncertain states and original-lot accounting; 8c14be3 and be68daf queue/accounting regressions. |
| R93 | P | F | Purchased expiry and eligible Pro lot implementation; #774 shared consumer integration and reconciliation pending. |
| R94 | P | F | Funding migration/policy tests exist; full refund/dispute out-of-order reconciliation evidence outstanding. |
| R95 | P | F | Worker leases, deduplication, cancellation and recovery tests; complete worker health/live readiness incomplete. |
| R96 | P | F | Bounded request, quote, quota and meter controls; missing resource families and live ceilings not qualified. |
| R97 | P | F | Two-principal DB and ingress tests; full cross-surface privacy and abuse qualification incomplete. |
| R98 | P | F | SDK suites and provider fixtures; complete parity and authorized real smoke tests pending. |
| R99 | P | F | Source artifact and isolated migration evidence; exact release SHA/build digest/rollback/flag approval evidence incomplete. |
| R100 | M | N | No production release; post-release checks must follow explicit authorization. |

## External gates

Real provider pricing/credentials/contract receipts and approved smoke-test budget (R46); legacy credit reconciliation and consumer #774 integration (R38/R93); real authenticated browser qualification (R47); exact-head CI and build digest (R01/R48/R99); explicit deployment/production migration authorization and subsequent live verification (R49/R50/R100). Do not treat any of these as permission to bypass controls. Native realtime and persistent provider resources require enforceable server-side metering, scoped session ownership and cleanup before activation.
