# KovaGPT acceptance ledger

Reconciled **2026-09-12** against reviewed PR #319 implementation head
`20940476881dadabfcedbfeadb4aba328dd8cd52`, based on `main` commit `b046727e3336b0f8df48a8097ad131e94cbf4ffe`.

This is the current high-level acceptance ledger. It replaces old percentage claims in historical
parity and reconciliation documents, but it does not erase those evidence snapshots. Passing source
checks is not production proof.

## Evidence baseline

- PR #318's reviewed tree is the tree merged into the exact `main` base above.
- PR #319 implementation head `20940476881dadabfcedbfeadb4aba328dd8cd52` received an exact-head
  Codex review with no major issues and no unresolved review threads.
- Exact-head KovaGPT CI run `34664358655` passed all 12 jobs, including unit, API, integration,
  isolated database, three release-E2E shards, build, bundle, release contracts, accessibility,
  visual, deployed-baseline audit, and every browser viewport.
- Exact-head Azure Container Readiness run `34664358673` passed typecheck, unit, Bicep, production
  build, Docker/container health, and isolated Sites smoke.
- The isolated-database job passed the complete 146-migration source lineage. This does not prove
  that source lineage matches production.
- No current production deployment, database migration, Cloudflare edge/origin configuration,
  Stripe configuration, or production smoke result is certified by this ledger.
- Overall progress remains the owner-declared **76.5%** checkpoint, and UI completion remains the
  separate owner-declared **1%** quality assessment. Neither value is recalculated here. A green
  source tree cannot earn missing production, policy, account, capability, or final-interface credit.

## September 11 final-goal reconciliation

The controlling [September 11 final goal](kova-final-goal-2026-09-11.md) and its
[machine-readable contract](final-goal-contract.json) map all 18 product areas plus premium-compute,
interface-quality, and architecture/release obligations into this 27-area evidence ledger.

- All 21 final-goal requirements have a stable ID, source, owner, mapped ledger areas, dependencies,
  acceptance test, current status, evidence, and an explicit remaining boundary.
- Nineteen requirements are `source_partial`: useful bounded source exists, but the expanded
  requirement is not complete.
- Live voice/audio is `specified_unimplemented`: it is required scope, but it is not currently
  exposed or falsely advertised as available.
- Architecture/independence/release completion is `not_verified`: source and hosted CI do not prove
  staging or production.
- This reconciliation changes scope truth and evidence metadata only. It does not change the
  owner-declared overall or UI percentages.

## Classification key

- **Implemented**: the bounded approved source behavior exists on exact `main` and has automated
  evidence in the passing exact-tree gate set.
- **Partial**: useful source behavior exists, but an approved autonomous source requirement remains.
- **External/manual**: source is prepared, but provider, policy, account, infrastructure, real-user,
  or production evidence is still required.
- **Excluded**: outside the approved web/PWA product scope.

## Master product areas

