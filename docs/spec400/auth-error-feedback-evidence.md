# Persistent authentication feedback

The dedicated auth route now keeps actionable error feedback visible until dismissed, superseded, corrected or abandoned. One route-scoped identity deduplicates current errors; it is retired before retry to avoid Sonner's deferred dismissal removing a new error. Context/unmount guards suppress stale responses. Correcting password length clears its validation error; provider rejection remains until the next attempt or dismissal. Existing provider calls, success notices and destinations are preserved.

Verification:46 focused tests, including12 new lifecycle/provider-path cases; typecheck, scoped lint and formatting pass. No credentials, browser submission, live authentication or recovery request was used. This closes the dedicated route's source gap only; other actionable error consumers and actual auth-return environments remain independently scoped.

The existing45/60-second browser cooldown is now explicitly labeled a local delay. Its countdown does not claim the provider's authoritative resend availability. Request timing and provider contracts are unchanged; service-owned retry metadata remains a contract gap.
