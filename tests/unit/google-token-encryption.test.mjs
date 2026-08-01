import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  disconnectGoogleTokenCredential,
  loadGoogleTokenCredential,
  parseGoogleTokenBundle,
  preserveGoogleRefreshToken,
  refreshGoogleTokenCredential,
  runAfterGoogleTokenStorageReady,
  serializeGoogleTokenBundle,
  storeGoogleTokenCredential,
} from "../../src/lib/google-token-bundle.mjs";

const fakeEncrypt = async (value) => `cipher.${Buffer.from(value).toString("base64url")}`;
const fakeDecrypt = async (value) => {
  if (!value.startsWith("cipher.")) throw new Error("bad_ciphertext");
  return Buffer.from(value.slice("cipher.".length), "base64url").toString("utf8");
};

async function encryptedRow({
  userId = "user-a",
  accessToken = "old-access",
  refreshToken = "old-refresh",
  overrides = {},
} = {}) {
  const token_ciphertext = await fakeEncrypt(
    serializeGoogleTokenBundle({ userId, accessToken, refreshToken }),
  );
  return {
    user_id: userId,
    access_token: null,
    refresh_token: null,
    token_ciphertext,
    refresh_claim_id: null,
    refresh_claimed_at: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    scopes: "scope-a",
    ...overrides,
  };
}