| ID  | Product area                           | Current classification       | Current implementation evidence                                                                                                          | Remaining acceptance boundary                                                                                                                         |
| --- | -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Core chat                              | Partial; external/manual     | Streaming, stop, edit, retry, regenerate, branching, history, and private Temporary Chat foundations are integrated.                     | Explicit saveable/personalized Temporary Chat behavior, real provider use, authenticated persistence, and production smoke remain.                    |
| 02  | Composer and multimodal input          | Partial; external/manual     | Draft, keyboard, paste/drop, attachment, document extraction, image, and mobile composer contracts are integrated.                       | Audio, supported video, camera, microphone, screen input, physical-device permissions, and live provider proof remain.                                |
| 03  | Models, modes, and reasoning           | Partial; external/manual     | Current client modes map to server-enforced roles, plans, budgets, deployment aliases, and capability checks.                            | Astra-class premium capability, truthful availability discovery, eval gates, latency, quota, and live Azure proof remain.                             |
| 04  | Web and product discovery              | Implemented; external/manual | Bounded web, image, shopping, and local discovery routes, provider normalization, admission, citations, and UI tests are integrated.     | Provider credentials, live quotas, current-result quality, and approved location/Maps decisions remain.                                               |
| 05  | Deep Research                          | Partial; external/manual     | Planning, multi-search, evidence, progress, warnings, cancel/retry, report, and persistence authorization are integrated.                | Complete steering, cross-source research, live provider runs, persistence/export, and production recovery proof remain.                               |
| 06  | Agent tools and actions                | Partial; external/manual     | Isolated Work execution, approvals, browser takeover, tools, outputs, durable events, and bounded specialist runs exist.                 | Complete signed-in browser safety, provider-neutral tool breadth, hosted runner acceptance, and real connected-service proof remain.                  |
| 07  | Long-running Work                      | Partial; external/manual     | Durable protocol, revisions, directions, questions, approvals, recovery, accounting, outputs, and bounded specialist runs exist.         | Side-chat, cross-task references, complete steering, portable hosted/self-hosted runtime, and production recovery proof remain.                       |
| 08  | Scheduled Tasks                        | Partial; external/manual     | CRUD, recurrence, pause/resume, history, conditions, verified event sources, and execution contracts are integrated.                     | Shareable/customizable copies, exact free/paid limits, safe browser tasks, live callbacks, OAuth, scheduler heartbeat, and delivery remain.           |
| 09  | Projects                               | Partial; external/manual     | Lifecycle, roles, files, instructions, memory, chats, templates, collaboration, and deletion safety exist.                               | Full approved retention policy/execution, complete sharing/tool/member behavior, live two-user isolation, and storage cleanup proof remain.           |
| 10  | Library and files                      | Partial; external/manual     | Folders, originals, private images, versions, replacement, search, organization, and quota contracts are integrated.                     | Complete artifact coverage, move/restore/share depth, matching production storage, cross-user isolation, retention, and quota canaries remain.        |
| 11  | Image generation and editing           | Partial; external/manual     | Provider boundaries, formats, source edits, masks, history, Library flows, safety, and quota handling are integrated.                    | Flare-class and Sunburst-class routing, visible quality/cost choice, advanced edit acceptance, provenance, live provider, and settlement remain.      |
| 12  | Memory and personalization             | Partial; external/manual     | Consent, saved memory, source attribution, settings, workspace retrieval, and Temporary Chat isolation exist.                            | Complete inspect/edit/forget/pause/export controls, personalized Temporary Chat choices, live isolation/deletion, and final UX acceptance remain.     |
| 13  | Custom Kovas                           | Partial; external/manual     | Builder, immutable versions, preview, directory/fork, moderation boundaries, and principal tests are integrated.                         | Complete publish/share/install/update/archive analytics, store governance, organization distribution, and production canaries remain.                 |
| 14  | Apps, connectors, plugins, and skills  | Partial; external/manual     | Connector/OAuth boundaries, Google/GitHub tooling, multi-account foundations, and owner-scoped immutable workflow skills are integrated. | WebMCP, complete provider-neutral discovery, broader live providers/accounts, consent, revocation, permission review, and operations remain.          |
| 15  | Data analysis and code                 | Partial; external/manual     | File analysis, charts, code rendering/copy, sandboxed Work outputs, and supported office-document contracts exist.                       | Reproducible notebook depth, complete structured extraction, hosted sandbox/provider validation, and complex real-file acceptance remain.             |
| 16  | Artifacts, writing, and visuals        | Partial; external/manual     | Editable writing/code, durable versions, selection edits, comments, charts, export writers, and visual surfaces exist.                   | Complete template-driven document/spreadsheet/presentation/PDF workflows, collaboration, export round trips, and production storage remain.           |
| 17  | Sites                                  | Partial; external/manual     | Static Site lifecycle, versions, access controls, Work output handoff, cleanup, export, and isolated serving exist.                      | The approved co-editing floor, portable authenticated state/analytics decisions, hosting activation, and publish canaries remain.                     |
| 18  | Sharing, collaboration, and continuity | Partial; external/manual     | Chat sharing, Project roles, comments/presence, branch/history continuity, and cross-device source contracts exist.                      | Complete object coverage, roles/expiration/transfer/fork semantics, live two-account realtime, revocation, and cross-device proof remain.             |
| 19  | Notifications                          | Partial; external/manual     | In-app notification center, web-push lifecycle, preferences, quiet hours, delivery boundaries, and revocation are integrated.            | Email and supported system channels, physical browser/device permission, localization, native behavior, and production delivery proof remain.         |
| 20  | Study                                  | Implemented; external/manual | Private progress, practice flow, guided controls, feedback, and study workspace tests are integrated.                                    | Real account persistence, age/classroom policy, source grounding quality, and final learner acceptance remain.                                        |
| 21  | Family and trusted contacts            | Implemented; external/manual | Invitation, consent, roles, revocation, erasure protections, and bounded contact delivery exist.                                         | Age, regional/legal policy, actual delivery, administrator policy, and parent review remain.                                                          |
| 22  | Authentication, account, and privacy   | Partial; external/manual     | Sign-in/recovery/MFA, account controls, export, deletion fence, cleanup, and privacy contracts exist.                                    | Complete session/device/linking behavior, live email/OAuth/MFA, migration, abuse controls, cross-system erasure, and production proof remain.         |
| 23  | Billing, usage, and Finances           | Partial; external/manual     | Checkout, portal, webhook entitlement, usage, developer billing/funding, reservations, settlement, and pricing administration exist.     | One cross-category premium-compute ledger, approved live pricing/policy, tax/refund/proration, reconciliation, anomaly, and payment canaries remain.  |
| 24  | Web, PWA, voice, and native platforms  | Partial; external/manual     | Responsive web/PWA, install/offline/share intake, service worker, push lifecycle, and truthful capability metadata exist.                | Voice is required but unavailable; full-duplex audio, device controls, native apps, physical-device behavior, and accessibility proof remain.         |
| 25  | Developer platform and MCP             | Partial; external/manual     | Scoped keys/projects, Responses, models, quotes, files, SDK, MCP tools, OAuth consent, and revocation are integrated.                    | Audio/realtime, agents/tasks/webhooks breadth, real issuer/client registration, secrets, billing, public activation, and production canaries remain.  |
| 26  | Organization administration            | Partial; external/manual     | Roles, invitations, domains, SSO adapter, SCIM Users/Groups, audit, and deletion protections are integrated.                             | Service accounts, analytics, complete policy controls, approved retention execution, IdP/domain/legal setup, residency, and live tenant tests remain. |
| 27  | KovaGPT differentiators                | Implemented; external/manual | Workspace Intelligence, Timeline, Knowledge Graph, Prompt Studio, Context Packs, Goals, and Project health exist.                        | Real-data quality, cross-device behavior, browser finishing, and Zachary's final acceptance remain.                                                   |

