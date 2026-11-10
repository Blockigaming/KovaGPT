# KovaGPT notification and pop-up contract

Owner specification: 2026-11-10 uploaded notification inventory (all categories).
This document distinguishes **shared UI primitives** from **working event integrations**.

## Presentation rules
- Neutral background, accessible typography, rounded 14px toast / 20px modal / 24px mobile sheet, coherent theme variables, subdued elevation.
- Desktop: anchored popover or modal for actions; transient toasts bottom-right; inline warnings near the failed operation.
- Phone: touch targets >=44px, scrollable notices and buttons reachable above safe area/keyboard; transient toasts bottom-center above the composer; larger mobile action targets. Tablet uses available window width, not device name.
- Transitions: 120-220ms fade/scale for popovers, 260-300ms for mobile sheets, 160-180ms for toasts. Respect prefers-reduced-motion. Avoid bouncing, blinking, multiple blocking dialogs.
- Error -> display actual cause and retry, preserving the user's draft. Success -> only after a confirmed mutation. Permission -> user-initiated system-owned prompt. Allowance -> actual backend state and reset time when known; never invent counts.
- A modal traps focus, Escape closes only where safe, focus returns to trigger. Important warnings do not disappear before reading. Decorative announcement never preempts security or in-progress work.
- Announcements require entitlement and a real destination; dismissals scoped by user and release. No persistent spam after dismissal.
- Destructive actions require confirmation; cancellation does not mutate persisted data.

## Coverage matrix
| Family in attached inventory | Expected surface | Integration authority |
| --- | --- | --- |
| New features / What's new / Try this / discovery tips | Contextual card, coach mark, optional sheet | Feature entitlement + release state |
| Onboarding / tours | Inline guidance / skippable tour | Per-user onboarding state |
| Reasoning and model usage limits | Composer inline warning | Server usage counters |
| Upgrade offers / checkout | Rounded offer card and guarded checkout | Billing and Stripe server state |
| Images / edit / animation / reference saves | Result card with status + contextual errors | Generation/editing operations |
| File / storage / Library errors | Attachment card / affected file | Upload and processing results |
| Voice, microphone and dictation | Voice-screen status | Voice session and device permission |
| Search, research, analysis, interactive widgets | Inline tool result and recoverable error | Tool invocation state |
| Scheduled Tasks and reminders | Durable task card and activity notification | Task scheduler |
| Projects, sharing, Connections, workspaces | Contextual confirmation, permission/invite card | Server membership/authorization |
| Security, privacy, account, billing | Persistent notice or protected confirmation | Auth and billing state |
| Success confirmations / errors | Small toast, inline error | Confirmed mutation/error |
| Feedback and surveys | Optional nonblocking card | User action |

## Priority and state
Security/permission/required confirmation > technical failure > hard limit >
task result > lightweight success > discovery promotion. Never stack two blocking dialogs.

Lifecycle: eligible -> queued -> entering -> visible -> loading (if an action) ->
succeeded/failed -> dismissed or resolved. Closing a restriction banner never removes
the underlying restriction; refreshing or switching accounts must re-check server state.

## Acceptance matrix before deployment
Test at 1440px desktop, 1024px tablet, 390px and 320px mobile, landscape,
keyboard open, browser zoom 200%, both themes, reduced-motion and screen readers.
Every family must be tested for visibility trigger, correct placement, close/escape/
back, loading/success/failure/dismissed, account switches and persistence.

## Implementation status (source code, not production acceptance)
- Existing Sonner toast system now shares rounded themes and desktop/mobile presentation.
- New KovaNotice primitive implements inline and modal **visual structure**. It does
  **not** create backend events or override existing feature-specific screens.
- Existing notifications page persists app and agent events; owner workspace join
  request inserts a record there once per request.
- The large supplied catalog is an **acceptance inventory**, NOT a claim that every
  original proposed event has a working producer/consumer in this PR.
- Workspace discovery additionally requires organization administration configuration,
  this migration applied, and verified domain state.
