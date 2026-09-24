import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { KovaPrincipal } from "@/lib/kova-auth-crypto.server.mjs";

type JsonObject = Record<string, unknown>;

type PasswordLookup = {
  accountId: string;
  credentialId: string;
  credentialRevision: number;
  passwordHash: string;
  email: string;
  displayName: string | null;
  mfaRequired: boolean;
};

type CandidateResult = {
  accountId: string;
  candidateUsed: boolean;
};

type MfaChallenge = {
  accountId: string;
  credentialId: string | null;
  credentialRevision: number | null;
  factorId: string;
  secretEnvelope: string;
};

type GoogleHandoffExchange =
  | { mfaRequired: true; email: string; challengeExpiresAt: string }
  | { mfaRequired: false; principal: KovaPrincipal };

type SupabaseRpcError = { code?: string; message?: string };

export class KovaAuthStoreError extends Error {
  readonly operation: string;
  readonly databaseCode: string | null;

  constructor(operation: string, error?: SupabaseRpcError | null) {
    super(`Kova auth store operation failed: ${operation}`);
    this.name = "KovaAuthStoreError";
    this.operation = operation;
    this.databaseCode = typeof error?.code === "string" ? error.code : null;
  }
}

async function rpc<T>(operation: string, args: JsonObject): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(operation as never, args as never);
  if (error) throw new KovaAuthStoreError(operation, error);
  return data as T;
}

function firstRow<T>(value: unknown, operation: string): T {
  if (!Array.isArray(value) || value.length !== 1 || !value[0]) {
    throw new KovaAuthStoreError(operation);
  }
  return value[0] as T;
}

function optionalFirstRow<T>(value: unknown): T | null {
  return Array.isArray(value) && value.length === 1 && value[0] ? (value[0] as T) : null;
}

function principalFromRow(row: Record<string, unknown>): KovaPrincipal {
  if (
    typeof row.account_id !== "string" ||
    typeof row.session_id !== "string" ||
    typeof row.email !== "string" ||
    typeof row.email_verified !== "boolean" ||
    (row.assurance_level !== "aal1" && row.assurance_level !== "aal2")
  ) {
    throw new KovaAuthStoreError("invalid_principal_row");
  }
  return {
    accountId: row.account_id,
    sessionId: row.session_id,
    email: row.email,
    emailVerified: row.email_verified,
    assuranceLevel: row.assurance_level,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : undefined,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
  };
}

// Shared only by server-side owned-auth stores, never by browser code.
export const kovaAuthStore = { rpc, firstRow, principalFromRow };

export async function createCompatibilityPrincipal(): Promise<string> {
  const value = await rpc<unknown>("kova_auth_create_compatibility_principal", {});
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new KovaAuthStoreError("create_compatibility_principal");
  }
  return value;
}

export async function compatibilityDirectoryEmail(accountId: string): Promise<string | null> {
  const value = await rpc<unknown>("kova_auth_directory_email", { p_account_id: accountId });
  return typeof value === "string" && value ? value : null;
}

export async function deleteCompatibilityPrincipal(accountId: string): Promise<void> {
  const value = await rpc<unknown>("kova_auth_delete_unused_compatibility_principal", {
    p_account_id: accountId,
  });
  if (value !== true) throw new KovaAuthStoreError("delete_compatibility_principal");
}

export async function hasVerifiedLegacyMfa(accountId: string): Promise<boolean> {
  const value = await rpc<unknown>("kova_auth_has_verified_legacy_mfa", {
    p_account_id: accountId,
  });
  if (typeof value !== "boolean") throw new KovaAuthStoreError("list_legacy_mfa");
  return value;
}

export async function finalizeOwnedAccountDeletion(
  accountId: string,
  sessionId: string,
): Promise<void> {
  const value = await rpc<unknown>("kova_auth_finalize_account_deletion", {
    p_account_id: accountId,
    p_session_id: sessionId,
  });
  if (value !== true) throw new KovaAuthStoreError("finalize_owned_account_deletion");
}

