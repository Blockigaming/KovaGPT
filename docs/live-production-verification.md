# Live production verification

The live suite is intentionally separate from local E2E tests. It does not start
a preview server and defaults to `https://kovagpt.com`, preventing a production
check from silently passing against localhost.

## Owner-run command

```bash
npm run test:e2e:production
```

To verify an approved staging hostname instead, provide an HTTPS URL explicitly:

```bash
KOVA_PRODUCTION_URL=https://staging.example.com npm run test:e2e:production
```

The anonymous suite is read-only. It checks public-route rendering, same-origin
5xx responses, browser and console exceptions, desktop/mobile overflow, security
headers, navigation, Settings dismissal, and focus restoration. It does not send
chat messages, create accounts, mutate data, or exercise billing.

## External access required

The current automated environment receives an Envoy `403 CONNECT tunnel failed`
before reaching `kovagpt.com`. An owner must run the command from a network that
allows outbound HTTPS to the production domain, or allowlist `kovagpt.com` in the
verification runner. This is a runner-network action, not an application or DNS
change.

Authenticated verification additionally requires an owner-provided non-production
QA account and must be performed manually until a secret-backed CI project is
approved. Verify Clerk sign-in/sign-out and persistence, Supabase-backed workspace
isolation, chat streaming, uploads, provider failures, Stripe test-mode checkout
and portal return, Google OAuth redirect URIs, scheduled execution, and connected
apps. Do not place credentials in repository files, Playwright traces, screenshots,
or pull-request text.
