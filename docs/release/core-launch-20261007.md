# Core launch source candidate — 7 October 2026

Academy remains paused and unapproved (0/637 pages, 0/28 registered families).
This is source preparation, not a deployed release or visual acceptance.

## Provenance and recovery

- Recorded base: `de5277b5c6f021a7495910b879e58dbc4da6f21d`.
- Exact recovered independent repair: `fbd2d4fd75a868c4a7855c6f04942de467d1af4d`.
  Its source and history are retained in the recovery bundle.
- Conversation routing/Canvas/sharing source recovered from PR #413,
  `e99493e2f4abe7e4e77006bdcc641f77d575ae7a`; only its 14 source/test files are
  applied. Its approval documents are not imported.
- The original `Core-launch.patch` could not be recovered. Missing navigation,
  unified assistant, inactive selector, pill button and public-copy changes are
  reconstructed from the recorded manifest and current owner requirements.
  This reconstruction is **not** `bce6885f3295591ea95f08f4c18e73134dbab4a1`.
- Previous 123 core checks and 35 repair checks remain historical evidence.
  They do not prove reconstructed source. New checks apply to this combined tree.
- GitHub publication may assign a different commit ID from the local recovery
  commit. The publication receipt must prove identical trees; both histories
  must remain in the restorable bundle. No history rewrite is authorized.

## Changed customer-facing behavior

The root opens the assistant. Chat/Work switching and the separate Work launcher
are removed from ordinary navigation, while historical Work data and server
accounting remain intact. Files, projects, images, plugins and scheduled tasks
are reachable; deferred content is removed from core command results.

Saved conversations receive `/c/:id` only after durable write acknowledgement and
readback. Temporary chats receive no saved URL. Principal changes and superseded
writes cannot publish stale routes. Moving from the root to the current saved
route preserves the mounted stream and queued attachments. Direct Canvas links
load the requested document; shared links remain recipient-authorized snapshots.

All tiers show an inactive KovaGPT identity label until Models' serving contract
is accepted. The legacy `instant` request value is compatibility only, not proof
that Cosmo is serving. No model, effort, provider or entitlement policy is
activated here. Model and effort controls will remain separate; Max stays
single-agent and only authorized Ultra may use subagents.

Shared buttons use `border-radius: 9999px`; public primary CTAs explicitly retain
that radius, centered text, balanced padding and focus/hover treatment. Pricing
no longer sells unverified model choices. Required provider/legal attribution
and truthful runtime identity disclosures remain intact.

The owner's reduced launch scope selects exactly Gmail, Google Calendar, Google
Drive, Outlook, OneDrive, SharePoint, Microsoft Teams, Notion, GitHub, Linear,
Slack, Salesforce and HubSpot. The Plugins tab uses this explicit thirteen-entry
list. The old catalog remains preserved; its other entries are deferred, not
launch requirements. Advanced workflow creation is hidden, with its component,
server code and browser regressions preserved for later work.

Google Connect/Add/reconnect requires authenticated configured status, including
in event handlers. Callback query strings cannot manufacture connection success.
The original catalog retains all 360 entries. Within the selected launch list,
four integrations have source implementations (Gmail, Calendar, Drive, GitHub)
and nine still need adapters and provider authorization contracts. All nine are
inactive in the UI; **zero integrations are certified operational**. Google
services share the existing OAuth contract; GitHub uses its existing
installation/repository manager. SharePoint is an explicit launch entry and does
not falsely inherit Google's configuration or connection state.

## Verification and launch gates

Fresh Node tests execute the actual persistence helper and component code with
controlled storage/auth/provider boundaries. Typecheck, lint, formatting and a
production build are separate gates. Remote CI must run against the published
head. The local Chromium Markdown regression uses a synthetic page and intercepted
network requests; it is not the owner's Academy capture workflow. Hosted CI follows
the owner's explicit remote-check authorization. Mocked fixtures do not prove deployed flows.
The final receipt records exact commands, source/tree IDs, results and artifacts.