## Older gap reconciliation

| Older item                                 | Current status on exact `main` | Evidence boundary                                                                                                                         |
| ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded Work specialist/subrun execution   | Integrated                     | PR #318 adds one-to-four same-owner sequential specialist phases with aggregate budgets, bounded context, and cascading lifecycle.        |
| Reusable installed workflow/skill packages | Integrated on reviewed PR #319 | Owner-scoped packages, immutable versions, exact installations, server resolution, export/deletion, quota, and replay safety are present. |
| Custom Kovas                               | Integrated                     | Source, migrations, routes, lifecycle tests, and browser principal tests are present.                                                     |
| Organization SCIM                          | Integrated                     | SCIM migration, server/routes, controls, policy/unit tests, and browser tests are present.                                                |
| Project retention                          | Missing/partial                | Project deletion and source retirement exist; the broader approved retention lifecycle does not.                                          |
| Developer MCP OAuth                        | Integrated                     | Discovery endpoints, S256 consent, token/refresh lifecycle, revocation, routes, and tests are present.                                    |
| Developer private files                    | Integrated                     | Private text-file schema, driver, APIs, MCP tools, export, and tests are present.                                                         |
| Discovery                                  | Integrated                     | UI/API/provider/admission migration and unit/browser coverage are present.                                                                |
| Sites co-editing                           | Partial                        | Site lifecycle and access sessions exist, but the separately scoped accepted-editor workflow is not complete.                             |
| Library image quota                        | Integrated                     | The `20260905033500_library_image_storage_quota.sql` migration and focused tests are present.                                             |

## Remaining route to 100%

1. Finish the remaining autonomous gaps recorded in the final-goal contract, beginning with Project
   retention, truthful provider-neutral premium capability scaffolding, WebMCP, non-blocking Work
   expansion, event-task sharing, and the approved Sites co-editing floor.
2. Build live voice/audio only behind consent, safety, latency, provider, device, and per-minute plus
   backend-compute gates; keep it truthfully unavailable until those gates exist.
3. Continue the product-wide interface work with focused desktop/mobile/accessibility regression
   coverage while preserving the separate owner-declared 1% UI assessment.
4. Re-run the complete gate set on one exact launch-candidate `main` commit, including isolated
   database verification when migrations are involved.
5. With explicit approval, reconcile Supabase, deploy the exact reviewed image, prove the Cloudflare
   edge and protected Azure origin, validate Stripe and provider configuration, and run production
   smoke/canary tests.
6. Complete legal, commercial, security, age, retention, and account decisions, then record final
   interface acceptance.

The generated [granular ledger](acceptance-ledger.generated.json) expands all 27 master product areas
across source, local automation, hosted CI, staging, and production for 135 independently classified
rows. `npm run release:acceptance-ledger` verifies the row set, source/test evidence paths, retained
legacy test inventory, reviewed implementation evidence, the 21 final-goal requirement records, and
the generated snapshot. The 76.5% overall checkpoint remains owner-declared because the ledger
intentionally gives no credit formula to unverified staging, production, policy, account, new
capability, or final-interface evidence.
