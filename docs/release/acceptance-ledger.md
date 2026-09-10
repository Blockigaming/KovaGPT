# KovaGPT acceptance ledger

Reconciled **2026-09-10** against integrated `main` commit
`191175105fb9018a683ca3dcb40c56994120689d`.

This is the current high-level acceptance ledger. It replaces old percentage claims in historical
parity and reconciliation documents, but it does not erase those evidence snapshots. Passing source
checks is not production proof.

## Evidence baseline

- PR #316's reviewed tree is the tree merged into the exact `main` commit above.
- Exact-head KovaGPT CI run #2075 passed, including 1,606 unit tests, 9 API tests, integration,
  browser, visual, accessibility, release-E2E, build, bundle, and release-contract gates.
- Exact-head Azure Container Readiness run #1152 passed.
- The isolated-database job intentionally skipped because PR #316 changed no migrations. This does
  not prove that the complete source migration lineage matches production.
- No current production deployment, database migration, Cloudflare edge/origin configuration,
  Stripe configuration, or production smoke result is certified by this ledger.
- Overall progress therefore remains the conservative provisional **76.5%**. A green source tree
  cannot earn the missing production, policy, account, or final-interface acceptance credit.

## Classification key

- **Implemented**: the bounded approved source behavior exists on exact `main` and has automated
  evidence in the passing exact-tree gate set.
- **Partial**: useful source behavior exists, but an approved autonomous source requirement remains.
- **External/manual**: source is prepared, but provider, policy, account, infrastructure, real-user,
  or production evidence is still required.
- **Excluded**: outside the approved web/PWA product scope.

## Master product areas

| ID  | Product area                           | Current classification                             | Main and test evidence                                                                                                    | Remaining acceptance boundary                                                                                             |
| --- | -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 01  | Core chat                              | Implemented; external/manual                       | Streaming, stop, edit, retry, regenerate, branching, history, and Temporary Chat tests are integrated.                    | Real provider, authenticated persistence, and production smoke proof.                                                     |
| 02  | Composer and multimodal input          | Implemented; external/manual                       | Draft, keyboard, paste/drop, attachment, file extraction, and mobile composer contracts are integrated.                   | Real upload/storage/provider and physical-device proof.                                                                   |
| 03  | Models, modes, and reasoning           | Implemented; external/manual                       | Client modes map to server-enforced roles, plans, budgets, and configured model capabilities.                             | Re-audit the deployed model lineup, quota, latency, and Azure availability.                                               |
| 04  | Web and product discovery              | Implemented; external/manual                       | Bounded web/image/shopping/local discovery routes, provider normalization, admission, and UI tests are integrated.        | Provider credentials, live quotas, current results, and Maps release decision.                                            |
| 05  | Deep Research                          | Implemented; external/manual                       | Planning, multi-search, evidence, progress, warnings, cancel/retry, report, and persistence authorization are integrated. | Live provider runs, Supabase persistence, export, and production recovery proof.                                          |
| 06  | Agent tools and actions                | Partial                                            | Isolated Work execution, approvals, browser takeover, tools, outputs, and durable event surfaces exist.                   | Bounded same-owner specialist subruns with aggregate budgets and cascading lifecycle remain missing.                      |
| 07  | Long-running Work                      | Partial; external/manual                           | Durable run protocol, revisions, directions, questions, approvals, recovery, accounting, and outputs exist.               | Specialist subruns remain missing; hosted runner/container and real provider acceptance are required.                     |
| 08  | Scheduled Tasks                        | Implemented; external/manual                       | CRUD, recurrence, pause/resume, history, conditions, event sources, and execution contracts are integrated.               | Scheduler heartbeat, live callbacks, OAuth access, budget policy, and notification delivery.                              |
| 09  | Projects                               | Partial; external/manual                           | Lifecycle, roles, files, instructions, memory, chats, templates, collaboration, and deletion safety exist.                | Full approved Project retention policy/execution is missing; live two-user and storage cleanup proof remains.             |
| 10  | Library and files                      | Implemented; external/manual                       | Folders, originals, private images, versions, replacement, search, organization, and quota contracts are integrated.      | Matching production schema/storage, cross-user isolation, and quota canaries.                                             |
| 11  | Image generation and editing           | Implemented; external/manual                       | Provider boundaries, formats, masks, history, Library flows, safety, and quota handling are integrated.                   | Live provider capabilities, exact outputs, storage, and quota behavior.                                                   |
| 12  | Memory and personalization             | Implemented; external/manual                       | Consent, saved memory, source attribution, settings, workspace retrieval, and Temporary Chat isolation exist.             | Live persistence, multi-user isolation, deletion, and final UX acceptance.                                                |
| 13  | Custom Kovas                           | Implemented; external/manual                       | Builder, immutable versions, preview, directory/fork, moderation boundaries, and principal tests are integrated.          | Approved moderation/runtime configuration and production canaries.                                                        |
| 14  | Apps, connectors, plugins, and skills  | Partial; external/manual                           | Connector catalog, account/OAuth boundaries, Google/GitHub tooling, and truthful disabled states exist.                   | Reusable installed versioned skill/workflow packages remain missing; each provider needs consent and live credentials.    |
| 15  | Data analysis and code                 | Implemented; external/manual                       | File analysis, charts, code rendering/copy, sandboxed Work outputs, and office document contracts exist.                  | Hosted sandbox/provider validation and complex real-file acceptance.                                                      |
| 16  | Artifacts, writing, and visuals        | Implemented; external/manual                       | Editable writing/code, versions, selection edits, charts, export writers, and visual surfaces exist.                      | Real export round trips, browser acceptance, and production storage proof.                                                |
| 17  | Sites                                  | Partial; external/manual                           | Static Site lifecycle, versions, access controls, Work output handoff, cleanup, export, and isolated server exist.        | The approved co-editing floor remains narrower/incomplete; hosting activation and publish canaries require approval.      |
| 18  | Sharing, collaboration, and continuity | Implemented; external/manual                       | Chat sharing, Project roles, comments/presence, branch/history continuity, and cross-device source contracts exist.       | Live two-account Realtime, revocation, share, and cross-device verification.                                              |
| 19  | Notifications                          | Implemented; external/manual                       | In-app notification center, push lifecycle, scheduled delivery boundaries, and revocation are integrated.                 | Real delivery provider, browser permission, Safari/device, and production proof.                                          |
| 20  | Study                                  | Implemented; external/manual                       | Private progress, practice flow, chat controls, and study workspace tests are integrated.                                 | Real account persistence and final classroom/user acceptance.                                                             |
| 21  | Family and trusted contacts            | Implemented; external/manual                       | Invitation, consent, roles, revocation, erasure protections, and bounded contact delivery exist.                          | Age, regional/legal policy, actual delivery, and authorized-adult review.                                                 |
| 22  | Authentication, account, and privacy   | Implemented; external/manual                       | Sign-in/recovery/MFA, account controls, export, deletion fence, cleanup, and privacy contracts exist.                     | Live email/OAuth/MFA, migration, multi-account, erasure, and production proof.                                            |
| 23  | Billing, usage, and Finances           | Partial; external/manual                           | Checkout, portal, webhook entitlement, usage, developer billing/funding, and pricing administration exist.                | Live Pro is still $89 instead of approved $80; tax, refund, proration, retention, payment, and webhook canaries remain.   |
| 24  | Web and PWA                            | Implemented within approved scope; external/manual | Responsive shell, install/offline/share intake, service worker, and push lifecycle are integrated.                        | Physical Safari/mobile/accessibility testing remains. Native applications, voice, microphone, and recording are excluded. |
| 25  | Developer platform and MCP             | Implemented; external/manual                       | Scoped keys/projects, Responses, models, quotes, files, SDK, MCP tools, OAuth consent, and revocation are integrated.     | Real issuer/client registration, secrets, billing, public activation, and production canaries.                            |
| 26  | Organization administration            | Partial; external/manual                           | Roles, invitations, domains, SSO adapter, SCIM Users/Groups, audit, and deletion protections are integrated.              | Approved retention policy/execution is missing; IdP/domain/legal setup and live tenant tests remain.                      |
| 27  | KovaGPT differentiators                | Implemented; external/manual                       | Workspace Intelligence, Timeline, Knowledge Graph, Prompt Studio, Context Packs, Goals, and Project health exist.         | Real-data quality, cross-device behavior, browser finishing, and Zachary's final acceptance.                              |

