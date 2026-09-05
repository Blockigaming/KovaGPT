# Remaining ChatGPT gaps

Last audited: 2026-09-04. This is a product-truth ledger, not a parity marketing claim. The audit covers desktop, tablet, mobile, Chat, Projects, Memory, Library, Search, Canvas/Artifacts, Writing, Images, Files, Apps, Scheduled Tasks, Research, Work, Prompt Studio, Knowledge Graph, Workspace Intelligence, Settings, sharing, streaming, branching, and model selection.

## A — Fully implementable now

The implementable truthfulness gaps found during this checkpoint were completed; the larger
source work still required for current Work parity is recorded in section B:

| Closed gap                                                             | Implementation                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No factual cross-product activity replay on Home                       | Workspace Timeline provides 7/30/90-day activity replay and transparent counts from authorized workspace signals.                                                                                                                              |
| Library required repetitive one-item operations                        | Grid and list views now support multi-select, bulk favorite, bulk delete, and bulk Context Pack creation.                                                                                                                                      |
| Files required repetitive one-item context selection                   | Files now support multi-select and one-action Context Pack creation.                                                                                                                                                                           |
| Context Pack handoff accepted one queued resource                      | Handoffs now deduplicate and transfer up to the server-validated 30-item pack limit.                                                                                                                                                           |
| Some saved resources required navigating through multiple destinations | Files, Library items, memories, artifacts, and packs have truthful direct Work, Research, and Context Pack handoffs.                                                                                                                           |
| Recents and Home used different activity inventories                   | Both consume the same authenticated workspace intelligence index; local-only chats and Work sessions are labeled and merged once.                                                                                                              |
| Project/Work/Research/Automation context was siloed                    | Existing workspaces now show explicitly related or type-filtered authorized resources.                                                                                                                                                         |
| Lockdown Mode lacked a server-enforced account policy                  | Audited persistence and fail-closed guards cover web/research, local weather, agents, connectors, OAuth callbacks and remote downloads; Canvas previews are network-isolated.                                                                  |
| Library lacked durable folders and atomic bulk organization            | Owner-scoped nested folders, cycle/depth guards, data-preserving deletion, service-only transactional bulk move, rate-limited APIs, RLS, and audit events are source-complete; production migration and browser evidence remain.               |
| Work tasks, templates, agent drafts, and Recents had no sync contract  | One owner-scoped monotonic clock, optimistic revisions, idempotent mutations, tombstones, bounded APIs, RLS, and account-export coverage are source-complete; client adoption and production evidence remain.                                  |
| Project and workspace templates lacked durable sharing                 | Immutable Project-template versions, separate view/copy grants, exact-revision conflicts, idempotent copying, plan caps, RLS, safe audits, and account-export coverage are source-complete; client integration and production evidence remain. |
| Disabled legacy agent-team API could still enqueue permanent work      | Both agent creation routes now return 503, unread creation bodies are drained, only historical cancellation/denial remains, and local saved plans are not labelled execution history.                                                          |

## B — Requires backend work

| Gap                                                | Required work                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Work product surface                       | Build one unified Work/Chat creation API and UI with queued prompts, user questions/change direction, approval resume, durable background recovery, notifications, finished file/Site outputs, task/trigger configuration, and truthful model/reasoning/speed controls. |
| Cross-device Work sessions and branch metadata     | Extend the sync foundation to active session plans/events/branches, migrate local clients, and verify multi-device recovery.                                                                                                                                            |
| Realtime collaborative Canvas and Project presence | Realtime subscriptions, presence protocol, revision conflict resolution, and durable comment anchors.                                                                                                                                                                   |
| Server-ranked semantic workspace search            | Embedding/index pipeline, authorization-filtered retrieval, ranking evaluation, and deletion propagation.                                                                                                                                                               |
| Per-response memory source inspection              | Durable source-attribution records from prompt assembly through response persistence.                                                                                                                                                                                   |
| Full organization administration                   | Organization schema, SSO/domain controls, retention policies, admin roles, and enterprise audit export.                                                                                                                                                                 |
| Trusted contacts and safety escalation             | Verified contact model, consent, notification delivery, revocation, and abuse protections.                                                                                                                                                                              |

## C — Requires provider support

| Gap                                                         | Dependency                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Deep Research pause, redirect, and resumable execution | Research provider must expose controllable run identifiers and state transitions.                                                                              |
| Region-based image editing, masking, and inpainting         | Configured image provider must accept masks/edits and return durable edit metadata.                                                                            |
| Voice conversations                                         | Speech-to-text, text-to-speech, realtime transport, interruption, consent, and retention support.                                                              |
| Connector write breadth beyond Gmail, Calendar, and Drive   | Each configured app needs supported OAuth scopes, read/write APIs, confirmation contracts, and audit events.                                                   |
| Provider-native citations and rich previews                 | Search/model provider must return stable source identifiers, excerpts, and provenance.                                                                         |
| Long-running background Work execution                      | A configured isolated runner/provider must execute the unified queue with bounded leases, recovery, approvals, evidence, notifications, and truthful progress. |

## D — Requires proprietary OpenAI infrastructure

| Gap                                           | Why it cannot be reproduced directly                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Identical ChatGPT model behavior and routing  | Private models, routing policy, inference stack, and evaluation data are not available.         |
| Identical Deep Research ranking and synthesis | Private orchestration, crawlers, retrieval ranking, and research evaluation are unavailable.    |
| Identical memory ranking and personalization  | Private relevance models and product telemetry are unavailable.                                 |
| Identical global search ranking               | Private indexes, ranking signals, and usage feedback loops are unavailable.                     |
| Exact native desktop/mobile integrations      | Proprietary clients, operating-system entitlements, and release infrastructure are unavailable. |

## KovaGPT-exclusive differentiation

**Workspace Timeline** is embedded in Workspace Intelligence rather than added as another destination. It replays real authorized activity across chats, Projects, files, artifacts, images, memories, Context Packs, research, Work, and automations. Its range controls and counts are deterministic summaries of stored timestamps—never generated “AI insights.”

## Guardrails

- A relationship is displayed only when an existing authorized record supplies it.
- Local-only records are not represented as cross-device state.
- Missing providers produce unavailable or error states rather than success.
- Temporary Chat data is not promoted into durable Library, Memory, or Context Packs automatically.
- KovaGPT branding and the public Vite/TanStack runtime remain unchanged.