test("the production AES-GCM vault encrypts a versioned, user-bound Google bundle", async () => {
  const originalKey = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
  const vaultUrl = pathToFileURL(path.resolve("src/integrations/credential-vault.server.ts")).href;
  const vault = await import(`${vaultUrl}?google-token-test=${Date.now()}`);
  const firstKey = Buffer.alloc(32, 17).toString("base64");
  const secondKey = Buffer.alloc(32, 29).toString("base64");

  try {
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = firstKey;
    await vault.requireCredentialVaultConfiguration();
    const cleartext = serializeGoogleTokenBundle({
      userId: "user-a",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    });
    const ciphertext = await vault.encryptCredential(cleartext);

    assert.match(ciphertext, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(ciphertext, /access-secret|refresh-secret|user-a/);
    assert.deepEqual(parseGoogleTokenBundle(await vault.decryptCredential(ciphertext), "user-a"), {
      version: 1,
      userId: "user-a",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    });
    assert.throws(() => parseGoogleTokenBundle(cleartext, "user-b"), /invalid_google_token_bundle/);

    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = secondKey;
    await assert.rejects(vault.decryptCredential(ciphertext));

    delete process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
    await assert.rejects(
      vault.requireCredentialVaultConfiguration(),
      /connector_encryption_not_configured/,
    );
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = "not-a-32-byte-key";
    await assert.rejects(
      vault.requireCredentialVaultConfiguration(),
      /connector_encryption_key_must_be_32_bytes/,
    );
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = `${firstKey.slice(0, 10)}!${firstKey.slice(10)}`;
    await assert.rejects(
      vault.requireCredentialVaultConfiguration(),
      /connector_encryption_key_must_be_32_bytes/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
    else process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = originalKey;
  }
});

test("refresh-token omission preserves the encrypted refresh capability", () => {
  assert.equal(preserveGoogleRefreshToken(undefined, "existing-refresh"), "existing-refresh");
  assert.equal(
    preserveGoogleRefreshToken("rotated-refresh", "existing-refresh"),
    "rotated-refresh",
  );
  assert.equal(preserveGoogleRefreshToken(undefined, undefined), null);
});

test("a failed legacy migration prevents the provider operation", async () => {
  let providerCalls = 0;
  const legacy = {
    user_id: "user-a",
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    token_ciphertext: null,
    refresh_claim_id: null,
    refresh_claimed_at: null,
    expires_at: "2026-08-01T01:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    scopes: "scope-a",
  };
  await assert.rejects(
    runAfterGoogleTokenStorageReady(
      () =>
        loadGoogleTokenCredential({
          userId: "user-a",
          row: legacy,
          encrypt: fakeEncrypt,
          decrypt: fakeDecrypt,
          migrateLegacy: async () => {
            throw new Error("mock_supabase_update_failed");
          },
          refetch: async () => legacy,
        }),
      async () => {
        providerCalls += 1;
      },
    ),
    /google_token_migration_failed/,
  );
  assert.equal(providerCalls, 0);
});

test("legacy storage is encrypted and clears plaintext in one mocked Supabase update", async () => {
  const legacy = {
    user_id: "user-a",
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    token_ciphertext: null,
    refresh_claim_id: null,
    refresh_claimed_at: null,
    expires_at: "2026-08-01T01:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    scopes: "scope-a",
  };
  let writes = 0;
  const stored = await loadGoogleTokenCredential({
    userId: "user-a",
    row: legacy,
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    migrateLegacy: async (write) => {
      writes += 1;
      assert.equal(write.access_token, null);
      assert.equal(write.refresh_token, null);
      assert.ok(write.token_ciphertext);
      return { ...legacy, ...write, updated_at: "2026-08-01T00:00:01.000Z" };
    },
    refetch: async () => null,
  });

  assert.equal(writes, 1);
  assert.equal(stored.bundle.accessToken, "legacy-access");
  assert.equal(stored.bundle.refreshToken, "legacy-refresh");
  assert.equal(stored.row.access_token, null);
  assert.equal(stored.row.refresh_token, null);
});

test("concurrent legacy migration fallback accepts only owner-bound ciphertext", async () => {
  const legacy = {
    user_id: "user-a",
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    token_ciphertext: null,
    refresh_claim_id: null,
    refresh_claimed_at: null,
    expires_at: "2026-08-01T01:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    scopes: "scope-a",
  };
  const ownerRow = await encryptedRow({ userId: "user-a" });
  const accepted = await loadGoogleTokenCredential({
    userId: "user-a",
    row: legacy,
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    migrateLegacy: async () => null,
    refetch: async () => ownerRow,
  });
  assert.equal(accepted.bundle.userId, "user-a");

  const copiedFromAnotherOwner = await encryptedRow({ userId: "user-b" });
  await assert.rejects(
    loadGoogleTokenCredential({
      userId: "user-a",
      row: legacy,
      encrypt: fakeEncrypt,
      decrypt: fakeDecrypt,
      migrateLegacy: async () => null,
      refetch: async () => copiedFromAnotherOwner,
    }),
    /google_token_migration_failed/,
  );
});

test("new connects submit ciphertext and never plaintext token values", async () => {
  let submitted;
  await storeGoogleTokenCredential({
    userId: "user-a",
    accessToken: "new-access",
    refreshToken: "new-refresh",
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    upsert: async (write) => {
      submitted = write;
      return {
        ...(await encryptedRow({ accessToken: "new-access", refreshToken: "new-refresh" })),
        ...write,
      };
    },
  });

  assert.equal(submitted.access_token, null);
  assert.equal(submitted.refresh_token, null);
  const bundle = parseGoogleTokenBundle(await fakeDecrypt(submitted.token_ciphertext), "user-a");
  assert.equal(bundle.accessToken, "new-access");
  assert.equal(bundle.refreshToken, "new-refresh");
});

test("refresh is claimed before mocked fetch and preserves an omitted refresh token", async () => {
  const row = await encryptedRow();
  const events = [];
  let completedWrite;
  const accessToken = await refreshGoogleTokenCredential({
    userId: "user-a",
    load: async () => ({
      row,
      bundle: parseGoogleTokenBundle(await fakeDecrypt(row.token_ciphertext), "user-a"),
    }),
    claimRefresh: async (current, claim) => {
      events.push("supabase-claim");
      return {
        ...current,
        refresh_claim_id: claim.id,
        refresh_claimed_at: claim.at,
        updated_at: claim.at,
      };
    },
    refetch: async () => row,
    releaseRefresh: async () => {
      events.push("supabase-release");
    },
    providerRefresh: async (refreshToken) => {
      events.push("provider-fetch");
      assert.equal(refreshToken, "old-refresh");
      return { accessToken: "rotated-access", expiresIn: 3600 };
    },
    completeRefresh: async ({ claimedRow, write }) => {
      events.push("supabase-complete");
      completedWrite = write;
      return {
        ...claimedRow,
        ...write,
        refresh_claim_id: null,
        refresh_claimed_at: null,
        expires_at: "2099-01-01T00:00:00.000Z",
      };
    },
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    now: () => Date.parse("2026-08-01T00:00:00.000Z"),
    createClaimId: () => "claim-a",
  });

  assert.equal(accessToken, "rotated-access");
  assert.deepEqual(events, ["supabase-claim", "provider-fetch", "supabase-complete"]);
  const bundle = parseGoogleTokenBundle(
    await fakeDecrypt(completedWrite.token_ciphertext),
    "user-a",
  );
  assert.equal(bundle.refreshToken, "old-refresh");
});

test("refresh CAS loss returns only a valid refetched owner credential", async () => {
  const row = await encryptedRow();
  const winner = await encryptedRow({ accessToken: "winner-access" });
  let refetches = 0;
  const accessToken = await refreshGoogleTokenCredential({
    userId: "user-a",
    load: async () => ({
      row,
      bundle: parseGoogleTokenBundle(await fakeDecrypt(row.token_ciphertext), "user-a"),
    }),
    claimRefresh: async (current, claim) => ({
      ...current,
      refresh_claim_id: claim.id,
      refresh_claimed_at: claim.at,
      updated_at: claim.at,
    }),
    refetch: async () => {
      refetches += 1;
      return winner;
    },
    releaseRefresh: async () => undefined,
    providerRefresh: async () => ({ accessToken: "loser-access", expiresIn: 3600 }),
    completeRefresh: async () => null,
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    now: () => Date.parse("2026-08-01T00:00:00.000Z"),
    createClaimId: () => "claim-a",
  });
  assert.equal(refetches, 1);
  assert.equal(accessToken, "winner-access");
});

test("an active refresh claim makes zero provider calls", async () => {
  const row = await encryptedRow({
    overrides: {
      refresh_claim_id: "active-claim",
      refresh_claimed_at: "2026-08-01T00:00:00.000Z",
    },
  });
  let providerCalls = 0;
  await assert.rejects(
    refreshGoogleTokenCredential({
      userId: "user-a",
      load: async () => ({
        row,
        bundle: parseGoogleTokenBundle(await fakeDecrypt(row.token_ciphertext), "user-a"),
      }),
      claimRefresh: async () => null,
      refetch: async () => row,
      releaseRefresh: async () => undefined,
      providerRefresh: async () => {
        providerCalls += 1;
        return { accessToken: "never" };
      },
      completeRefresh: async () => null,
      encrypt: fakeEncrypt,
      decrypt: fakeDecrypt,
      now: () => Date.parse("2026-08-01T00:00:30.000Z"),
    }),
    /google_token_refresh_in_progress/,
  );
  assert.equal(providerCalls, 0);
});

test("disconnect verifies mocked Supabase CAS deletion before mocked provider revocation", async () => {
  const row = await encryptedRow();
  const stored = {
    row,
    bundle: parseGoogleTokenBundle(await fakeDecrypt(row.token_ciphertext), "user-a"),
  };
  let revokeCalls = 0;
  await assert.rejects(
    disconnectGoogleTokenCredential({
      load: async () => stored,
      deleteRow: async () => false,
      revoke: async () => {
        revokeCalls += 1;
      },
    }),
    /google_token_purge_failed/,
  );
  assert.equal(revokeCalls, 0);

  const events = [];
  await disconnectGoogleTokenCredential({
    load: async () => stored,
    deleteRow: async () => {
      events.push("supabase-delete");
      return true;
    },
    revoke: async (token) => {
      events.push("provider-revoke");
      assert.equal(token, "old-refresh");
    },
  });
  assert.deepEqual(events, ["supabase-delete", "provider-revoke"]);
});
