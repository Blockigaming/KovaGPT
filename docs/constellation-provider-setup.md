# Constellation provider and worker setup

## OAuth providers

Register the callback `https://<deployment>/api/integrations/oauth/callback/<provider>` for Microsoft, GitHub, Slack, Notion, Linear, Dropbox, and Box. Supply the matching server-only client ID and secret from `.env.example`. Generate `CONNECTOR_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded in Base64. Rotation requires decrypting with the recorded key version and re-encrypting before retiring the old key.

The OAuth start route requires a valid Kova bearer session. State is random, stored only as SHA-256, single use, and expires in ten minutes. PKCE is enabled for providers that accept it. Callback routes exchange authorization codes server-side, resolve provider account identity, encrypt access and refresh tokens using AES-256-GCM, record consent, and return only safe account metadata. Refresh tokens never enter browser storage or API responses.

Do not enable a provider in production until its provider console review, redirect URL, privacy policy, deletion URL, requested scopes, and organization-admin requirements have been approved. Generic account linking does not by itself complete service-specific search, synchronization, or write tools.

## Synchronization worker

Workers lease `integration_sync_jobs`, persist opaque encrypted cursors, distinguish initial/incremental/reindex/deletion work, apply bounded exponential backoff, honor provider Retry-After, and cancel on disconnect. Cached content must expose its source timestamp and last successful sync. Provider webhook signatures must be verified before a job is enqueued; scheduled refresh is the fallback when webhooks are unavailable.

## Browser agent worker

Run `node workers/browser-agent.mjs` in an isolated container with Playwright Chromium, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a unique `AGENT_WORKER_ID`. The worker must not share the web application container, cookies, filesystem, or user Kova authentication token. Apply outbound network policy in the container in addition to the application domain allowlist.

The worker leases queued runs, creates a fresh browser context, blocks service workers and downloads, enforces action/runtime bounds, pauses before consequential clicks, records redacted observations and SHA-256 screenshot evidence, retries transient failures with bounded backoff, and deletes its temporary run directory. Production deployment still needs a durable scheduler to keep the worker running and object storage for screenshot bytes; the database stores integrity hashes, not fabricated images.

## Plaid

Configure the Plaid client ID, secret, environment, redirect URL, and webhook URL. The Link-token and exchange APIs remain unavailable until all required values exist. Financial connections are read-only: no payment-initiation or trading products are requested. The deployment must validate Plaid's `Plaid-Verification` JWT at the edge and forward only verified webhooks with the private verification header.

## Health

Health tables are intentionally isolated from ordinary workspace tables. No Health source is enabled by this change. Apple Health requires a signed iOS application, HealthKit entitlements, on-device consent, and a reviewed synchronization service. U.S. medical records require an approved aggregation provider and appropriate contractual/security controls. Do not claim HIPAA eligibility without a qualifying deployed environment and agreements.