| Journey                                 | Existing application implementation                                         | Remaining real acceptance                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sign in → prompt → stream → save/reopen | Auth wrapper, chat SSE, principal-scoped history, recovered routes          | Accepted Auth session/storage and affordable Models runtime; actual stream, stop/retry, reload and second-device history   |
| Projects/files                          | Authenticated CRUD/membership, private uploads, bounded document extraction | Create/upload/read/reopen/delete, two-owner isolation and revoked downloads on deployed storage                            |
| Images                                  | Image request and library persistence paths                                 | Approved provider/budget, generate/save/reopen/download and failure accounting                                             |
| Scheduled tasks                         | Task CRUD, grants, worker protocol and run history                          | Enabled worker/trigger; due-time execution, deduplication, delivery and cancellation                                       |
| Plugins                                 | Four selected integrations with Google/GitHub implementations               | Live consent/operation/disconnect proof for four; provider adapters and authorization contracts for nine selected services |
| Subscriptions/access                    | Checkout, portal, webhook and entitlement code                              | Accepted Stripe configuration and sandbox proof, webhook-backed upgrade/downgrade, direct API denial                       |

No deployed end-to-end journey is certified by this source candidate. Retained
account, billing, privacy and terms routes remain part of launch scope.
Every journey above is implementation-only; none is staging-verified or
production-verified by Interface. Signup, login, logout, password recovery and
two-account isolation require Auth's accepted environment. Image generation is
conditional on verified provider accounting and cost controls. Subscription
checkout and server-enforced limits are mandatory if paid subscriptions are
accepted; keep paid runtime disabled until that evidence exists.

First integrated staging acceptance: use a disposable account to sign up,
complete verification, log in, send one bounded prompt, observe incremental
streaming, wait for durable save, reopen the conversation after reload and login,
then prove a second account cannot read it. Record the exact app image, Auth
mode, Models endpoint contract, request identity, storage readback and cleanup.
This is a real staging journey, not a mocked-browser substitute. It is blocked
by accepted specialist runtime contracts and staging activation authority.

## Specialist dependencies and configuration

Auth PR #443 (`e43686bc123f2e5efcd32a69e843f3fd4bf61b49`) merged into
`codex/kova-owned-auth-foundation` as `026196593e9f3a9d2f8a00d8e1788dffb320b5e3`
on October 7 at 18:21 UTC. It is not integrated into this Interface branch.
Auth owns migration and storage/revocation acceptance. Regenerate the route tree
from both accepted route sets during future integration; do not overwrite it.
Security PR #444 is `74e2fba1e0fc74ab36c237b033b03d097c49b0ef`, still draft.
Its assistant-Markdown image repair and regressions are now ported into this
candidate. The runtime fixture also stubs the current feedback server boundary.
Images render as explicit links; images already inside a link preserve that
link's destination and cannot create nested anchors. No image request occurs on
streaming, completed rendering, focus or hover. Explicit clicks use a new tab
without referrer or opener access. The PR itself has not been merged.

The original Models source handoff is `05bd4a159aa476067b91c49559b702643386f9e4`,
with `current-product-policy.v4.json` and `kova-assistant.v3` request fields
`model_id` and `effort_id`. Trusted entitlements do not establish availability.
The owner's current launch policy allows three Kova identities (Cosmo, Orion and
Nova) backed by one affordable base model/runtime with genuinely different
inference budgets. Three separately trained or hosted models are not a launch
prerequisite. Effort and identity remain separate controls, free access stays
locked to Instant, and only Ultra may use subagents. Availability and increased
quality must be measured rather than inferred from names or response delays.
The accepted affordable serving endpoint, streaming/cancellation, admission,
usage/cost and error contracts remain required. No Models infrastructure, hosting,
evaluation or backend policy is duplicated here. No Interface spending is authorized.

The October 7 follow-up records shared-profile source
`9a25f78bdbc46d73043b68f9668cbdb2ce3edd00`, preserved in a verified source
bundle but not yet published. It implements three launch identities on one
proposed deployment. Template and runtime preparation are source evidence;
weights, actual inference, quality and Azure serving performance remain
unmeasured. This handoff does not supply an accepted live endpoint. Auth's
concurrent rehearsal remains in preparation; its activation and acceptance
must not be inferred from the already-built images or foundation branch.

The owner authorized starting the existing production app at its normal running
cost; that operation does not authorize deploying this candidate. Required release inputs
include the exact Git SHA/tree, immutable image digest, matching browser/server
build identity, approved origins and Auth mode, complete secret/config preservation,
origin protection, capacity and a verified rollback revision. No deployment occurs.

