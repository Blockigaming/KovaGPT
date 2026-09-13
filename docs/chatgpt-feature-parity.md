# KovaGPT capability comparison

Updated **2026-09-12** against reviewed PR #319 ancestor implementation head
`20940476881dadabfcedbfeadb4aba328dd8cd52`.

KovaGPT is an independent product, not a visual clone. This document is a compatibility index for an
older filename. The controlling sources are the
[September 11 final goal](release/kova-final-goal-2026-09-11.md),
[machine-readable final-goal contract](release/final-goal-contract.json), and
[27-area acceptance ledger](release/acceptance-ledger.md).

Overall progress remains the owner-declared **76.5%** checkpoint. UI completion remains the separate
owner-declared **1%** quality assessment. Neither value is recalculated by this comparison.

| Surface                                                         | Current reviewed source truth                                                                                                                 | Remaining boundary                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation, models, and reasoning                             | Bounded streaming, stop/edit/retry/regenerate/branch/history, Temporary Chat foundations, model roles, entitlements, and budgets exist.       | Astra-class premium capability, explicit saveable/personalized Temporary Chat completion, live provider quality, and production persistence remain.                        |
| Search, browser, and research                                   | Bounded sourced search, Deep Research, Work tools, approvals, and browser takeover foundations exist.                                         | Complete signed-in browser safety, steering, cross-source research, WebMCP, live credentials, and recovery proof remain.                                                   |
| Multimodal and files                                            | Text, image, supported PDF/Office extraction, private files, charts, and fixed isolated analysis tools exist.                                 | Audio/video/camera/microphone/screen input, full reproducible notebook depth, real-file coverage, physical devices, and live providers remain.                             |
| Images                                                          | Generation, source edits, masks, durable history, Library lifecycle, provider safety, and quota foundations exist.                            | Flare-class/Sunburst-class routing, advanced edit acceptance, visible quality/cost choice, provenance, live provider, and settlement remain.                               |
| Durable Work and agents                                         | Durable runs, recovery, directions/questions/approvals, accounting, outputs, and bounded specialist subruns exist.                            | Side-chat, cross-task references, complete steering, provider-neutral agent runtime breadth, portable hosted/self-hosted sandboxes, and production recovery remain.        |
| Tasks                                                           | CRUD, recurrence, pause/resume, conditions, verified events, connected context, and worker contracts exist.                                   | Shareable/customizable tasks, exact free/paid limits, safe browser tasks, live scheduler/OAuth callbacks, delivery, and production recovery remain.                        |
| Projects, Library, memory, and Study                            | Useful owner-scoped lifecycle, collaboration, storage, memory consent/attribution, and learning-progress foundations exist.                   | Project retention, complete Library/artifact organization, personalized Temporary Chat choices, live isolation, real accounts/devices, and final UX acceptance remain.     |
| Custom Kovas, apps, connectors, skills, and MCP                 | Custom Kova source, multi-account Google foundations, MCP OAuth/files, and immutable owner-scoped workflow skills exist.                      | WebMCP, broader provider accounts, store governance, verified publishers, analytics, organization distribution, live credentials, and production canaries remain.          |
| Artifacts, collaboration, and notifications                     | Durable editors/versions/comments, document writers, sharing foundations, in-app notices, and web push exist.                                 | Complete template-driven artifacts, full object sharing/roles, email/system/native notifications, live realtime/cross-device behavior, and round trips remain.             |
| Identity, family, privacy, billing, developer, and organization | Auth/MFA/recovery, family contacts, exports/deletion, Stripe/developer billing foundations, APIs/SDK/MCP, SSO adapter, and SCIM source exist. | Approved policy, unified premium accounting, live identity/payments/IdP, service accounts, analytics, retention, residency, erasure, support, and production proof remain. |
| Voice and native experiences                                    | Voice is correctly recorded as required but unavailable; responsive web/PWA source exists.                                                    | Full-duplex voice, interruption, captions, device/privacy controls, strict minute/backend budgets, native apps, and physical-device acceptance are unfinished.             |

The reviewed ancestor implementation head passed commit-scoped source, database, release-E2E,
browser, build, container, and Azure-readiness gates for its implemented scope. Those historical
results do not verify this revision. Staging and production remain unverified; no source or CI
result establishes deployment.
