# Remaining KovaGPT final-goal gaps

Updated **2026-09-12** against reviewed PR #319 ancestor implementation head
`20940476881dadabfcedbfeadb4aba328dd8cd52`.

This file keeps its historical path for compatibility. KovaGPT is an independent product, not a
visual clone. The controlling scope is the
[September 11 final goal](release/kova-final-goal-2026-09-11.md); the
[final-goal contract](release/final-goal-contract.json) supplies stable requirement metadata; and the
[acceptance ledger](release/acceptance-ledger.md) distinguishes source, local, hosted, staging, and
production evidence.

Overall progress remains the owner-declared **76.5%** checkpoint. UI completion remains the separate
owner-declared **1%** quality assessment. This gap register does not recalculate either number.

## Just completed on reviewed PR #319

- Owner-scoped reusable workflow skills now have immutable versions, exact installation/selection,
  server-side resolution, integrity digests, principal scoping, export/deletion coverage, durable
  quotas, bounded admission, replay safety, and stale-context revalidation.
- PR #319 ancestor implementation head `20940476881dadabfcedbfeadb4aba328dd8cd52` passed
  commit-scoped review with no major issues and no unresolved threads at that time.
- KovaGPT CI run `34664358655` passed all 12 jobs. Azure Container Readiness run
  `34664358673` passed.
- These are historical source/hosted results for the named ancestor only. They do not verify this
  revision, and no merge, migration, deployment, or production verification is implied.

## Highest-priority autonomous source work

| Priority | Final-goal requirements                     | Current bounded foundation                                                                                                | Next source acceptance target                                                                                                                                                                                           |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | FG-07 Projects and FG-15 privacy            | Project lifecycle, roles, files, chats, instructions, memory, collaboration, and deletion safety exist.                   | Implement the approved retention lifecycle without activating deletion; verify preview, consent, current activity/revision, storage-first execution, idempotency, export, and cancellation.                             |
| 2        | FG-X1 premium-compute safety                | Model, Work, image, task, and developer ledgers have bounded pieces.                                                      | Reconcile one server-owned cross-category reservation/settlement contract covering retries, delegates, tools, disconnects, cancellations, uncertain usage, period rollover, and global kill switches.                   |
| 3        | FG-10 durable agents                        | Durable Work, recovery, directions/questions/approvals, outputs, accounting, and bounded specialist subruns exist.        | Add bounded side-chat and cross-task references, complete steering/compaction recovery, and preserve one parent budget and audit trace across all work.                                                                 |
| 4        | FG-09 tasks                                 | CRUD, recurrence, conditions, verified event ingress, connected context, and worker contracts exist.                      | Complete shareable recipient-owned copies, exact free/paid limits, safe signed-in browser tasks, delivery recovery, and source-level scheduler readiness evidence.                                                      |
| 5        | FG-11 apps/MCP/WebMCP                       | Google/GitHub, multi-account Google foundations, MCP OAuth/files, and workflow skills exist.                              | Define provider-neutral WebMCP discovery/trust, permission review, isolation, rate, revocation, and audit contracts without granting website text or packages authority.                                                |
| 6        | FG-01 and FG-04 premium model/image classes | Versioned model aliases, capability checks, image generation/editing, safety, quotas, and provider adapters exist.        | Add provider-neutral Astra/Flare/Sunburst capability descriptors, explicit unavailable states, eval and metering gates, and no silent expensive defaults; do not claim or activate an unavailable provider.             |
| 7        | FG-05 voice                                 | The capability registry now treats voice as required but unavailable.                                                     | Design the provider-neutral full-duplex protocol, consent/privacy state, captions, interruption, device selection, recovery, agent delegation, and strict minute/backend reservation contract before exposing controls. |
| 8        | FG-06 and FG-13 artifacts/collaboration     | Editors, revisions, comments, charts, document writers, sharing, Projects, and Library foundations exist.                 | Complete template-driven document/spreadsheet/presentation/PDF workflows, round trips, object-wide sharing roles, conflicts, restore, and durable collaboration evidence.                                               |
| 9        | FG-17 and FG-18 developer/enterprise        | APIs, SDK, MCP, developer billing, organization roles, domains, SSO adapter, SCIM, audit, and deletion protections exist. | Fill audio/realtime/agent/task/webhook API breadth, service accounts, analytics, policy controls, retention execution inputs, support/deprecation, and complete test-mode administration.                               |
| 10       | FG-X2 interface quality                     | Broad source and hosted browser coverage exist.                                                                           | Continue cohesive product-wide desktop/mobile lifecycle, accessibility, localization, motion, performance, safe-area, no-overflow, and physical-device work; owner acceptance remains mandatory.                        |

## Required but currently unavailable

- **Live voice/audio:** required, not excluded, and not implemented. Keep unavailable until consent,
  safety, latency, quality, provider, device, accessibility, privacy, and per-minute plus
  backend-compute gates pass.
- **Astra-class premium mode:** required capability class, not proof of a named provider deployment.
  Keep unavailable until official availability, account entitlement, eval, quota, latency, metering,
  and cost are verified.
- **Flare-class and Sunburst-class image paths:** required capability classes, not proof of provider
  access. Keep unavailable until capability discovery, quality/cost selection, safety, provenance,
  reservations, and live acceptance pass.
- **Complete native experiences:** required where necessary for voice, camera, notifications,
  background work, and sharing. Responsive browser tests do not prove physical-device behavior.
- **WebMCP:** required provider-neutral website tool discovery. Existing MCP endpoints do not prove
  browser trust, website tool safety, or production availability.

## Genuine owner or approved-live dependencies

| Dependency                                                                        | Prepared source cannot establish                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Approve PR integration, release, migration, staging, or production sequence       | Production schema compatibility, deployed SHA/image, live provider/account behavior, canaries, or rollback.               |
| Approve Azure, Cloudflare, Supabase, Microsoft/Entra, or identity/network changes | Credits, quotas, model deployment access, origin enforcement, secrets, callbacks, backups, or actual recovery.            |
| Approve live Stripe prices, commercial policy, purchases, or paid resources       | Tax, refund, proration, invoices, funding, customer settlement, or live entitlements.                                     |
| Supply or approve provider/OAuth/IdP registrations and secrets                    | Live connected accounts, scheduler watches, signed runner identity, WebMCP trust, notifications, or native permissions.   |
| Approve age, family, retention, privacy, legal, enterprise, and moderation policy | Regional/legal compliance, institutional availability, deletion activation, appeals, or incident operations.              |
| Complete physical-device or real-account interactions unavailable to CI           | Safari/device push, microphone/camera permission, native background behavior, MFA/recovery email, or customer acceptance. |

## Permanent truth boundaries

- Do not treat specified, implemented, locally verified, hosted verified, staging verified, and
  production verified as interchangeable.
- No hidden mock, dead control, route, provider label, or marketing claim counts as completion.
- Voice and native experiences are required incomplete scope, not intentional exclusions.
- Provider-class names describe desired outcomes and portable architecture; they do not establish
  official availability, entitlement, quality, cost, or activation.
- Do not interfere with Qustodio.
- Do not merge PR #319, deploy, apply live migrations, purchase resources, change live pricing,
  delete data/resources, or modify verified Azure identity/networking without separate approval.
