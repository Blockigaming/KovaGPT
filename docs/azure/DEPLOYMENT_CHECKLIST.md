# Azure Development Deployment Checklist

## Local Docker validation

- [ ] Run `npm ci`.
- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `KOVA_BROWSER_PREVIEW=node npm run build`.
- [ ] Run `npm run azure:validate`.
- [ ] Build with `npm run container:build`.
- [ ] Start locally with `AI_GENERATION_ENABLED=false`, `HOST=0.0.0.0`, and `PORT=3000`.
- [ ] Verify `npm run container:smoke` returns HTTP 200 from `/api/health`.
- [ ] Inspect `docker logs` for startup errors.
- [ ] Confirm `docker history` and `git diff` contain no secrets.

## Azure development deployment

- [ ] Create a separate resource group.
- [ ] Create ACR.
- [ ] Create Log Analytics workspace.
- [ ] Create Container Apps environment.
- [ ] Create user-assigned managed identity.
- [ ] Create Key Vault.
- [ ] Deploy only to a development Container App, not production.
- [ ] Set target port to `3000`.

## Health verification

- [ ] Confirm `GET /api/health` returns HTTP 200.
- [ ] Confirm response JSON includes `status`, `service`, `environment`, and `timestamp` only.
- [ ] Confirm no authentication is required.

## Logs

- [ ] Check Container Apps system logs.
- [ ] Check application logs.
- [ ] Confirm no secrets, connection strings, or tokens appear.

## Environment variables

- [ ] Set `AI_GENERATION_ENABLED=false` until Azure OpenAI quota is approved.
- [ ] Set `HOST=0.0.0.0`.
- [ ] Let Azure supply `PORT`; use `3000` only as fallback.
- [ ] Keep public values under `VITE_` only when they are safe for browsers.
- [ ] Keep server secrets in Container Apps secrets or Key Vault references.

## Secrets

- [ ] Do not commit real secrets.
- [ ] Do not use secret-looking placeholders.
- [ ] Keep Supabase, Stripe, Google OAuth, connector, and OpenAI secrets server-side.

## Managed identity

- [ ] Assign least-privilege Key Vault access.
- [ ] Assign Azure OpenAI permissions after quota approval.
- [ ] Avoid long-lived credentials.

## Rollback

- [ ] Leave the currently active production revision and traffic weights untouched during development validation.
- [ ] Leave `kovagpt.com` DNS unchanged.
- [ ] Stop or roll back only the Azure development Container App if validation fails.

## Production readiness

- [ ] Complete staging soak.
- [ ] Enable GitHub OIDC federation.
- [ ] Push immutable images to ACR.
- [ ] Complete data/storage/email migration rehearsals.
- [ ] Prepare DNS TTL and cutover window.
- [ ] Confirm no Lovable deployment, redirect, proxy, secret, or integration remains in the production routing or rollback plan; record any external cleanup separately from this source-only checklist.
- [ ] Do not delete or mutate Supabase production during this checklist.
