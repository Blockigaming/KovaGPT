# Account menu, workspace discovery and notification acceptance

Status: **implementation in progress; NOT production ready.** Reference: owner's 2026-11-10 three screenshots and 1,205-line supplied notification specification. This document is a release contract, not evidence of a completed UI.

## Account and offer UI

- Signed-in desktop account menu: dark neutral rounded popup, avatar/name/plan first, divider, contextual "Try Plus free" **only if a real, eligible promotional offer exists**, "Find workspaces" **only with a verified organizational match**, Personalization, Profile, Settings, divider, Help, Log out. Chevron on account/help/log out rows when a secondary view exists.
- Free-offer discovery: compact gift icon with "Free offer" at the upper-right navigation location. Alternative left-side mobile account presentation: avatar/name/plan and rounded "Claim offer" row as shown in supplied screenshot. Placement follows responsive shell and must not obscure app navigation or composer. Never expose this action for noneligible accounts or a campaign whose backend does not actually support redemption. Offer CTA uses a server-issued eligible offer/checkout destination, never an invented coupon or automatic upgrade.
- Account/Settings should follow attached screenshot hierarchy without leaking personal email or workspace membership. The current implementation is in `src/components/Sidebar.tsx` and `src/components/SettingsDialog.tsx`; do not confuse existing WorkspaceSearch (user's personal content search) with organizational workspace discovery.
- Mobile: full-width safe-area-aware scrollable sheet or drawer, touch targets >= 44 px; desktop popup anchored to its trigger. Keyboard-focus and Escape dismissal; reduced-motion support.

## Workspace discovery security contract

- Show entry only when email is verified **and** the backend returns one or more Kova workspaces with a verified domain association. A business-looking email address, MX record, or mere suffix is **not** proof a workspace exists. Personal consumer domains are never eligible.
- Search is authorization-filtered and no more revealing than verified membership policy permits. Never enumerate private organizations from arbitrary user input.
- On Request to join: authenticated server checks account state, email verification, verified domain mapping, specific workspace policy, existing membership, request permissions, denial/cooldown and rate limits. Require an explicit user click. Durable unique pending-request record and idempotent resubmission. Send administrator notification/email via configured dispatch queue; notification delivery status must reflect actual dispatch, not an optimistic fake success.
- Administrator can approve or deny with server-enforced owner/admin authorization; accepted requests create membership only after authorization; rejected/expired requests do not. Notify requester of disposition. Record audit trail, retry failures and protect request contents. Do not leak an admin's private address.
- Existing team-billing membership/invitation logic must be audited before introducing new tables or endpoints; do not silently bypass invitations or paid seat allocation.

## Shared notification system

- One semantic registry for event identifier, entitlement check, trigger, severity, host surface (toast/inline/modal/sheet/status), primary/secondary action, cooldown/dismissal, persistence, accessibility label, and telemetry. Do not use a generic modal for every outcome.
- Required families in supplied specification: release and feature announcements; welcome and onboarding; discovery tips; model/reasoning quotas; upgrade offers; image/generation/editing/animation; file upload/Library/storage; Voice/microphone; research/web/search/analysis; Scheduled Tasks/reminders; Projects/collaboration/connections; authentication/security/privacy/settings; success/error/recovery; feedback/surveys; browser/native permissions and update prompts.
- Proposed dark colors: background #171717, dialog #292929, raised #303030, border #424242, primary text #F7F7F7. Light: background #FFF, dialog #FFF, secondary #FAFAFA, border #E5E5E5, heading #171717. Accent only when meaningful: success/technical failure/warning/discovery. Consistency with actual Kova design tokens takes precedence over hardcoded duplication.
- Suggested desktop widths: popover 280px, modal 460px, announcement <=560px; corners around 20px, toast around 14px. On mobile 12–16px edge clearance, 20px inset, 48px action height, sheet top corners 24px, max 85dvh with scrollable content; respect safe areas and keyboard.
- Suggested motion: desktop modal fade+scale 180–200ms; mobile sheet slide 260–300ms; tooltip 120–160ms; toast 160–180ms; close 140–240ms. Reduce or remove animation with prefers-reduced-motion.
- Suppression: no popups while composing/recording, do not stack sales prompts, dedupe event IDs across refreshes/accounts where appropriate. Announcements only when real and eligible; user dismissal respected. No fabricated quota/reset time, fake task success, unavailable tool CTA, or auto-triggered permissions.
- Errors remain alongside failed operations and preserve user drafts; durable task and membership states live in their respective views; success toasts are short; destructive actions confirm; native permissions remain system-owned.

## Required release acceptance

1. Verified desktop dark/light and iPhone/Android/tablet responsive screenshots for account popup, eligible promotion, ineligible promotion, discovery hidden/shown, join request, pending, approved/denied, and failure.
2. Real server authorization and administrative notification/email tests; duplicate, cross-tenant, unverified, personal domain, stale email, race, seat exhaustion, and dispatch failure cases.
3. Semantic event catalog coverage mapped to source notification specification, tests for all events supported in Kova, and intentionally unavailable features marked as such (not a fake popup).
4. Focus, Escape, outside click, screen-reader live regions, tap targets, browser back, reduced motion, safe areas, and keyboard focus return.
5. Existing CI and browser gates green before merge; production deployment separate, with secrets and rollback preserved.

No claim is made here that all supplied notifications, promotion eligibility, or workspace request delivery currently exist.

## 2026-11-10 trigger-wiring checkpoint

The common notification host is mounted in the application root, scoped to the authenticated account, and queues blocking notices. Event dispatch has been added at actual operation result boundaries for: composer attachment validation and extraction; durable Library autosaves; image generation/save/copy; Voice recording/transcription/playback/errors; chat request quotas, session and network failures; scheduled task creation/update/pause/resume/deletion; Project creation/update/deletion/comments; share-link copy/revoke; connected account disconnect and verified Google OAuth return; password change; appearance; email notification preferences; and team workspace join and owner review. Browser online/offline events are also mapped.

**This is not 100% of the 228 catalog IDs.** The catalog is a vocabulary, not a claim that each event has a live supported feature. Future work is required for complete signup/offer promotion, release announcements, onboarding tours and coach marks, all connected providers, billing lifecycle, background task run delivery and push/email preferences, permissions, rate counters, server capability gating, accessibility/browser acceptance and full source-trigger coverage. Do not display promotional notices for features or offers that do not have authoritative eligibility.

Workspace domain registration requires a privileged external domain verification process; the new table does not create matches automatically. Signed worker retries for workspace-join emails are bounded by a claim lease, six attempts, and a 20-hour deduplication window. A durable request does not guarantee provider delivery. Owner approval is a prerequisite to the existing paid-seat invitation, not membership itself.

The PR must remain a draft. Do not merge or deploy until the full required CI, rendered mobile/desktop browser, database migrations, owner email and promotion verification all pass. Run `tests/unit/notification-live-trigger-source.test.mjs` alongside the catalog and workspace eligibility unit tests. No production acceptance is claimed.

## 2026-11-10 additional audit and trigger implementation

- Added a catalog-wide source trigger audit: `node scripts/audit-notification-coverage.mjs` prints each notification ID, group, and directly emitting application files; `--require-complete` fails if any ID lacks a direct source emitter. This **is not an end-to-end runtime certification**.
- Added new verified result-bound paths: Stripe checkout redirect/failure, signup verification step, saved onboarding completion, support message acceptance. Checkout redirect **must not** claim successful payment and signup email step **must not** claim provider delivery.
- Added per-user, campaign-version-scoped dismissal persistence for onboarding/discovery/marketing notifications, with operational alerts unaffected; blocked local storage does not hide critical messages.
- Added source audits and regression tests. This effort does not imply all 228 events have live callbacks; some catalog items describe feature classes not present or not authorized in this deployment.
- **Release blocker:** finish server/event-source binding for each available action, give each distinct event real eligibility/usage/recipient state, run `--require-complete` once every supported ID has an emitter, and validate critical journeys in a browser. Unavailable announcements must remain hidden rather than spoofing a fake completed feature.

## Notification UX & feature-event pass — 2026-11-10
- All 228 semantic IDs remain catalogued. Four UI families are differentiated:
  blocking modal / mobile sheet, inline operational status, lightweight toast,
  and nonblocking feature popover / release banner. Visuals inherit Kova light/dark
  tokens and use safe-area offsets and reduced-motion support.
- Low-priority discovery events must not open during typing, composition, an
  existing dialog or account menu. A contextual popover can locate a target
  with the optional `anchorSelector` on desktop; mobile converts it to an
  accessible bottom sheet. Banners stay nonmodal.
- File selection and actual document extraction now emit the file-selected
  and file-processing states. Project first-use only emits after a confirmed
  creation when the authenticated server-loaded directory was empty.
- Durable inbox task, project, connection, research, and security items map
  to their catalog identifiers; browser-session seen state prevents repeated
  popups while preserving unread server records. Fail-closed on unknown types
  or malformed links.
- Server-owned campaign availability, a verified offer, and workspace membership
  still require backend state. No synthetic subscription, authorization, task,
  or quota changes are generated to make the notification count look complete.
- Tests for popovers, banners, active dialog suppression, Library lifecycle,
  first Projects use, and inbox isolation were added. No production-readiness
  claim is made until CI, mobile+desktop browser, all event sources, and email
  workflows pass verification.