export async function createPasswordAccount(input: {
  candidateAccountId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  verificationDigest: string;
  verificationExpiresAt: string;
  emailPayload: JsonObject;
}): Promise<CandidateResult & { verificationCreated: boolean }> {
  const value = await rpc<unknown>("kova_auth_create_password_account", {
    p_candidate_account_id: input.candidateAccountId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_password_hash: input.passwordHash,
    p_verification_digest_hex: input.verificationDigest,
    p_verification_expires_at: input.verificationExpiresAt,
    p_email_payload: input.emailPayload,
  });
  const row = firstRow<Record<string, unknown>>(value, "kova_auth_create_password_account");
  if (
    typeof row.account_id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.account_id) ||
    typeof row.candidate_used !== "boolean" ||
    row.candidate_used !== (row.account_id === input.candidateAccountId) ||
    typeof row.verification_created !== "boolean"
  ) {
    throw new KovaAuthStoreError("kova_auth_create_password_account");
  }
  return {
    accountId: row.account_id,
    candidateUsed: row.candidate_used,
    verificationCreated: row.verification_created,
  };
}

export async function resendVerification(input: {
  email: string;
  verificationDigest: string;
  verificationExpiresAt: string;
  emailPayload: JsonObject;
}): Promise<void> {
  const value = await rpc<unknown>("kova_auth_resend_verification", {
    p_email: input.email,
    p_verification_digest_hex: input.verificationDigest,
    p_expires_at: input.verificationExpiresAt,
    p_email_payload: input.emailPayload,
  });
  if (typeof value !== "boolean") throw new KovaAuthStoreError("resend_verification");
}

