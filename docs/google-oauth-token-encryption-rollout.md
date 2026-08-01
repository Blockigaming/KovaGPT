# Google OAuth token encryption rollout

This change encrypts each user's Google access and refresh tokens together with the existing
AES-256-GCM credential vault. Ciphertext contains a versioned JSON bundle bound to the Kova user
ID. New writes never persist either token in the plaintext columns. Existing rows are converted
only when that user next uses the Google connection.

## Required deployment order

1. **Secret first.** Generate one 32-byte key, encode it as base64, and set
   `CONNECTOR_TOKEN_ENCRYPTION_KEY` in the production application environment. Keep the key in the
   secret manager; never put it in source control, logs, tickets, or command history. Do not rotate
   or remove it during this rollout.
2. **Migrations second.** Manually apply, in timestamp order:
   - `20260802003000_google_oauth_tokens_server_only.sql`
   - `20260802010000_encrypt_google_oauth_tokens.sql`
3. **Code last.** Only after the secret and both migrations are confirmed, deploy the application
   commit that reads and writes `token_ciphertext`.

The Cloudflare production deployment workflow builds and deploys the application; it does **not**
apply Supabase migrations. A Cloudflare deployment must therefore never be used as evidence that
either database migration ran.

There is intentionally no bulk backfill or production data job in this change. On first read, the
server encrypts one legacy row and atomically clears `access_token` and `refresh_token`; it verifies
the returned database row before any refresh or revocation request is sent to Google. New connects
write only ciphertext.

Refresh requests use a non-secret, owner-row compare-and-swap claim. Only the request that verifies
its claim may call Google's token endpoint. Claims become recoverable after two minutes, while the
provider request itself times out after 30 seconds. This prevents concurrent refresh requests from
racing a rotated refresh token.

## Pre-deploy checks

- Confirm `CONNECTOR_TOKEN_ENCRYPTION_KEY` exists in every serving environment and decodes to
  exactly 32 bytes. All instances must use the same key.
- Confirm both migration timestamps are recorded by the production Supabase migration ledger.
- As the service role, confirm `select public.google_oauth_token_encryption_ready();` returns
  `true`. Browser roles must not have permission to execute this function or read the token table.
- Do not inspect or export token column values while verifying the rollout.

Safe aggregate verification (no token values are returned):

```sql
SELECT
  count(*) FILTER (WHERE token_ciphertext IS NOT NULL) AS encrypted_rows,
  count(*) FILTER (
    WHERE token_ciphertext IS NULL AND access_token IS NOT NULL
  ) AS legacy_rows,
  count(*) FILTER (
    WHERE token_ciphertext IS NOT NULL
      AND (access_token IS NOT NULL OR refresh_token IS NOT NULL)
  ) AS invalid_mixed_rows,
  count(*) FILTER (WHERE refresh_claim_id IS NOT NULL) AS active_refresh_claims
FROM public.google_oauth_tokens;
```

Before code deployment, `legacy_rows` may be nonzero and `invalid_mixed_rows` must be zero. After
deployment, an authorized operator can connect a non-production test Google account and verify that
the corresponding aggregate encrypted count increases while the mixed count remains zero. This PR
does not perform that provider action.

## Failure behavior and limitations

- OAuth start and callback fail closed if the key is absent or invalid, the schema readiness
  function is missing or false, or a legacy-row migration cannot be verified.
- Decryption rejects malformed ciphertext and ciphertext copied to a different Kova user row.
- A failed lazy migration prevents refresh and revocation calls. A failed refresh database update
  prevents the newly returned access token from being used.
- Refresh compare-and-swap loss accepts only a refetched, unclaimed, unexpired ciphertext bundle
  bound to the same Kova user. All other races fail closed.
- Google may omit a refresh token during connect or refresh; the existing encrypted refresh token
  is preserved in that case.
- The current vault accepts one active encryption key. Key rotation needs a separately reviewed,
  version-aware rotation plan and is not part of this rollout.
- Database and Google revocation cannot be one distributed transaction. Disconnect first verifies
  an owner-scoped compare-and-swap delete, then attempts revocation. A changed row fails before
  Google is called. Revocation is best effort; a process failure in the narrow post-delete window
  can require the user to revoke KovaGPT from their Google account security settings.

## Rollback

Before any row has been encrypted, application code may be rolled back while leaving the additive
schema in place. Do not remove the new column or constraint as part of incident response.

After the first row has been converted or a new encrypted connection has been stored, rolling back
to plaintext-only application code is unsafe: that code cannot read encrypted rows and sees a NULL
`access_token`. Keep encryption-capable code running or prepare a separately reviewed, controlled
decrypt migration using the retained key. No decrypt migration, destructive rollback, or backfill
is included here.

## Manual application verification

After deployment, verify all of the following without exposing credentials:

- Google status works for an encrypted connection and reports unavailable—not connected—when a
  test instance is intentionally started without the encryption key.
- A legacy test row becomes encrypted on first status/read, and the two plaintext columns become
  NULL in the same returned update.
- A refresh response that omits `refresh_token` does not remove the existing refresh capability.
- Disconnect removes the owner-scoped row. No token or provider response body appears in
  application, proxy, or database logs.
