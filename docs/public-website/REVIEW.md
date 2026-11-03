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

The initial GitHub browser run at commit `711636e97f1ee99525c511a6430b6207139069b8` passed its production build, loaded all 119 checked destinations with HTTP 200, and reached the existing password page from a synthetic email. Its FAQ selector timed out before responsive checks; that locator was corrected for the next run. The initial screenshots demonstrate implementation but do not qualify a later commit.

## Approval and rollback

Show exact-commit CI and browser evidence, review remaining dependencies, and obtain owner approval before merging or deploying. Keep the current Azure revision and immutable image for rollback. These code changes are reversible; no data migration is included. Deployment must use the final approved merge commit and the existing `kovagpt-prod-web` app. Preserve secrets and rollback revisions, then verify the live domain before reporting production success.
