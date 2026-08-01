-- Add encrypted Google credential storage without rewriting or deleting any existing row.
-- Legacy plaintext rows remain valid only until the server lazily converts each row in one
-- verified UPDATE. New application writes use token_ciphertext exclusively.

ALTER TABLE public.google_oauth_tokens
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;

ALTER TABLE public.google_oauth_tokens
  ADD COLUMN IF NOT EXISTS refresh_claim_id TEXT,
  ADD COLUMN IF NOT EXISTS refresh_claimed_at TIMESTAMPTZ;

ALTER TABLE public.google_oauth_tokens
  ALTER COLUMN access_token DROP NOT NULL;

ALTER TABLE public.google_oauth_tokens
  DROP CONSTRAINT IF EXISTS google_oauth_tokens_credential_storage_check;

ALTER TABLE public.google_oauth_tokens
  ADD CONSTRAINT google_oauth_tokens_credential_storage_check
  CHECK (
    (
      token_ciphertext IS NOT NULL
      AND access_token IS NULL
      AND refresh_token IS NULL
    )
    OR
    (
      token_ciphertext IS NULL
      AND access_token IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.google_oauth_tokens
  VALIDATE CONSTRAINT google_oauth_tokens_credential_storage_check;

ALTER TABLE public.google_oauth_tokens
  DROP CONSTRAINT IF EXISTS google_oauth_tokens_refresh_claim_check;

ALTER TABLE public.google_oauth_tokens
  ADD CONSTRAINT google_oauth_tokens_refresh_claim_check
  CHECK (
    (refresh_claim_id IS NULL AND refresh_claimed_at IS NULL)
    OR
    (refresh_claim_id IS NOT NULL AND refresh_claimed_at IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.google_oauth_tokens
  VALIDATE CONSTRAINT google_oauth_tokens_refresh_claim_check;

-- The OAuth routes call this before redirecting to Google and again before exchanging an
-- authorization code. It proves that the complete migration (including validation) is present;
-- merely detecting the new column would not prove that encrypted writes can store NULL plaintext.
CREATE OR REPLACE FUNCTION public.google_oauth_token_encryption_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND attribute.attname = 'token_ciphertext'
        AND NOT attribute.attnotnull
        AND NOT attribute.attisdropped
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND attribute.attname = 'refresh_claim_id'
        AND NOT attribute.attnotnull
        AND NOT attribute.attisdropped
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND attribute.attname = 'refresh_claimed_at'
        AND NOT attribute.attnotnull
        AND NOT attribute.attisdropped
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND attribute.attname = 'access_token'
        AND NOT attribute.attnotnull
        AND NOT attribute.attisdropped
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND constraint_row.conname = 'google_oauth_tokens_credential_storage_check'
        AND constraint_row.convalidated
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.google_oauth_tokens'::pg_catalog.regclass
        AND constraint_row.conname = 'google_oauth_tokens_refresh_claim_check'
        AND constraint_row.convalidated
    );
$function$;

REVOKE ALL ON FUNCTION public.google_oauth_token_encryption_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_oauth_token_encryption_ready()
  TO service_role;
