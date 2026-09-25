create index auth_mfa_login_challenges_credential_idx
  on kova_private.auth_mfa_login_challenges (credential_id);

create index auth_mfa_login_challenges_factor_idx
  on kova_private.auth_mfa_login_challenges (factor_id);
