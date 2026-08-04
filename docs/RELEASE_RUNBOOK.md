# KovaGPT release and rollback runbook

## Repository readiness versus production readiness

Repository checks prove code and contracts. `/api/readyz` performs a bounded production dependency check. Optional providers are reported independently and never probed with paid requests. A release is not production-validated until an operator runs the staging smoke check with real staging configuration.

## Pre-deployment

1. Use Node 24 and the npm version bundled with it; install exactly with `npm ci`.
2. Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, one of `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`, Clerk server or publishable configuration, and one of `KOVA_PUBLIC_URL`/`APP_URL`/`SITE_URL`. Optional subsystems require their provider variables reported by `/api/readyz`.
3. Confirm the commit with `git rev-parse HEAD`, obtain a database backup, run `npm run release:manifest`, `npm run release:migrations`, and review `release-migrations.json`. Migrations are forward-only and applied lexically.
4. Run `npm ci && npm run release:validate`, all configured tests, and review `artifacts/release/bundle-report.json`.

## Deployment

1. Push migrations with the repository-supported command `npm run db:migrate`. Do not deploy application code if this fails.
2. Build with `npm run build`. Deploy the resulting Cloudflare/TanStack server using the deployment pipeline configured for `wrangler.jsonc`; this repository intentionally does not invent a provider-specific publish command.
3. Verify `GET /api/livez` returns `200` and `status=alive`. Verify `GET /api/readyz` returns `200`; `503` means traffic must not be shifted.
4. Run `KOVA_STAGING_SMOKE=1 KOVA_SMOKE_BASE_URL=https://staging.example npm run release:smoke`.
5. Verify Clerk sign-in, Supabase owner-scoped reads, Stripe webhook delivery/signature results, runner `/readyz`, scheduled executor logs, and optional provider states without paid calls.

## Rollback and incidents

- Roll back application code to the prior immutable commit through the hosting platform. Never reverse a migration containing data changes blindly; use a reviewed forward-fix migration.
- Disable affected optional capability configuration while retaining the application shell. Preserve all user rows and idempotency records.
- Agent failure: stop workers, preserve run/event rows, release expired leases using existing recovery procedures, then resume only after readiness is green.
- Webhook failure: retain provider events and correlation IDs, repair the handler, and replay from Stripe. Duplicate event claims are idempotent; failed processing releases its claim.
- Clerk outage: retain signed-out access and do not bypass authentication. Provider outage: disable only that capability. Database outage: remove readiness from service and do not accept writes.

## Post-deployment

Run the non-destructive smoke suite, inspect structured error categories/correlation IDs, latency and error rate, migration state, worker queue health, scheduled-task execution, billing reconciliation, optional-provider readiness, and annotate the release commit. Paid provider/Agent smoke is a separate explicit operator action and is disabled by default.

## Schema, diagnostics, and staging rehearsal

- CI executes `npm run release:db:isolated` against a disposable local Supabase stack, dumps the resulting schema, regenerates `database-contract.json`, and fails on contract drift. Local machines without Docker can run `npm run release:db:dry` but must not call that database validation.
- The schema marker expected by `/api/readyz` is `20260803123000-v1`; any missing RPC, older marker, incomplete critical object set, timeout, or database failure keeps readiness closed.
- Detailed diagnostics are disabled until `KOVA_ADMIN_USER_IDS` is configured server-side. Values are authenticated user IDs, never emails or client claims. `GET /api/admin/diagnostics` is no-store and rate-limited.
- The manual `KovaGPT staging rehearsal` GitHub workflow requires the protected `staging` environment, an approved Cloudflare token, two disposable staging access tokens, staging Supabase configuration, and an explicitly allowlisted staging hostname. It never shifts production traffic.
- Authenticated smoke records use the `__kova_smoke_` prefix, verify second-owner isolation, and delete created resources in `finally`. Production-like hostnames are refused unless `KOVA_ALLOW_PRODUCTION_SMOKE=1` is additionally set.
