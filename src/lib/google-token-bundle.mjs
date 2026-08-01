export const GOOGLE_TOKEN_BUNDLE_VERSION = 1;
export const GOOGLE_REFRESH_CLAIM_TTL_MS = 2 * 60 * 1000;

function requireNonEmptyString(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid_google_token_bundle");
  }
  return value;
}

export function serializeGoogleTokenBundle({ userId, accessToken, refreshToken }) {
  return JSON.stringify({
    version: GOOGLE_TOKEN_BUNDLE_VERSION,
    userId: requireNonEmptyString(userId),
    accessToken: requireNonEmptyString(accessToken),
    refreshToken:
      refreshToken === null || refreshToken === undefined
        ? null
        : requireNonEmptyString(refreshToken),
  });
}

export function parseGoogleTokenBundle(value, expectedUserId) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid_google_token_bundle");
  }
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    parsed.version !== GOOGLE_TOKEN_BUNDLE_VERSION ||
    parsed.userId !== requireNonEmptyString(expectedUserId) ||
    typeof parsed.accessToken !== "string" ||
    parsed.accessToken.length === 0 ||
    (parsed.refreshToken !== null &&
      (typeof parsed.refreshToken !== "string" || parsed.refreshToken.length === 0))
  ) {
    throw new Error("invalid_google_token_bundle");
  }
  return {
    version: GOOGLE_TOKEN_BUNDLE_VERSION,
    userId: parsed.userId,
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
  };
}

export function preserveGoogleRefreshToken(returnedRefreshToken, existingRefreshToken) {
  return returnedRefreshToken ?? existingRefreshToken ?? null;
}

export function encryptedGoogleTokenWrite(ciphertext) {
  return {
    token_ciphertext: requireNonEmptyString(ciphertext),
    access_token: null,
    refresh_token: null,
  };
}

export async function encryptGoogleTokenBundle({ userId, accessToken, refreshToken, encrypt }) {
  try {
    return await encrypt(serializeGoogleTokenBundle({ userId, accessToken, refreshToken }));
  } catch {
    throw new Error("google_token_encryption_failed");
  }
}

export async function decryptGoogleTokenBundle({ userId, ciphertext, decrypt }) {
  try {
    return parseGoogleTokenBundle(await decrypt(ciphertext), userId);
  } catch {
    throw new Error("google_token_decryption_failed");
  }
}

async function readEncryptedRow(
  row,
  userId,
  decrypt,
  failureCode = "google_token_storage_invalid",
) {
  if (!row?.token_ciphertext || row.access_token !== null || row.refresh_token !== null) {
    throw new Error(failureCode);
  }
  try {
    return {
      row,
      bundle: await decryptGoogleTokenBundle({
        userId,
        ciphertext: row.token_ciphertext,
        decrypt,
      }),
    };
  } catch {
    throw new Error(
      failureCode === "google_token_storage_invalid"
        ? "google_token_decryption_failed"
        : failureCode,
    );
  }
}

export async function loadGoogleTokenCredential({
  userId,
  row,
  encrypt,
  decrypt,
  migrateLegacy,
  refetch,
}) {
  if (!row) return null;
  if (row.token_ciphertext) return readEncryptedRow(row, userId, decrypt);
  if (!row.access_token) throw new Error("google_token_storage_invalid");

  const ciphertext = await encryptGoogleTokenBundle({
    userId,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    encrypt,
  });
  let migrated;
  try {
    migrated = await migrateLegacy(encryptedGoogleTokenWrite(ciphertext));
  } catch {
    throw new Error("google_token_migration_failed");
  }
  if (migrated) {
    if (migrated.token_ciphertext !== ciphertext) {
      throw new Error("google_token_migration_failed");
    }
    return readEncryptedRow(migrated, userId, decrypt, "google_token_migration_failed");
  }

  // A concurrent request may have completed the same migration. Accept only a fully encrypted,
  // owner-bound row; otherwise fail closed before any provider operation can run.
  let current;
  try {
    current = await refetch();
  } catch {
    throw new Error("google_token_migration_failed");
  }
  return readEncryptedRow(current, userId, decrypt, "google_token_migration_failed");
}

export async function storeGoogleTokenCredential({
  userId,
  accessToken,
  refreshToken,
  encrypt,
  decrypt,
  upsert,
}) {
  const ciphertext = await encryptGoogleTokenBundle({
    userId,
    accessToken,
    refreshToken,
    encrypt,
  });
  let stored;
  try {
    stored = await upsert(encryptedGoogleTokenWrite(ciphertext));
  } catch {
    throw new Error("google_token_store_failed");
  }
  if (!stored || stored.token_ciphertext !== ciphertext) {
    throw new Error("google_token_store_failed");
  }
  try {
    await readEncryptedRow(stored, userId, decrypt, "google_token_store_failed");
  } catch {
    throw new Error("google_token_store_failed");
  }
  return ciphertext;
}

