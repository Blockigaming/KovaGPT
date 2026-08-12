# Interactive product parity release report

**Audit date:** 2026-08-12  
**Scope:** KovaGPT application shell, composer, conversation, product workspaces, responsive states, accessibility, privacy, and release gates.

## Evidence boundary

The dated public inventory baseline remains unchanged: 35 OpenAI sitemap families, 97 ChatGPT primary-sitemap URLs, 132 unique dispositions, 105 individually reviewed noindex routes, 24 sitemap entries, and English as the only published locale. Live authenticated ChatGPT and private account behavior were not available in this environment. The matrix therefore identifies reference behavior as unavailable rather than presenting inference as direct observation.

Repository code, deterministic tests, production-preview HTTP checks, and signed-out/protected-route screenshots are direct KovaGPT evidence. No real provider generation, Stripe charge, OAuth exchange, public-share publication, or authenticated visual fixture was executed because credentials were not supplied.

## Implemented findings

- Composer drag-and-drop now exposes a visible, reduced-motion-compatible drop target while reusing the same type, size, count, and quota validation path as file selection and paste.
- Removing an attachment now cancels the in-flight local read boundary so a late `FileReader` or text read cannot silently restore the removed card.
- Streaming assistant messages expose a concise polite status for progress and completion without announcing every token.
- The signed-out data disclosure no longer states an unverified model-training practice and links users to the privacy policy for actual retention and provider details.
- Projects loading, signed-out, and authenticated content now use a main landmark; the finding was discovered by the application screenshot gate.
- A generated 49-journey parity matrix records entitlement, visual, functional, accessibility, privacy, decision, and evidence fields for every row.

## Matrix totals

| State                   |  Count |
| ----------------------- | -----: |
| Complete                |     33 |
| Partial                 |      8 |
| Missing                 |      3 |
| Intentionally different |      2 |
| Blocked                 |      1 |
| Excluded                |      2 |
| **Total**               | **49** |

## Visual evidence

The application matrix contains 16 deterministic cases: signed-out chat at 320, 390, 768, 1280, 1440, and 1920 pixels in light and dark themes, plus Projects, Library, Images, and Apps states. The public-template matrix remains 12/12. Artifacts are written to `artifacts/product-parity/` and `artifacts/page-parity/`; machine-readable findings are in `application-visual-results.json` and `docs/page-parity/visual-results.json`.

The visual harness checks HTTP 500 responses, horizontal overflow, main landmarks, focus entry, unnamed visible controls, H1 counts, and console errors. Signed-in screenshots remain blocked on an authenticated fixture; they are not represented as tested.

## Remaining gaps by severity

### Critical

None found in the audited deterministic boundaries.

### High

- Public share creation and revocation remain unreleased. The existing route fails safely without loading private conversation data. Next: design a revocable, owner-authorized persistence model with abuse review and expiration.
- Authenticated screenshot journeys require a purpose-built non-production identity fixture. Next: connect the existing authenticated release harness to an isolated seeded tenant rather than bypassing authentication.

### Medium

- Long-thread virtualization and durable cross-refresh stream resumption are absent. Next: introduce measured windowing and a server-owned resumable event cursor without changing current provider rollback behavior.
- Project role depth, canvas public collaboration, shopping merchant feeds, and a complete administrator pricing workflow remain partial. Next: address each as a separately threat-modeled product slice.
- The full integration source-contract collection reports 246/285 passing. Its 39 failures are exact-source assertions that diverge from the current architecture (including agent attribution, model chooser wording, guest timing, workspace source patterns, generated Worker expectations, and optional-provider copy). They were not rewritten in bulk because doing so without individual architecture evidence would weaken the gate. Unit, accessibility, and visual source suites remain green.

### Low / intentional

- Full-duplex Voice and native application distribution remain excluded; browser dictation and responsive web are the truthful supported surfaces.
- Maps remains a location-free, noindex preview. Scheduled execution remains visibly blocked until a production runner is configured.

## Release assessment

The evidence-backed journey completion estimate is **67.3% complete** (33 of 49 rows). Including intentional differences and exclusions as resolved dispositions, **75.5%** (37 of 49) have a final product decision. This is not a claim of exhaustive live parity.