export async function consumeVerification(input: {
  verificationDigest: string;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_consume_verification", {
    p_verification_digest_hex: input.verificationDigest,
    p_session_digest_hex: input.sessionDigest,
    p_session_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_consume_verification"));
}

export async function lookupPassword(email: string): Promise<PasswordLookup | null> {
  const value = await rpc<unknown>("kova_auth_password_lookup", { p_email: email });
  const row = optionalFirstRow<Record<string, unknown>>(value);
  if (!row) return null;
  if (
    typeof row.account_id !== "string" ||
    typeof row.credential_id !== "string" ||
    typeof row.credential_revision !== "number" ||
    typeof row.password_hash !== "string" ||
    typeof row.email !== "string" ||
    typeof row.mfa_required !== "boolean"
  ) {
    throw new KovaAuthStoreError("kova_auth_password_lookup");
  }
  return {
    accountId: row.account_id,
    credentialId: row.credential_id,
    credentialRevision: row.credential_revision,
    passwordHash: row.password_hash,
    email: row.email,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    mfaRequired: row.mfa_required,
  };
}

export async function createPasswordSession(input: {
  accountId: string;
  credentialId: string;
  credentialRevision: number;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_create_session", {
    p_account_id: input.accountId,
    p_credential_id: input.credentialId,
    p_credential_revision: input.credentialRevision,
    p_token_digest_hex: input.sessionDigest,
    p_assurance_level: "aal1",
    p_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_create_session"));
}

function mfaChallengeFromRow(row: Record<string, unknown>): MfaChallenge {
  if (
    typeof row.account_id !== "string" ||
    (row.credential_id !== null && typeof row.credential_id !== "string") ||
    (row.credential_revision !== null && typeof row.credential_revision !== "number") ||
    (row.credential_id === null) !== (row.credential_revision === null) ||
    typeof row.factor_id !== "string" ||
    typeof row.secret_envelope !== "string"
  ) {
    throw new KovaAuthStoreError("invalid_mfa_challenge_row");
  }
  return {
    accountId: row.account_id,
    credentialId: row.credential_id,
    credentialRevision: row.credential_revision,
    factorId: row.factor_id,
    secretEnvelope: row.secret_envelope,
  };
}

export async function beginMfaLogin(input: {
  accountId: string;
  credentialId: string;
  credentialRevision: number;
  challengeDigest: string;
  expiresAt: string;
}): Promise<Pick<MfaChallenge, "factorId" | "secretEnvelope">> {
  const value = await rpc<unknown>("kova_auth_begin_mfa_login", {
    p_account_id: input.accountId,
    p_credential_id: input.credentialId,
    p_credential_revision: input.credentialRevision,
    p_challenge_digest_hex: input.challengeDigest,
    p_expires_at: input.expiresAt,
  });
  const row = firstRow<Record<string, unknown>>(value, "kova_auth_begin_mfa_login");
  if (typeof row.factor_id !== "string" || typeof row.secret_envelope !== "string") {
    throw new KovaAuthStoreError("kova_auth_begin_mfa_login");
  }
  return { factorId: row.factor_id, secretEnvelope: row.secret_envelope };
}

export async function readMfaLoginChallenge(challengeDigest: string): Promise<MfaChallenge[]> {
  const value = await rpc<unknown>("kova_auth_read_mfa_login_challenge", {
    p_challenge_digest_hex: challengeDigest,
  });
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new KovaAuthStoreError("kova_auth_read_mfa_login_challenge");
  }
  return value.map((row) =>
    mfaChallengeFromRow(row as Record<string, unknown>),
  );
}

export async function bindMfaLoginFactor(input: {
  challengeDigest: string;
  factorId: string;
}): Promise<void> {
  const value = await rpc<unknown>("kova_auth_bind_mfa_login_factor", {
    p_challenge_digest_hex: input.challengeDigest,
    p_factor_id: input.factorId,
  });
  if (value !== true) throw new KovaAuthStoreError("kova_auth_bind_mfa_login_factor");
}

export async function finishMfaLogin(input: {
  challengeDigest: string;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_finish_mfa_login", {
    p_challenge_digest_hex: input.challengeDigest,
    p_token_digest_hex: input.sessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_finish_mfa_login"));
}

export async function finishMfaRecoveryLogin(input: {
  challengeDigest: string;
  recoveryDigest: string;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_finish_mfa_recovery_login", {
    p_challenge_digest_hex: input.challengeDigest,
    p_recovery_digest_hex: input.recoveryDigest,
    p_token_digest_hex: input.sessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_finish_mfa_recovery_login"));
}

export async function beginTotpEnrollment(input: {
  sessionDigest: string;
  secretEnvelope: string;
  friendlyName: string;
  credentialId?: string;
  credentialRevision?: number;
}): Promise<{ factorId: string; email: string }> {
  const value = await rpc<unknown>("kova_auth_begin_totp_enrollment_reauthenticated", {
    p_session_digest_hex: input.sessionDigest,
    p_secret_envelope: input.secretEnvelope,
    p_friendly_name: input.friendlyName,
    p_credential_id: input.credentialId ?? null,
    p_credential_revision: input.credentialRevision ?? null,
  });
  const row = firstRow<Record<string, unknown>>(
    value,
    "kova_auth_begin_totp_enrollment_reauthenticated",
  );
  if (typeof row.factor_id !== "string" || typeof row.email !== "string") {
    throw new KovaAuthStoreError("kova_auth_begin_totp_enrollment_reauthenticated");
  }
  return { factorId: row.factor_id, email: row.email };
}

export async function readTotpEnrollment(input: {
  sessionDigest: string;
  factorId: string;
}): Promise<string> {
  const value = await rpc<unknown>("kova_auth_read_totp_enrollment", {
    p_session_digest_hex: input.sessionDigest,
    p_factor_id: input.factorId,
  });
  const row = firstRow<Record<string, unknown>>(value, "kova_auth_read_totp_enrollment");
  if (typeof row.secret_envelope !== "string") {
    throw new KovaAuthStoreError("kova_auth_read_totp_enrollment");
  }
  return row.secret_envelope;
}

export async function activateTotp(input: {
  sessionDigest: string;
  factorId: string;
  recoveryDigests: string[];
  nextSessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const operation = "kova_auth_activate_totp_with_session";
  const value = await rpc<unknown>(operation, {
    p_session_digest_hex: input.sessionDigest,
    p_factor_id: input.factorId,
    p_recovery_digest_hexes: input.recoveryDigests,
    p_next_session_digest_hex: input.nextSessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  const principal = principalFromRow(firstRow(value, operation));
  if (!principal.emailVerified || principal.assuranceLevel !== "aal2") {
    throw new KovaAuthStoreError(operation);
  }
  return principal;
}

export async function listTotpFactors(sessionDigest: string): Promise<
  Array<{
    id: string;
    friendlyName: string | null;
    verifiedAt: string;
    recoveryCodesRemaining: number;
  }>
> {
  const value = await rpc<unknown>("kova_auth_list_totp_factors", {
    p_session_digest_hex: sessionDigest,
  });
  if (!Array.isArray(value)) throw new KovaAuthStoreError("kova_auth_list_totp_factors");
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    if (
      typeof row.factor_id !== "string" ||
      typeof row.verified_at !== "string" ||
      typeof row.recovery_codes_remaining !== "number"
    ) {
      throw new KovaAuthStoreError("kova_auth_list_totp_factors");
    }
    return {
      id: row.factor_id,
      friendlyName: typeof row.friendly_name === "string" ? row.friendly_name : null,
      verifiedAt: row.verified_at,
      recoveryCodesRemaining: row.recovery_codes_remaining,
    };
  });
}

export async function removeTotpFactor(input: {
  sessionDigest: string;
  factorId: string;
  nextSessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const operation = "kova_auth_remove_totp_with_session";
  const value = await rpc<unknown>(operation, {
    p_session_digest_hex: input.sessionDigest,
    p_factor_id: input.factorId,
    p_next_session_digest_hex: input.nextSessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, operation));
}

export async function changePassword(input: {
  sessionDigest: string;
  credentialId: string;
  credentialRevision: number;
  passwordHash: string;
  nextSessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const operation = "kova_auth_change_password";
  const value = await rpc<unknown>(operation, {
    p_session_digest_hex: input.sessionDigest,
    p_credential_id: input.credentialId,
    p_credential_revision: input.credentialRevision,
    p_password_hash: input.passwordHash,
    p_next_session_digest_hex: input.nextSessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, operation));
}

export async function regenerateMfaRecoveryCodes(input: {
  sessionDigest: string;
  recoveryDigests: string[];
  nextSessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_regenerate_mfa_recovery_codes", {
    p_session_digest_hex: input.sessionDigest,
    p_recovery_digest_hexes: input.recoveryDigests,
    p_next_session_digest_hex: input.nextSessionDigest,
    p_expires_at: input.sessionExpiresAt,
  });
  const principal = principalFromRow(firstRow(value, "kova_auth_regenerate_mfa_recovery_codes"));
  if (principal.assuranceLevel !== "aal2" || !principal.emailVerified) {
    throw new KovaAuthStoreError("kova_auth_regenerate_mfa_recovery_codes");
  }
  return principal;
}

export async function revokeOtherSessions(sessionDigest: string): Promise<number> {
  const value = await rpc<unknown>("kova_auth_revoke_other_sessions", {
    p_session_digest_hex: sessionDigest,
  });
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new KovaAuthStoreError("kova_auth_revoke_other_sessions");
  }
  return value;
}

export async function resolveSession(sessionDigest: string): Promise<KovaPrincipal | null> {
  const value = await rpc<unknown>("kova_auth_resolve_session", {
    p_token_digest_hex: sessionDigest,
  });
  const row = optionalFirstRow<Record<string, unknown>>(value);
  return row ? principalFromRow(row) : null;
}

export async function rotateSession(input: {
  oldDigest: string;
  newDigest: string;
  expiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_rotate_session", {
    p_old_digest_hex: input.oldDigest,
    p_new_digest_hex: input.newDigest,
    p_expires_at: input.expiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_rotate_session"));
}

export async function revokeSession(sessionDigest: string): Promise<boolean> {
  return Boolean(
    await rpc<boolean>("kova_auth_revoke_session", { p_token_digest_hex: sessionDigest }),
  );
}

export async function createRecovery(input: {
  email: string;
  recoveryDigest: string;
  recoveryExpiresAt: string;
  emailPayload: JsonObject;
}): Promise<boolean> {
  return Boolean(
    await rpc<boolean>("kova_auth_create_recovery", {
      p_email: input.email,
      p_recovery_digest_hex: input.recoveryDigest,
      p_recovery_expires_at: input.recoveryExpiresAt,
      p_email_payload: input.emailPayload,
    }),
  );
}

export async function recoveryTarget(recoveryDigest: string): Promise<string | null> {
  const value = await rpc<unknown>("kova_auth_recovery_target", {
    p_recovery_digest_hex: recoveryDigest,
  });
  return typeof value === "string" ? value : null;
}

export async function consumeRecovery(input: {
  recoveryDigest: string;
  passwordHash: string;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_consume_recovery", {
    p_recovery_digest_hex: input.recoveryDigest,
    p_password_hash: input.passwordHash,
    p_session_digest_hex: input.sessionDigest,
    p_session_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_consume_recovery"));
}

export async function createOAuthState(input: {
  stateDigest: string;
  nonceDigest: string;
  pkceVerifierCiphertext: string;
  returnTo: string;
  expiresAt: string;
}): Promise<void> {
  const value = await rpc<unknown>("kova_auth_create_oauth_state", {
    p_state_digest_hex: input.stateDigest,
    p_nonce_digest_hex: input.nonceDigest,
    p_pkce_verifier_ciphertext: input.pkceVerifierCiphertext,
    p_return_to: input.returnTo,
    p_expires_at: input.expiresAt,
  });
  if (typeof value !== "string") throw new KovaAuthStoreError("kova_auth_create_oauth_state");
}

export async function consumeOAuthState(stateDigest: string): Promise<{
  nonceDigest: string;
  pkceVerifierCiphertext: string;
  returnTo: string;
}> {
  const value = await rpc<unknown>("kova_auth_consume_oauth_state", {
    p_state_digest_hex: stateDigest,
  });
  const row = firstRow<Record<string, unknown>>(value, "kova_auth_consume_oauth_state");
  if (
    typeof row.nonce_digest_hex !== "string" ||
    typeof row.pkce_verifier_ciphertext !== "string" ||
    typeof row.return_to !== "string"
  ) {
    throw new KovaAuthStoreError("kova_auth_consume_oauth_state");
  }
  return {
    nonceDigest: row.nonce_digest_hex,
    pkceVerifierCiphertext: row.pkce_verifier_ciphertext,
    returnTo: row.return_to,
  };
}

export async function finishGoogle(input: {
  candidateAccountId: string;
  providerSubject: string;
  email: string;
  displayName: string;
  handoffDigest: string;
  handoffExpiresAt: string;
}): Promise<CandidateResult> {
  const value = await rpc<unknown>("kova_auth_finish_google", {
    p_candidate_account_id: input.candidateAccountId,
    p_provider_subject: input.providerSubject,
    p_email: input.email,
    p_email_verified: true,
    p_display_name: input.displayName,
    p_handoff_digest_hex: input.handoffDigest,
    p_handoff_expires_at: input.handoffExpiresAt,
  });
  const row = firstRow<Record<string, unknown>>(value, "kova_auth_finish_google");
  if (
    typeof row.account_id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.account_id) ||
    typeof row.candidate_used !== "boolean" ||
    row.candidate_used !== (row.account_id === input.candidateAccountId)
  ) {
    throw new KovaAuthStoreError("kova_auth_finish_google");
  }
  return { accountId: row.account_id, candidateUsed: row.candidate_used };
}

export async function exchangeGoogleHandoff(input: {
  handoffDigest: string;
  sessionDigest: string;
  sessionExpiresAt: string;
  challengeDigest: string;
  challengeExpiresAt: string;
}): Promise<GoogleHandoffExchange> {
  const operation = "kova_auth_consume_handoff_with_mfa";
  const value = await rpc<unknown>(operation, {
    p_handoff_digest_hex: input.handoffDigest,
    p_session_digest_hex: input.sessionDigest,
    p_session_expires_at: input.sessionExpiresAt,
    p_challenge_digest_hex: input.challengeDigest,
    p_challenge_expires_at: input.challengeExpiresAt,
  });
  const row = firstRow<Record<string, unknown>>(value, operation);
  if (row.mfa_required === true) {
    if (typeof row.email !== "string" || typeof row.expires_at !== "string") {
      throw new KovaAuthStoreError(operation);
    }
    return { mfaRequired: true, email: row.email, challengeExpiresAt: row.expires_at };
  }
  if (row.mfa_required !== false) throw new KovaAuthStoreError(operation);
  return { mfaRequired: false, principal: principalFromRow(row) };
}

export async function consumeHandoff(input: {
  handoffDigest: string;
  sessionDigest: string;
  sessionExpiresAt: string;
}): Promise<KovaPrincipal> {
  const value = await rpc<unknown>("kova_auth_consume_handoff", {
    p_handoff_digest_hex: input.handoffDigest,
    p_session_digest_hex: input.sessionDigest,
    p_session_expires_at: input.sessionExpiresAt,
  });
  return principalFromRow(firstRow(value, "kova_auth_consume_handoff"));
}
