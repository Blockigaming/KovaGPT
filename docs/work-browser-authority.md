# Private Work browser authority

The application adds a five-minute owner-controlled browser session to the isolated runner described in `work-interactive-browser.md`. It starts in takeover mode only after the Work run is paused and all started steps/effects have settled. The model cannot resume while a live takeover is recorded: a database trigger closes the cross-tab race.

Owner commands carry the captured account, run revision and exact session sequence. The backend admits each sequence before signing the transient command. It never stores URLs, DOM bodies, passwords, form text or screenshots in the session table. A failed or ambiguous action has no automatic retry; refresh state and inspect the destination before repeating a consequential submission. Explicit closure remains available after a model entitlement changes.

The isolated runner rechecks signed database authority around commands and each network request. Model browser operations additionally require the exact live Work step, input hash, consumed approval, effect, lease, deadline and session. Repeated admission returns the same sequence; the runner rejects consumed sequences. Owner release becomes durable only after the runner acknowledges it. Account deletion retains its fence and closes owner-labeled runner containers before Auth/metadata deletion.

The browser UI provides a text snapshot and explicit page controls. It is not a desktop screen-sharing implementation or a promise that every site's CAPTCHA, popup or graphical control is supported. Authentication happens in the takeover controls, never in chat. Browser process loss can invalidate a session; absolute expiry remains the recovery boundary.

Repository evidence: five actual-role SQL/policy cases, five actual API boundary cases, and two real Chromium production-preview UI cases covering control/fill/release/close, inert remote text, exact owner/revision transport, and account clear during a delayed private response. The UI tests use controlled API fixtures; the runner's real networkless Chromium and gVisor tests are a separate hosted CI gate. No live browser deployment, provider request or credential entry is performed by these tests.
