# KovaGPT public website review

This branch is an implementation candidate. It is not approved for merge or production deployment.

## Scope

- Reuses the existing `NovaLogo` and `/kova-logo.png` throughout the landing page, authentication, and footer.
- Minimal black landing page, system serif headings, shared Google/GitHub/email authentication handlers, original supplied classroom photo, Individual and Team/Enterprise pricing, native FAQ disclosures, and six footer groups.
- 105 distinct catalog pages. The requested 111 paths plus additional useful help pages total 114 routes in `route-inventory.json`; retained core routes are reused. A route count is not proof of runtime success: the browser workflow records each actual result.
- Read-only product, connection, developer, security, legal-directory, company, and help content. Existing legal documents remain authoritative. Summaries do not amend policies. Draft developer/contractual and unavailable-product pages stay noindex.
- Login and signup entry routes preserve a safe post-authentication destination. Protected app routes still require the existing account gate.
- Incorporates the guarded hosted GitHub login work from PR #562. Kova-only GitHub identity adoption is not implemented or enabled. Hosted GitHub login and GitHub repository connections stay separate.
- New homepage paid actions read the authenticated server subscription summary before opening existing Stripe Checkout. Existing subscriptions, inherited access, and conflicts go to Billing. Account changes invalidate pending checks and close account-scoped checkout.
- The retained Pricing route also withholds checkout immediately when its owner logs out, changes accounts, or becomes unresolved, and clears the old checkout before that identity can return.
- Checkout initialization now shares one attempt across parent renders and Stripe callbacks, and missing Stripe browser configuration displays a recoverable error instead of throwing during rendering.
- The branch incorporates current `main` correction #563 for Free Scheduled Tasks admission.
- No database migration, secret change, production flag activation, existing-subscription repricing, Azure change, or production deployment.

## Read-only Stripe catalog observation — November 3, 2026

The connected KovaGPT live account `acct_1UAeDgAEZlsb6DBY` returned these active USD monthly recurring prices:

| Lookup key   | Price                          | Amount    |
| ------------ | ------------------------------ | --------- |
| plus_monthly | price_1UAzhHAEZlsb6DBYWw2oUCeO | $16/month |
| pro_monthly  | price_1UEw6FAEZlsb6DBYuksCKOBR | $80/month |

No price migration is needed. No account, customer, payment, subscription, webhook, or portal configuration was changed.

## Dependencies and acceptance gaps

1. The provided original classroom image is 164×117. Its exact content is used, without an AI substitute or cropping from a generated mockup. A higher-resolution original is needed for a sharp desktop hero.
2. The existing monthly billing rollout gate remains intact. Checkout is intentionally unavailable unless its qualified policy/runtime and database dependencies are enabled. See `docs/release/STRIPE_BILLING_ROLLOUT.md`. This branch does not bypass that rollout.
3. The connected Stripe session exposes only a live account. No Stripe test-mode customer, Checkout, upgrade/downgrade, payment-failure, or portal acceptance is claimed. Local billing tests use explicit fixture boundaries.
4. GitHub OAuth requires the provider setup in `docs/auth/github-sign-in.md`. Kova-only GitHub sign-in remains unsupported. All real OAuth callbacks, verification, password recovery, and session-refresh acceptance need an authorized account against the intended configured environment.
5. No supported desktop installer was found; Downloads truthfully explains web availability. Team and Enterprise are not offered for purchase; contact uses the existing email-draft workflow and does not claim delivery.
6. A localhost preview cannot be reached from this session's remote browser. The dedicated GitHub Actions workflow builds this exact branch and collects actual browser screenshots, responsive checks, route results, and a test report. These are implementation evidence, not production or live-provider verification.

## Validation

Use `npm run typecheck`, `npm run test:unit`, `npm run test:api`, `npm run test:integration`, and the existing release checks. The new `public-website.test.mjs` covers distinct content, indexing, intended-plan preservation, existing subscription protection, Free checkout admission, failed verification, and stale-account invalidation.

`Public website approval evidence` runs a production Node/Azure build with no secrets, visits the real routes, tests desktop and mobile widths from 320 to 2560, checks the FAQ and pricing toggle, and exports screenshots. Email entry uses a synthetic `.invalid` address and stops before authentication submission. No real account or charge is created.

The earlier complete local unit run passed 7,426 tests with four existing skips and no failures. All 65 API tests and 61 focused billing contract tests passed. TypeScript, formatting, source security checks, and the high-severity dependency audit passed. The audit reports four low and four moderate existing dependency findings. No dependencies were added. Use `node --test --test-concurrency=4 tests/unit/*.test.mjs` in a memory-limited workspace; this runs the same complete suite with bounded worker concurrency. Final candidate results belong in the PR and exact-commit workflow artifacts.

The GitHub browser run at commit `08a749868f1e7e3f269c9d423834499eb4712a18` passed its production build and all three approval tests, including 119 destinations returning HTTP 200, widths 320–2560 without horizontal overflow, pricing tabs, keyboard FAQ, and synthetic email entry. Later visual and regression refinements must be qualified by their own exact-commit workflow results. The workflow checks its build stamp against the candidate SHA and also exercises existing signed-out accessibility, modal authentication, theme, and navigation tests. Raw browser captures update only the intentionally changed guest visual baselines; visual assertions and thresholds remain intact.

The PR's final CI run and downloadable report are the authoritative final-candidate results. Fixture tests do not qualify real OAuth callbacks, email delivery, Stripe Checkout, subscription lifecycle, or Customer Portal acceptance.

## Approval and rollback

Show exact-commit CI and browser evidence, review remaining dependencies, and obtain owner approval before merging or deploying. Keep the current Azure revision and immutable image for rollback. These code changes are reversible; no data migration is included. Deployment must use the final approved merge commit and the existing `kovagpt-prod-web` app. Preserve secrets and rollback revisions, then verify the live domain before reporting production success.
