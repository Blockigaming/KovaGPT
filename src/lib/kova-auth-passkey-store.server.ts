import { kovaAuthStore, KovaAuthStoreError } from "@/lib/kova-auth-store.server";
import type { KovaPrincipal } from "@/lib/kova-auth-crypto.server.mjs";
import type {
  VerifiedKovaPasskey,
  KovaPasskeyVerificationKey,
} from "@/lib/kova-auth-passkey-crypto.server.mjs";

const { rpc, firstRow, principalFromRow } = kovaAuthStore;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type Purpose = "registration" | "authentication";
export type PasskeyListItem = {
  id: string;
  credentialId: string;
  friendlyName: string;
  createdAt: string;
  lastUsedAt: string | null;
};
export type StoredKovaPasskey = KovaPasskeyVerificationKey & {
  id: string;
  accountId: string;
  rpId: string;
  revision: number;
  sessionEpoch: number;
};
const fail = (name: string): never => {
  throw new KovaAuthStoreError(name);
};
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const integer = (value: unknown, min = 0): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;

export async function beginPasskeyChallenge(input: {
  purpose: Purpose;
  challengeDigest: string;
  bindingDigest: string;
  rpId: string;
  origin: string;
  sessionDigest?: string;
  credentialId?: string;
  credentialRevision?: number;
  friendlyName?: string;
}): Promise<void> {
  const operation = "kova_auth_begin_passkey_challenge";
  const value = await rpc(operation, {
    p_purpose: input.purpose,
    p_challenge_digest_hex: input.challengeDigest,
    p_binding_digest_hex: input.bindingDigest,
    p_rp_id: input.rpId,
    p_origin: input.origin,
    p_session_digest_hex: input.sessionDigest ?? null,
    p_password_credential_id: input.credentialId ?? null,
    p_password_revision: input.credentialRevision ?? null,
    p_friendly_name: input.friendlyName ?? null,
  });
  if (value !== true) fail(operation);
}

export async function claimPasskeyChallenge(input: {
  purpose: Purpose;
  challengeDigest: string;
  bindingDigest: string;
  claimDigest: string;
  sessionDigest?: string;
}): Promise<{ rpId: string; origin: string; accountId: string | null }> {
  const operation = "kova_auth_claim_passkey_challenge";
  const row = firstRow<Record<string, unknown>>(
    await rpc(operation, {
      p_purpose: input.purpose,
      p_challenge_digest_hex: input.challengeDigest,
      p_binding_digest_hex: input.bindingDigest,
      p_claim_digest_hex: input.claimDigest,
      p_session_digest_hex: input.sessionDigest ?? null,
    }),
    operation,
  );
  if (
    typeof row.rp_id !== "string" ||
    typeof row.expected_origin !== "string" ||
    (input.purpose === "registration" ? !isUuid(row.account_id) : row.account_id !== null)
  )
    fail(operation);
  return {
    rpId: row.rp_id as string,
    origin: row.expected_origin as string,
    accountId: row.account_id as string | null,
  };
}