Configuration names (never values): the Auth-approved Supabase/browser and Kova
Auth settings; Models' accepted endpoint/authentication; `AI_GENERATION_ENABLED`
(keep disabled pending acceptance); `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CONNECTOR_ENCRYPTION_KEY`;
GitHub OAuth/App credentials, callback, webhook and explicit repository grants;
the approved `CRON_SECRET`/`SCHEDULED_TASK_SECRET` worker path; approved Stripe
account, prices, portal and webhook references. `STRIPE_BILLING_RUNTIME` remains
disabled until its acceptance gate passes. Do not infer production config from samples.

## Deployment and rollback proposal (not authorized)

Use the existing isolated staging application for the first integrated journey;
leave the production host and traffic unchanged. The image must include the
accepted Interface and Auth source together, with the deferred advanced UI
disabled and only measured serving configurations enabled. Never reuse the stopped
Auth rehearsal's activation grant for this separate release test.

Required task inputs are `SCHEDULED_TASK_SECRET` (or `CRON_SECRET`),
`KOVA_TASK_POLICY_VERSION`, accepted provider/accounting configuration and an
active scheduler heartbeat. A saved task alone is not execution evidence.
Validate one due task, one persisted result and one cancellation without a
duplicate provider operation before reporting scheduled tasks staging-verified.

Costs: this Interface run adds no Azure/provider/paid operation. Models' saved
October 7 proposal estimates $272.86/month against a $280 total planning ceiling,
including $132.86 for the proposed model server and $140 in other allowances.
Those are proposal figures, not current invoices, an accepted serving option or
permission to spend. Current rates, actual overhead, staging duration and the
incremental image/provider cost must be reconciled before deployment approval;
the exact bounded staging price and measured model capacity remain unresolved.
No new recurring resource is proposed by Interface.

1. Finish exact-head remote checks and accepted Auth/Models/Azure contracts.
2. Record the currently serving revision/digest/config as the actual rollback target.
3. Build an immutable production image from the reviewed SHA with production browser
   config; verify provenance, preserved runtime settings and origin protection.
4. Present that image, configuration diff, costs and rollback target for explicit
   deployment authority. Source publication does not grant it.
5. Only after authority, deploy through Azure's approved path; prove version/readiness,
   canonical host and origin denial, then authorized disposable-account journeys.
6. On failure, restore traffic to the recorded verified revision/digest, repeat health
   and identity checks, and preserve data. Do not reverse migrations or replay
   uncertain charges or provider writes blindly.

## Remote CI repair follow-up

The initial published head `d4632931ef04baf9c7cb28b55f7451237c2a631e`
passed hosted formatting, lint, TypeScript and release contracts. All three Shared
UI Browser jobs passed (Chromium, Firefox and WebKit); these are component-fixture
checks, not deployed assistant journeys. Main CI stopped at the dependency audit.

The follow-up pins patched Seroval 1.6.3, Undici 8.10.2, Sharp 0.35.5 and fast-uri
3.1.8, with compatible lockfile updates for brace-expansion, Engine.IO and
source-map-js. `npm audit --omit=dev` reports zero findings after the changes.
No forced major upgrade, dependency-audit suppression or CI gate removal is used.

Broader verification also exposed old navigation/model expectations and stale
fixed-expiry test accounts. UI expectations now match the unified launch scope.
HTTP/Sites tests use live-clock accounts and MFA fixture sessions; historical SQL
fixtures retain their fixed clock. Expired-session rejection remains asserted.
No Auth application code, migrations, access rules or deployment settings changed.

## Reduced-scope acceptance gate

The launch report and promotion guard now share the same acceptance rules and
thirteen-plugin ID list as the Plugins tab. An aggregate connector pass cannot
substitute for each selected service's connect, read, disconnect and account
isolation evidence. Every required result must match the report's exact commit
and staging target. Provider readiness, actual conversation streaming/reopening,
authentication, projects/files, storage, executed scheduled tasks and essential
settings/legal pages are mandatory. Deferred catalog entries and agent features
do not block this reduced launch.

Report schema 2 records `KOVA_LAUNCH_PAID_SUBSCRIPTIONS` and
`KOVA_LAUNCH_IMAGE_GENERATION` as explicit 0/1 configuration choices (default 0).
Paid launch additionally requires Stripe and server access-limit verification;
image launch additionally requires generation and cost-control verification.
These report flags do not enable either runtime. Runtime configuration must agree
with the reviewed proposal before deployment.

