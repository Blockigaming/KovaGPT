import { createHash, randomBytes } from "node:crypto";
import {
  assertLaunchCertified,
  ConnectorError,
  requireLaunchConnector,
  requirePermissions,
  validateOperation,
} from "./launch-contracts.mjs";
import {
  authorizationUrl,
  exchangeGrant,
  providerConfig,
  revokeGrant,
} from "./launch-oauth.server.mjs";
import { executeProviderRead, PROBE_OPERATIONS } from "./launch-providers.server.mjs";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const now = () => new Date().toISOString();
const safeReturn = (v) =>
  typeof v === "string" && /^\/(?!\/)/.test(v) && !/[\\\x00-\x20]/.test(v) ? v : "/apps";
function checked(result, code) {
  if (result.error || !result.data) throw new ConnectorError(code, 503);
  return result.data;
}
function callbackUri(origin, connector) {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.origin !== origin || u.username || u.password)
      throw new Error();
    return `${origin}/api/integrations/launch/${connector}`;
  } catch {
    throw new ConnectorError("connector_origin_not_configured", 503);
  }
}
/** Dependencies are server-owned, never built from request or provider data. */
export function createLaunchRuntime({
  db,
  encrypt,
  decrypt,
  assertSession,
  assertAllowed,
  env = process.env,
  transport = {},
  assertCertified = assertLaunchCertified,
}) {
  const check = async (ownerId, sessionId, capability) => {
    await assertSession(ownerId, sessionId);
    await assertAllowed(ownerId, capability);
  };
  const encryptToken = (ownerId, connector, token) =>
    encrypt(JSON.stringify({ version: 1, ownerId, connector, token }));
  const decryptToken = async (row, ownerId, connector) => {
    try {
      const envelope = JSON.parse(await decrypt(row.access_token_ciphertext));
      if (
        envelope.version !== 1 ||
        envelope.ownerId !== ownerId ||
        envelope.connector !== connector ||
        envelope.token.subject !== row.provider_account_id
      )
        throw new Error();
      return envelope.token;
    } catch {
      throw new ConnectorError("reauthorization_required", 401);
    }
  };
  const account = async (ownerId, connector, accountId) => {
    const result = await db
      .from("integration_linked_accounts")
      .select("*")
      .eq("id", accountId)
      .eq("owner_id", ownerId)
      .eq("provider_id", connector)
      .is("deleted_at", null)
      .maybeSingle();
    if (result.error) throw new ConnectorError("connector_store_unavailable", 503);
    if (!result.data || result.data.status !== "connected")
      throw new ConnectorError("not_connected", 409);
    return result.data;
  };
  const stillCurrent = async (ownerId, connector, row) => {
    const current = await account(ownerId, connector, row.id);
    if (current.access_token_ciphertext !== row.access_token_ciphertext)
      throw new ConnectorError("connection_changed", 409);
    return current;
  };
  async function begin({ ownerId, sessionId, connector, browserNonce, origin, returnPath }) {
    assertCertified(connector);
    const contract = requireLaunchConnector(connector);
    await check(ownerId, sessionId, "connector_write");
    if (!sessionId || !browserNonce) throw new ConnectorError("oauth_session_required", 401);
    const redirectUri = callbackUri(env.KOVA_CONNECTOR_PUBLIC_ORIGIN, connector);
    if (origin !== env.KOVA_CONNECTOR_PUBLIC_ORIGIN)
      throw new ConnectorError("oauth_origin_mismatch", 400);
    const config = providerConfig(connector, env),
      state = random(),
      verifier = contract.pkce ? random() : null;
    const transaction = { version: 1, ownerId, sessionId, connector, verifier, redirectUri };
    const result = await db
      .from("integration_oauth_states")
      .insert({
        owner_id: ownerId,
        provider_id: connector,
        state_hash: digest(state),
        nonce_hash: digest(browserNonce),
        pkce_verifier_ciphertext: await encrypt(JSON.stringify(transaction)),
        requested_scopes: contract.scopes,
        return_path: safeReturn(returnPath),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    if (result.error) throw new ConnectorError("oauth_state_store_failed", 503);
    return {
      url: authorizationUrl(connector, config, { state, verifier, redirectUri }),
      consent: { provider: contract.name, mode: "read", scopes: contract.scopes },
    };
  }
  async function complete({ connector, state, code, browserNonce, origin }) {
    assertCertified(connector);
    if (
      origin !== env.KOVA_CONNECTOR_PUBLIC_ORIGIN ||
      typeof state !== "string" ||
      state.length > 200 ||
      typeof code !== "string" ||
      code.length > 4096 ||
      !browserNonce
    )
      throw new ConnectorError("invalid_oauth_state", 400);
    const nonceHash = digest(browserNonce);
    const record = checked(
      await db
        .from("integration_oauth_states")
        .select("*")
        .eq("provider_id", connector)
        .eq("state_hash", digest(state))
        .eq("nonce_hash", nonceHash)
        .is("consumed_at", null)
        .gt("expires_at", now())
        .maybeSingle(),
      "invalid_oauth_state",
    );
    let transaction;
    try {
      transaction = JSON.parse(await decrypt(record.pkce_verifier_ciphertext));
    } catch {
      throw new ConnectorError("invalid_oauth_state", 400);
    }
    if (
      transaction.version !== 1 ||
      transaction.ownerId !== record.owner_id ||
      transaction.connector !== connector ||
      transaction.redirectUri !== callbackUri(env.KOVA_CONNECTOR_PUBLIC_ORIGIN, connector)
    )
      throw new ConnectorError("invalid_oauth_state", 400);
    const { ownerId, sessionId } = transaction;
    await check(ownerId, sessionId, "connector_write");
    checked(
      await db
        .from("integration_oauth_states")
        .update({ consumed_at: now() })
        .eq("id", record.id)
        .eq("owner_id", ownerId)
        .eq("provider_id", connector)
        .eq("nonce_hash", nonceHash)
        .is("consumed_at", null)
        .gt("expires_at", now())
        .select("id")
        .maybeSingle(),
      "oauth_state_replayed",
    );
    const config = providerConfig(connector, env);
    let token;
    try {
      token = await exchangeGrant(
        connector,
        config,
        { code, verifier: transaction.verifier, redirectUri: transaction.redirectUri },
        transport,
      );
      const [operation, args] = PROBE_OPERATIONS[connector];
      await executeProviderRead(connector, operation, args, token, null, transport);
      await check(ownerId, sessionId, "connector_write");
      assertCertified(connector);
      const saved = checked(
        await db.rpc("settle_launch_connector", {
          p_owner: ownerId,
          p_provider: connector,
          p_state: record.id,
          p_nonce_hash: nonceHash,
          p_account: {
            provider_account_id: token.subject,
            account_label: token.label,
            granted_scopes: token.scopes,
            access_token_ciphertext: await encryptToken(ownerId, connector, token),
            token_expires_at: token.expiresAt,
          },
        }),
        "oauth_settlement_failed",
      );
      return { account: saved, returnPath: safeReturn(record.return_path) };
    } catch (error) {
      if (token) await revokeGrant(connector, config, token, transport);
      throw error instanceof ConnectorError ? error : new ConnectorError("oauth_connection_failed");
    }
  }
  async function refresh(ownerId, connector, row, token, sessionId) {
    await check(ownerId, sessionId, "connector_read");
    assertCertified(connector);
    if (!token.refreshToken) throw new ConnectorError("reauthorization_required", 401);
    // A DB CAS prevents concurrent refresh-token use across server instances.
    // Crashed/uncertain refreshes require reconnect rather than blind replay.
    checked(
      await db
        .from("integration_linked_accounts")
        .update({ status: "expired", last_error_code: "refresh_in_progress" })
        .eq("id", row.id)
        .eq("owner_id", ownerId)
        .eq("provider_id", connector)
        .eq("status", "connected")
        .eq("access_token_ciphertext", row.access_token_ciphertext)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle(),
      "connection_changed",
    );
    const lease = () =>
      db
        .from("integration_linked_accounts")
        .update({ status: "error", last_error_code: "reauthorization_required" })
        .eq("id", row.id)
        .eq("owner_id", ownerId)
        .eq("provider_id", connector)
        .eq("status", "expired")
        .eq("access_token_ciphertext", row.access_token_ciphertext)
        .is("deleted_at", null);
    let next;
    try {
      next = await exchangeGrant(
        connector,
        providerConfig(connector, env),
        { refreshToken: token.refreshToken },
        transport,
        token,
      );
      await check(ownerId, sessionId, "connector_read");
      assertCertified(connector);
      const ciphertext = await encryptToken(ownerId, connector, next);
      const saved = checked(
        await db
          .from("integration_linked_accounts")
          .update({
            status: "connected",
            last_error_code: null,
            access_token_ciphertext: ciphertext,
            granted_scopes: next.scopes,
            token_expires_at: next.expiresAt,
            updated_at: now(),
          })
          .eq("id", row.id)
          .eq("owner_id", ownerId)
          .eq("provider_id", connector)
          .eq("status", "expired")
          .eq("access_token_ciphertext", row.access_token_ciphertext)
          .is("deleted_at", null)
          .select("*")
          .maybeSingle(),
        "connection_changed",
      );
      return { row: saved, token: next };
    } catch (error) {
      await lease();
      if (next) await revokeGrant(connector, providerConfig(connector, env), next, transport);
      throw error instanceof ConnectorError
        ? error
        : new ConnectorError("reauthorization_required", 401);
    }
  }
  async function execute({
    ownerId,
    sessionId,
    connector,
    accountId,
    operation,
    args: inputArgs = {},
    cursor = null,
  }) {
    assertCertified(connector);
    const args = validateOperation(connector, operation, inputArgs);
    await check(ownerId, sessionId, "connector_read");
    let row = await account(ownerId, connector, accountId);
    requirePermissions(connector, row.granted_scopes);
    let token = await decryptToken(row, ownerId, connector);
    const queryDigest = digest(JSON.stringify([operation, args]));
    let providerCursor = null;
    if (cursor !== null) {
      try {
        if (typeof cursor !== "string" || cursor.length > 20_000) throw new Error();
        const data = JSON.parse(await decrypt(cursor));
        if (
          data.kind !== "connector_cursor" ||
          data.ownerId !== ownerId ||
          data.connector !== connector ||
          data.accountId !== accountId ||
          data.queryDigest !== queryDigest ||
          data.revision !== digest(row.access_token_ciphertext) ||
          data.expires < Date.now()
        )
          throw new Error();
        providerCursor = data.next;
      } catch {
        throw new ConnectorError("invalid_cursor", 400);
      }
    }
    if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now() + 30_000)
      ({ row, token } = await refresh(ownerId, connector, row, token, sessionId));
    await stillCurrent(ownerId, connector, row);
    await check(ownerId, sessionId, "connector_read");
    const invalidate = async (error) => {
      if (!["reauthorization_required", "permission_incomplete"].includes(error?.code)) return;
      await db
        .from("integration_linked_accounts")
        .update({
          status: error.code === "permission_incomplete" ? "permission_incomplete" : "revoked",
          last_error_code: error.code,
        })
        .eq("id", row.id)
        .eq("owner_id", ownerId)
        .eq("provider_id", connector)
        .eq("status", "connected")
        .eq("access_token_ciphertext", row.access_token_ciphertext)
        .is("deleted_at", null);
    };
    let result;
    try {
      result = await executeProviderRead(
        connector,
        operation,
        args,
        token,
        providerCursor,
        transport,
      );
    } catch (error) {
      // Only an idempotent read retries once after refresh, never an exchange.
      if (error.code !== "reauthorization_required" || !token.refreshToken) {
        await invalidate(error);
        throw error;
      }
      ({ row, token } = await refresh(ownerId, connector, row, token, sessionId));
      try {
        result = await executeProviderRead(
          connector,
          operation,
          args,
          token,
          providerCursor,
          transport,
        );
      } catch (retryError) {
        await invalidate(retryError);
        throw retryError;
      }
    }
    await stillCurrent(ownerId, connector, row);
    await check(ownerId, sessionId, "connector_read");
    assertCertified(connector);
    const nextCursor =
      result.next === null
        ? null
        : await encrypt(
            JSON.stringify({
              kind: "connector_cursor",
              ownerId,
              connector,
              accountId,
              queryDigest,
              revision: digest(row.access_token_ciphertext),
              next: result.next,
              expires: Date.now() + 600_000,
            }),
          );
    return { items: result.items, nextCursor, contentIsUntrusted: true };
  }
  async function disconnect({ ownerId, connector, accountId }) {
    requireLaunchConnector(connector);
    // Always available during lockdown or after decertification; delete locally first.
    const local = checked(
      await db.rpc("disconnect_launch_connector", {
        p_owner: ownerId,
        p_provider: connector,
        p_account: accountId,
      }),
      "connector_disconnect_failed",
    );
    if (local.account?.provider_id !== connector || local.account?.owner_id !== ownerId)
      throw new ConnectorError("not_connected", 409);
    let result = { providerRevoked: false, remoteStatus: "manual_revocation_required" };
    if (local.account.access_token_ciphertext !== "deleted") {
      try {
        result = await revokeGrant(
          connector,
          providerConfig(connector, env),
          await decryptToken(local.account, ownerId, connector),
          transport,
        );
      } catch {
        /* Local deletion has already committed. */
      }
    }
    const saved = await db
      .from("integration_deletion_requests")
      .update({
        status: result.providerRevoked ? "provider_revoked" : "local_deleted",
        last_error_code: result.providerRevoked ? null : result.remoteStatus,
      })
      .eq("id", local.deletion_id)
      .eq("owner_id", ownerId);
    return { localDisconnected: true, ...result, cleanupRecorded: !saved.error };
  }
  return { begin, complete, execute, disconnect };
}