export async function disconnectGoogleTokenCredential({ load, deleteRow, revoke }) {
  const stored = await load();
  if (!stored) return false;
  let deleted;
  try {
    deleted = await deleteRow(stored.row);
  } catch {
    throw new Error("google_token_purge_failed");
  }
  if (!deleted) throw new Error("google_token_purge_failed");

  const token = stored.bundle.refreshToken ?? stored.bundle.accessToken;
  try {
    await revoke(token);
  } catch {
    // Revocation is best effort after the owner-scoped CAS delete has been verified.
  }
  return true;
}

function isStaleClaim(row, nowMs) {
  if (!row.refresh_claim_id || !row.refresh_claimed_at) return true;
  const claimedAt = Date.parse(row.refresh_claimed_at);
  return !Number.isFinite(claimedAt) || claimedAt <= nowMs - GOOGLE_REFRESH_CLAIM_TTL_MS;
}

async function claimForRefresh({ row, claim, claimRefresh, refetch, nowMs }) {
  if (row.refresh_claim_id && !isStaleClaim(row, nowMs)) {
    throw new Error("google_token_refresh_in_progress");
  }
  let claimed;
  try {
    claimed = await claimRefresh(row, claim);
  } catch {
    throw new Error("google_token_refresh_claim_failed");
  }
  if (!claimed) {
    let current;
    try {
      current = await refetch();
    } catch {
      throw new Error("google_token_refresh_claim_failed");
    }
    if (!current || !isStaleClaim(current, nowMs)) {
      throw new Error("google_token_refresh_in_progress");
    }
    try {
      claimed = await claimRefresh(current, claim);
    } catch {
      throw new Error("google_token_refresh_claim_failed");
    }
  }
  if (
    !claimed ||
    claimed.refresh_claim_id !== claim.id ||
    claimed.refresh_claimed_at !== claim.at
  ) {
    throw new Error("google_token_refresh_claim_failed");
  }
  return claimed;
}

export async function refreshGoogleTokenCredential({
  userId,
  load,
  claimRefresh,
  refetch,
  releaseRefresh,
  providerRefresh,
  completeRefresh,
  encrypt,
  decrypt,
  now = () => Date.now(),
  createClaimId = () => crypto.randomUUID(),
}) {
  const stored = await load();
  if (!stored?.bundle.refreshToken) throw new Error("google_not_connected");

  const claim = { id: createClaimId(), at: new Date(now()).toISOString() };
  const claimedRow = await claimForRefresh({
    row: stored.row,
    claim,
    claimRefresh,
    refetch,
    nowMs: now(),
  });
  const claimed = await readEncryptedRow(
    claimedRow,
    userId,
    decrypt,
    "google_token_refresh_claim_failed",
  );
  if (!claimed.bundle.refreshToken) throw new Error("google_not_connected");

  let completed = false;
  try {
    const response = await providerRefresh(claimed.bundle.refreshToken);
    if (
      !response ||
      typeof response.accessToken !== "string" ||
      response.accessToken.length === 0
    ) {
      throw new Error("google_token_response_invalid");
    }
    const refreshToken = preserveGoogleRefreshToken(
      response.refreshToken,
      claimed.bundle.refreshToken,
    );
    const ciphertext = await encryptGoogleTokenBundle({
      userId,
      accessToken: response.accessToken,
      refreshToken,
      encrypt,
    });
    let updated;
    try {
      updated = await completeRefresh({
        claimedRow,
        claim,
        response,
        write: encryptedGoogleTokenWrite(ciphertext),
      });
    } catch {
      throw new Error("google_token_refresh_store_failed");
    }
    if (updated) {
      if (
        updated.token_ciphertext !== ciphertext ||
        updated.refresh_claim_id !== null ||
        updated.refresh_claimed_at !== null
      ) {
        throw new Error("google_token_refresh_store_failed");
      }
      await readEncryptedRow(updated, userId, decrypt, "google_token_refresh_store_failed");
      completed = true;
      return response.accessToken;
    }

    // A reconnect or another valid owner-scoped writer may have won the CAS after the provider
    // response. Return only a verified, unclaimed, unexpired encrypted credential from the row.
    let current;
    try {
      current = await refetch();
      const verified = await readEncryptedRow(
        current,
        userId,
        decrypt,
        "google_token_refresh_store_failed",
      );
      const expiresAt = Date.parse(current.expires_at);
      if (
        current.refresh_claim_id !== null ||
        current.refresh_claimed_at !== null ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= now()
      ) {
        throw new Error("google_token_refresh_store_failed");
      }
      completed = true;
      return verified.bundle.accessToken;
    } catch {
      throw new Error("google_token_refresh_store_failed");
    }
  } finally {
    if (!completed) {
      await releaseRefresh(claimedRow, claim).catch(() => undefined);
    }
  }
}

export async function runAfterGoogleTokenStorageReady(prepareStorage, providerOperation) {
  const prepared = await prepareStorage();
  return providerOperation(prepared);
}
