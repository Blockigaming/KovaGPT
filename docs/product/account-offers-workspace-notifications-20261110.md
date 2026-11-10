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
