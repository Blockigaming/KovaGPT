-- Cover the four foreign-key columns identified by the staging performance
-- advisor. The original auth-store migration is already recorded in staging,
-- so these indexes intentionally live in a forward-only follow-up migration.

create index auth_email_verifications_identity_idx
  on kova_private.auth_email_verifications (identity_id);

create index auth_mfa_recovery_codes_account_idx
  on kova_private.auth_mfa_recovery_codes (account_id);

create index auth_session_handoffs_account_idx
  on kova_private.auth_session_handoffs (account_id);

create index auth_audit_session_idx
  on kova_private.auth_audit_events (session_id);
