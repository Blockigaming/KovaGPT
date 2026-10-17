# Hosted email callback correction and controlled verification

This extends existing PR #452. It does not deploy, change Supabase configuration, initiate sign-in, reset credentials, consume a rehearsal grant or authorize cutover. Terminal owns integration and release. PR #450 remains the separate project-navigation dependency.

## Incident evidence and limits

The retained October 15 8:18:44–8:18:48 PM EDT evidence records an existing-account server session/login using the implicit flow, followed by a one-time-token rejection. The owner reports that Kova never showed a signed-in session. There is no application acceptance credit. These events do not identify the first consumer, establish identical links, or measure email delivery/application latency. The prior browser-tool timeout is not an application timing measurement.

The observed live asset was `/assets/index-DOVkZ3ly.js`, with no exposed commit identity. A bounded asset read returned HTTP 403. No deployed-source equivalence is claimed. Origin differences, duplicate processing and prefetch remain possible explanations, not incident conclusions. The earlier expired-link messaging correction and the original API fix in PR #452 remain useful but are not proven fixes for this incident.

## Reproduced application defects

Tests execute the actual callback/provider modules and installed Supabase AuthClient using nonsecret local transport/storage fixtures.

- Synchronous effect cleanup/replay scrubbed the fragment in the cancelled effect before the surviving effect could persist it. Both root fallback and dedicated callback cases failed. Defer callback ownership to the surviving effect's microtask; keep abort and authority-generation checks after every await. This protects effect replay; it does not promise recovery after a user closes or navigates away during authentication. The current app entry has no StrictMode wrapper, so this reproduction does not establish a production occurrence.
- Successful callbacks called `setSession` twice. The second call repeated current-user fetching and SIGNED_IN notification. Keep one SDK write, then read persisted state and validate the authoritative user and matching identities.
- A delayed initial empty-session event could arrive after fragment scrubbing, invalidate the callback and classify the browser as a guest. Ignore that initial empty event when the effect began with a callback. A fixture upstream 503 now remains unresolved with its classified failure, without deleting account data or claiming a guest session.

## Diagnostic behavior

Explicitly opening `https://kovagpt.com/?sign-in=1&auth_debug=1` opts this browser origin into diagnostics for 30 minutes. Only an expiry marker crosses tabs; each tab retains at most 64 sanitized events in session storage, with an in-memory fallback if saving fails. A diagnostic panel and fixed-prefix console output expose the same safe fields. Ordinary sign-in has no panel or recording.

Both email-request surfaces, implicit/PKCE callback, authority resolution, SDK session write, persistence read, current-user/MFA validation, callback navigation, UI principal and logout record phase and elapsed milliseconds. Status is the SDK-reported error HTTP status when available; null is unknown, never an invented successful HTTP response. Error classes/codes, origin/route classes and identity-match booleans are allowlisted. No email, identity, token, full URL, query value, provider message or response body is exported. Data loaded from storage is sanitized again.

Email delivery requires separately observing receipt time. Browser automation delays remain separate. The diagnostic origin comparison describes configuration; it does not prove which redirect the server used.

## Terminal release and one observed sign-in

1. Integrate this PR and complete the existing release gates. Capture the final deployed revision from `/api/version` and verify it matches the integrated artifact. Do not substitute the repository head or an asset filename for deployment evidence. Release remains separately authorized; draft/skipped CI is not a pass.
2. Open the opt-in page above in the observable Cloud Browser. Use the existing account's supported email-link method, requesting one fresh link. Record request timing, receipt time and callback diagnostics. The owner opens the email privately in that same observable browser; never paste a link, token or password into chat. Do not replay the old link or resubmit on a tool timeout.
3. Require visible signed-in Kova, the existing authorized saved record, refresh persistence, logout and an authentication gate on protected access. Keep the prior Google journey separate. Capture actual protected API responses separately from database isolation.
4. If a stage fails, retain the sanitized diagnostic and stop that sequence. No blind retry, replacement account, password reset or self-hosted activation.

## Prepared email

`supabase/templates/magic-link.html` is rendered from the existing React Email template by `node scripts/email/render-magic-link.mjs`. It preserves the original Kova logo and the exact `{{ .ConfirmationURL }}` variable for both sign-in links. No token rewriting, tracking, redirect substitution or authentication configuration is added. It improves hierarchy, spacing, button size and fallback-link readability using the existing neutral/violet identity. This is prepared output, not proof of the provider's current template or email-client delivery/rendering. Publishing it is a separate Terminal/configuration handoff.

## Validation

- Eight new actual-path cases cover root/route effect replay, one-write session/refresh/logout, an SDK 503 with stage timing, bounded redaction despite failed evidence saving, opt-in isolation, and both real email-request surfaces.
- Five retained expired-link cases and affected authority, cancellation, recovery and cross-tab boundaries pass. The focused combined set passed 70 cases; the two added initiation cases passed separately (72 distinct cases total).
- Rendered email variable/link invariants passed; existing shared email-brand checks were retained and passed.
- TypeScript and full local application build are recorded in the PR/verification record. Browser email screenshots were not produced: this executor lacks a Playwright browser. This does not block the source/rendered-HTML handoff, and it is not represented as visual acceptance.
- No live email journey, production API isolation or deployed-revision acceptance is claimed by these offline tests.

Supabase remains active. All consumed grants remain closed. Grant `s6-20261015-runner-diagnostics-01` remains approved and unused with its original budget, readiness, watchdog, timing, restoration and cleanup requirements. Models' Cloud Shell is untouched.
