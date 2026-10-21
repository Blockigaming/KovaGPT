# Browser notification permission and quiet timer defaults (#328–329)

Date: 2026-10-18 UTC. Bounded source changes to PwaSettings, TimersWidget, and the service worker notification options. Rendered acceptance remains pending.

## Implemented

- The subscription action explicitly says **Enable browser notifications**. Permission is requested only through that existing action and its account-scoped Web Push client.
- Already-denied browser permission shows persistent guidance without requiring a failed click: use the browser's site settings for KovaGPT, change Notifications to Allow if available, then return or Refresh. The app does not claim it can change browser permission.
- Mount, window focus, and return-to-visible refresh the browser permission snapshot only. Focus/visibility never request permission, subscribe, call account endpoints, or overwrite unsaved quiet-hour edits. Explicit Refresh retains the existing account-status reload.
- Denied or dismissed permission results update the UI immediately. A saved subscription is not presented as enabled when browser permission is no longer granted. Granting permission in site settings does not silently create a subscription.
- Backend readiness, per-owner remounting, abort/generation fences, and duplicate-action guards remain in place. New permission listeners are removed on unmount/account replacement.
- Starting a timer no longer requests notification permission. Due timers keep their existing toast and at-most-once accounting, use only already-granted browser permission, do not beep, and request silent OS notifications. No existing explicit notification-sound preference was found; no new sound preference or timer permission flow was introduced.
- Service-worker push delivery explicitly uses `silent: true`. Its generic payload text, subscription/owner validation, durable deduplication, and notification-click controls remain unchanged.
- Existing visual tokens, container geometry, timer controls, and account/service contracts are retained.

## Verification

- `node --test tests/unit/spec400-browser-notification-permission-runtime.test.mjs tests/unit/pwa-client-runtime.test.mjs tests/integration/timers-truthfulness-source.test.mjs`: 18 passed, 0 failed. Eleven new component/worker-runtime cases exercise controlled hooks, event listeners, transport stubs, fake notification APIs, and an in-memory metadata adapter.
- Coverage includes initial denied state with successful/failed status loading, default/granted states, explicit opt-in and duplicate clicks, dismissed/denied results, read-only focus/visibility refresh, preserved quiet-hour edits, backend unavailable, unsupported browser, signed out, aborted account replacement, listener cleanup, silent timers, once-only expiry, silent push delivery, durable push deduplication, and rejection of mismatched owners/subscriptions or malformed/stale/future payloads.
- Focused ESLint for both changed components, full `npm run typecheck`, Prettier for all five changed files, `node --check public/kova-sw.js`, and `git diff --check`: passed.
- No build, browser session, real permission prompt, real notification, provider call, deployment, purchase, or production mutation was performed.

## Limits

No remaining source-level permission/sound contract gap was identified in this bounded scan. Backend readiness still gates subscription; no new delivery backend or sound preference was added. Browser-rendered permission-state acceptance, service-worker activation, and actual OS delivery were not performed in this worker.
