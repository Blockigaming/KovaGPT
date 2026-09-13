import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { hasGoogleCapability, parseGoogleBinding } from "./google-account-policy.mjs";

export function createGoogleAccountRuntime({
  vault,
  encrypt,
  decrypt,
  clientId,
  clientSecret,
  fetchImpl = fetch,
}) {
  const json = async (url, init) => {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        response.status === 400 || response.status === 401
          ? "google_reauthorization_required"
          : "google_temporarily_unavailable",
      );
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readResponseBytesBounded(response, 64 * 1024),
        ),
      );
    } catch {
      throw new Error("google_invalid_provider_response");
    }
  };
  const identity = async (token) => {
    const result = await json("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (
      typeof result.sub !== "string" ||
      result.sub.length < 1 ||
      result.sub.length > 255 ||
      typeof result.email !== "string" ||
      result.email.length > 320 ||
      result.email_verified !== true
    )
      throw new Error("google_invalid_provider_identity");
    return { sub: result.sub, email: result.email };
  };
  const tokenPayload = (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.access_token !== "string" ||
      value.access_token.length < 1 ||
      value.access_token.length > 32000 ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in < 60 ||
      value.expires_in > 86400 ||
      (value.refresh_token != null &&
        (typeof value.refresh_token !== "string" ||
          value.refresh_token.length < 1 ||
          value.refresh_token.length > 32000)) ||
      (value.scope != null && (typeof value.scope !== "string" || value.scope.length > 16000))
    )
      throw new Error("google_invalid_provider_response");
    return value;
  };
  const pin = (conn) => ({
    connectionId: conn.id,
    grantId: conn.grant_id,
    googleSub: conn.google_sub,
    credentialRevision: conn.credential_revision,
  });
  async function connection(userId, binding = {}) {
    const selected = parseGoogleBinding(binding);
    return vault(userId, "get", {
      connectionId: selected.connectionId,
      grantId: selected.grantId,
      googleSub: selected.expectedGoogleSub,
    });
  }
  async function accessToken(userId, binding = {}) {
    const selected = parseGoogleBinding(binding);
    let conn = await connection(userId, selected);
    if (conn.reauthorization_required || !conn.google_sub)
      throw new Error("google_reauthorization_required");
    if (selected.capability && !hasGoogleCapability(conn.scopes, selected.capability))
      throw new Error("google_permission_incomplete");
    let token;
    if (Date.parse(conn.expires_at) > Date.now() + 5000) {
      token = await decrypt(conn.access_token);
      if (!conn.identity_verified) {
        const owner = await identity(token);
        if (owner.sub !== conn.google_sub) throw new Error("google_connection_changed");
        conn = await vault(userId, "verify_identity", {
          ...pin(conn),
          verifiedSub: owner.sub,
          accessToken: await encrypt(token),
          refreshToken: conn.refresh_token
            ? await encrypt(await decrypt(conn.refresh_token))
            : null,
        });
      }
    } else {
      const requestId = crypto.randomUUID(),
        bound = pin(conn);
      const claim = await vault(userId, "claim_refresh", { ...bound, requestId });
      if (claim.state !== "claimed") throw new Error("google_temporarily_unavailable");
      try {
        const refresh = await decrypt(conn.refresh_token);
        const response = tokenPayload(
          await json("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refresh,
              grant_type: "refresh_token",
            }),
          }),
        );
        token = response.access_token;
        const owner = await identity(token);
        if (owner.sub !== conn.google_sub) throw new Error("google_connection_changed");
        conn = await vault(userId, "complete_refresh", {
          ...bound,
          requestId,
          verifiedSub: owner.sub,
          accessToken: await encrypt(token),
          refreshToken: response.refresh_token ? await encrypt(response.refresh_token) : null,
          expiresAt: new Date(Date.now() + (response.expires_in - 30) * 1000).toISOString(),
          scopes: response.scope,
        });
      } catch (error) {
        await vault(userId, "fail_refresh", {
          ...bound,
          requestId,
          reauthorize: [
            "google_reauthorization_required",
            "google_connection_changed",
            "google_invalid_provider_identity",
          ].includes(error?.message),
        }).catch(() => {});
        throw error;
      }
    }
    // A disconnect, reauthorization or permission change while the provider was
    // responding invalidates the token before it reaches a resource request.
    const current = await connection(userId, {
      connectionId: conn.id,
      grantId: selected.grantId ?? conn.grant_id,
      expectedGoogleSub: conn.google_sub,
    });
    if (current.credential_revision !== conn.credential_revision)
      throw new Error("google_refresh_conflict");
    if (selected.capability && !hasGoogleCapability(current.scopes, selected.capability))
      throw new Error("google_permission_incomplete");
    return token;
  }
  async function store(userId, value, attemptId) {
    const tokens = tokenPayload(value),
      owner = await identity(tokens.access_token);
    return vault(userId, "complete_oauth", {
      attemptId,
      googleSub: owner.sub,
      email: owner.email,
      accessToken: await encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? await encrypt(tokens.refresh_token) : null,
      expiresAt: new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString(),
      scopes: tokens.scope ?? "",
    });
  }
  async function disconnect(userId, connectionId, expectedRevision) {
    if (connectionId !== null) {
      parseGoogleBinding({ connectionId });
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        throw new Error("google_invalid_account_selection");
    }
    // Revoke local use first. Provider revocation is bounded and best effort.
    const rows = await vault(userId, connectionId === null ? "disconnect_all" : "disconnect", {
      connectionId,
      expectedRevision,
    });
    await Promise.all(
      rows.map(async (row) => {
        const stored = row.refreshToken || row.accessToken;
        if (!stored) return;
        try {
          const token = await decrypt(stored);
          await fetchImpl("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token }),
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          });
        } catch {
          /* Local credentials remain revoked when Google is unreachable. */
        }
      }),
    );
  }
  return { connection, accessToken, store, disconnect, identity };
}