## Older gap reconciliation

| Older item                                 | Current status on exact `main` | Evidence boundary                                                                                                             |
| ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Bounded Work specialist/subrun execution   | Missing                        | Legacy specialist records render, but the legacy worker intentionally fails closed and no bounded child-run directive exists. |
| Reusable installed workflow/skill packages | Missing                        | Apps/connectors and saved prompts are not versioned installed instruction/resource packages.                                  |
| Custom Kovas                               | Integrated                     | Source, migrations, routes, lifecycle tests, and browser principal tests are present.                                         |
| Organization SCIM                          | Integrated                     | SCIM migration, server/routes, controls, policy/unit tests, and browser tests are present.                                    |
| Project retention                          | Missing/partial                | Project deletion and source retirement exist; the broader approved retention lifecycle does not.                              |
| Developer MCP OAuth                        | Integrated                     | Discovery endpoints, S256 consent, token/refresh lifecycle, revocation, routes, and tests are present.                        |
| Developer private files                    | Integrated                     | Private text-file schema, driver, APIs, MCP tools, export, and tests are present.                                             |
| Discovery                                  | Integrated                     | UI/API/provider/admission migration and unit/browser coverage are present.                                                    |
| Sites co-editing                           | Partial                        | Site lifecycle and access sessions exist, but the separately scoped accepted-editor workflow is not complete.                 |
| Library image quota                        | Integrated                     | The `20260905033500_library_image_storage_quota.sql` migration and focused tests are present.                                 |

## Remaining route to 100%

1. Finish the three clear autonomous gaps: Work subruns, reusable skill/workflow packages, and
   Project retention; separately decide the exact Sites co-editing floor.
2. Continue the highest-impact chat and mobile usability finishing with focused regression coverage.
3. Re-run the complete gate set on one exact launch-candidate `main` commit, including isolated
   database verification when migrations are involved.
4. With explicit approval, reconcile Supabase, deploy the exact reviewed image, prove the Cloudflare
   edge and protected Azure origin, validate Stripe and provider configuration, and run production
   smoke/canary tests.
5. Complete legal, commercial, security, age, retention, and account decisions, then record final
   interface acceptance.

This ledger covers all 27 master product areas. Granular requirement-by-requirement acceptance rows
still need to be migrated from the older matrices and test inventories before the percentage can be
treated as mathematically authoritative.