## Connector CI and Markdown repair verification

The Nexus assertion no longer assumes every connectable plugin uses Google OAuth.
It checks the current supported-connection filter and the separate unavailable
filter; authenticated Google configuration checks remain intact. Existing runtime
tests still enforce unavailable providers and reject fabricated callback success.

For this repair, typecheck, changed-file lint/format, production build and bundle
budget pass. The build used `NODE_OPTIONS=--max-old-space-size=6144` after the
local default heap was exhausted. The source/build dependency-removal audit passes.
Integration: 502/503 pass; the only failure is the local worker's
`uv_interface_addresses` host-runtime error, before route assertions. No test is
skipped or weakened. Chromium's actual assistant-component regression passes.
Local Firefox times out during page setup and WebKit lacks host libraries; neither
is reported as a pass. Hosted exact-head CI remains required for these gates.
These checks do not certify a deployed user journey or the complete migration.

## Complete Calendar approval details

Newly prepared Calendar actions now show the full validated event title,
description, location, start/end instants, specified time zone, primary-calendar
destination and all attendees. The previous preview shortened the title/location/
description and omitted attendees after the tenth; the card did not render the
description or time zone. The short summary remains only a heading. Long
descriptions scroll without discarding text, and the selected Google account
remains visible.

The existing owner/account-bound pending action, confirmation, cancellation and
atomic execution path is reused without changing its authorization or database
contract. Rendering does not execute a provider action. The new regression uses
13 attendees and long field values, executes the actual preview builder and card,
and checks both Confirm and Cancel requests. It passes with the existing Google
write/confirmation regressions: 24/24 focused checks. Typecheck and changed-file
lint/format pass. The Azure/Node production build, bundle budget and source/build
dependency-removal audit also pass. A live Google event operation is still unverified.

## Superseded CI cancellation

The database, browser and release-E2E compute jobs now use `!cancelled()` instead
of job-level `always()`. An obsolete database job was observed continuing after
its verify job failed and while the next head's workflow waited. Current-head
database evidence still runs after an unrelated verify failure; browser/E2E
success, scope and draft conditions are unchanged. Artifact-upload cleanup keeps
its existing cancellation behavior. This change does not retroactively alter
jobs already running with the previous workflow definition.

Nine focused CI-budget/migration tests pass, including actual workflow-expression
evaluation for current, cancelled, failed, irrelevant and draft cases. Formatting
and affected lint pass. Application source is unchanged from the verified
Calendar repair. Reference: [GitHub workflow cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation).

The protected acceptance automation supplies `KOVA_GATE_<NAME>` results and
`KOVA_PLUGIN_<ID>_<OPERATION>` results, replacing hyphens with underscores in
plugin IDs. Operations are CONNECT, READ, DISCONNECT and ISOLATION. Missing results
remain not-run and block promotion. These fields summarize real acceptance
receipts; setting them does not execute a journey or prove that one happened.
Owner-approved report hashing, exact-commit checks, cleanup and explicit human
promotion authority remain required. No promotion workflow is run here.

## Hosted assertion repair and verified recovery

Azure CI on `d5f9f64b1157b8d971b733546982f1ff718ac040` passed formatting,
lint and typecheck, then failed one of 3,450 unit tests because an older test
still expected job-level `always()`. Both affected source-test files now expect
the cancellation-aware expression while retaining every required scope and
success condition. Fresh local verification: **3,450/3,450 unit tests pass**,
plus **13/13 focused workflow and browser-preview checks**, with no skips.
Hosted final-head CI remains a separate required result.

The actual GitHub source artifact from run `37677607559`, artifact
`11507580855`, was downloaded and both `SHA256SUMS` entries verified. Its
`candidate.bundle` SHA-256 is
`9c31db4f9b563b5f1ed8968880514619d65da8007d143de9b3bb3de23ffc6aaf`.
An independent bare clone of `evidence-candidate` restored exact commit
`d5f9f64b1157b8d971b733546982f1ff718ac040` and tree
`8f343083aa6bbd165600427491af979adb40d9fe`; full Git object verification passed.
This artifact expires October 8 at 19:51:16 UTC under the existing one-day
retention policy. Published source remains in the Git branch. Every later
candidate needs its own matching source artifact; this proof is not silently
rebound to a newer commit.
