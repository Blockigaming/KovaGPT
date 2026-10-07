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

Google Connect/Add/reconnect requires authenticated configured status, including
in event handlers. Callback query strings cannot manufacture connection success.
The catalog retains all 360 entries: 355 planned and unconnectable, five source
integrations requiring setup/runtime proof, **zero certified operational**.
Google/Gmail/Drive/Calendar share the existing OAuth contract; GitHub uses its
existing installation/repository manager. Planned entries remain unfinished scope.

## Verification and launch gates

Fresh Node tests execute the actual persistence helper and component code with
controlled storage/auth/provider boundaries. Typecheck, lint, formatting and a
production build are separate gates. Remote CI must run against the published
head. Local browser capture is not attempted; hosted CI follows the owner's
explicit remote-check authorization. Mocked fixtures do not prove deployed flows.
The final receipt records exact commands, source/tree IDs, results and artifacts.

| Journey                                 | Existing application implementation                                         | Remaining real acceptance                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sign in → prompt → stream → save/reopen | Auth wrapper, chat SSE, principal-scoped history, recovered routes          | Accepted Auth session/storage and affordable Models runtime; actual stream, stop/retry, reload and second-device history |
| Projects/files                          | Authenticated CRUD/membership, private uploads, bounded document extraction | Create/upload/read/reopen/delete, two-owner isolation and revoked downloads on deployed storage                          |
| Images                                  | Image request and library persistence paths                                 | Approved provider/budget, generate/save/reopen/download and failure accounting                                           |
| Scheduled tasks                         | Task CRUD, grants, worker protocol and run history                          | Enabled worker/trigger; due-time execution, deduplication, delivery and cancellation                                     |
| Plugins                                 | Five catalog entries with Google/GitHub implementations                     | Consent/status/permitted operation/disconnect/denied reuse; 355 planned entries still unimplemented                      |
| Subscriptions/access                    | Checkout, portal, webhook and entitlement code                              | Accepted Stripe configuration and sandbox proof, webhook-backed upgrade/downgrade, direct API denial                     |

No deployed end-to-end journey is certified by this source candidate. Retained
account, billing, privacy and terms routes remain part of launch scope.

## Specialist dependencies and configuration

Auth PR #443 remains `e43686bc123f2e5efcd32a69e843f3fd4bf61b49` at this review.
Auth owns migration and storage/revocation acceptance. Regenerate the route tree
from both accepted route sets during future integration; do not overwrite it.
Security PR #444 is `74e2fba1e0fc74ab36c237b033b03d097c49b0ef`, still draft and
not integrated here. Its assistant-Markdown image repair remains a launch dependency.

The recorded Models source handoff is `05bd4a159aa476067b91c49559b702643386f9e4`,
with `current-product-policy.v4.json` and `kova-assistant.v3` request fields
`model_id` and `effort_id`. Trusted entitlements do not establish availability.
The accepted single affordable model endpoint, streaming/cancellation, admission,
usage/cost and error contracts remain required. No Models infrastructure, hosting,
evaluation or backend policy is duplicated here. No Interface spending is authorized.

Azure retains the validation-only activation freeze. Required production inputs
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