export async function listPasskeys(sessionDigest: string): Promise<PasskeyListItem[]> {
  const operation = "kova_auth_list_passkeys";
  const rows = await rpc<unknown>(operation, { p_session_digest_hex: sessionDigest });
  if (!Array.isArray(rows) || rows.length > 10) return fail(operation);
  return rows.map((row) => {
    if (
      !row ||
      !isUuid(row.id) ||
      typeof row.credential_id !== "string" ||
      typeof row.friendly_name !== "string" ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      (row.last_used_at !== null &&
        (typeof row.last_used_at !== "string" || !Number.isFinite(Date.parse(row.last_used_at))))
    )
      fail(operation);
    return {
      id: row.id,
      credentialId: row.credential_id,
      friendlyName: row.friendly_name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  });
}

export async function lookupPasskey(credentialId: string): Promise<StoredKovaPasskey | null> {
  const operation = "kova_auth_lookup_passkey";
  const value = await rpc<unknown>(operation, { p_credential_id: credentialId });
  if (Array.isArray(value) && value.length === 0) return null;
  const row = firstRow<Record<string, unknown>>(value, operation);
  if (
    !isUuid(row.passkey_id) ||
    !isUuid(row.account_id) ||
    typeof row.rp_id !== "string" ||
    row.credential_id !== credentialId ||
    typeof row.public_key_hex !== "string" ||
    !/^(?:[a-f0-9]{2}){16,4096}$/u.test(row.public_key_hex) ||
    typeof row.user_handle !== "string" ||
    typeof row.backup_eligible !== "boolean" ||
    !integer(row.sign_count) ||
    row.sign_count > 4294967295 ||
    !integer(row.revision, 1) ||
    !integer(row.session_epoch)
  )
    return fail(operation);
  return {
    id: row.passkey_id,
    accountId: row.account_id,
    rpId: row.rp_id,
    credentialId,
    publicKeyHex: row.public_key_hex,
    userHandle: row.user_handle,
    counter: row.sign_count,
    revision: row.revision,
    sessionEpoch: row.session_epoch,
    backupEligible: row.backup_eligible,
  };
}

export async function finishPasskeyRegistration(
  input: VerifiedKovaPasskey & {
    sessionDigest: string;
    challengeDigest: string;
    claimDigest: string;
    nextDigest: string;
    expiresAt: string;
  },
): Promise<KovaPrincipal> {
  const operation = "kova_auth_finish_passkey_registration";
  const value = await rpc(operation, {
    p_session_digest_hex: input.sessionDigest,
    p_challenge_digest_hex: input.challengeDigest,
    p_claim_digest_hex: input.claimDigest,
    p_credential_id: input.credentialId,
    p_public_key_hex: input.publicKeyHex,
    p_counter: input.counter,
    p_backup_eligible: input.backupEligible,
    p_backed_up: input.backedUp,
    p_transports: input.transports,
    p_next_session_digest_hex: input.nextDigest,
    p_expires_at: input.expiresAt,
  });
  const principal = principalFromRow(firstRow(value, operation));
  if (principal.assuranceLevel !== "aal2") fail(operation);
  return principal;
}

export async function finishPasskeyLogin(input: {
  challengeDigest: string;
  claimDigest: string;
  key: StoredKovaPasskey;
  counter: number;
  backedUp: boolean;
  nextDigest: string;
  expiresAt: string;
}): Promise<KovaPrincipal> {
  const operation = "kova_auth_finish_passkey_login";
  const value = await rpc(operation, {
    p_challenge_digest_hex: input.challengeDigest,
    p_claim_digest_hex: input.claimDigest,
    p_passkey_id: input.key.id,
    p_revision: input.key.revision,
    p_expected_counter: input.key.counter,
    p_new_counter: input.counter,
    p_session_epoch: input.key.sessionEpoch,
    p_user_handle: input.key.userHandle,
    p_backed_up: input.backedUp,
    p_session_digest_hex: input.nextDigest,
    p_expires_at: input.expiresAt,
  });
  const principal = principalFromRow(firstRow(value, operation));
  if (principal.accountId !== input.key.accountId || principal.assuranceLevel !== "aal2")
    fail(operation);
  return principal;
}

export async function renamePasskey(
  sessionDigest: string,
  id: string,
  friendlyName: string,
): Promise<void> {
  const operation = "kova_auth_rename_passkey";
  const value = await rpc(operation, {
    p_session_digest_hex: sessionDigest,
    p_passkey_id: id,
    p_friendly_name: friendlyName,
  });
  if (value !== true) fail(operation);
}

export async function removePasskey(input: {
  sessionDigest: string;
  id: string;
  nextDigest: string;
  expiresAt: string;
}): Promise<KovaPrincipal> {
  const operation = "kova_auth_remove_passkey";
  const value = await rpc(operation, {
    p_session_digest_hex: input.sessionDigest,
    p_passkey_id: input.id,
    p_next_session_digest_hex: input.nextDigest,
    p_expires_at: input.expiresAt,
  });
  return principalFromRow(firstRow(value, operation));
}