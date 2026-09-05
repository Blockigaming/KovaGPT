import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
/** Native credentials are never revoked based only on an ambiguous database error. */
export function createGoogleOAuthSettlement({
  rpc,
  exchange,
  identity,
  refresh,
  encrypt,
  decrypt,
  fetchImpl = fetch,
}) {
  async function tokenPayload(tokens) {
    if (
      !tokens ||
      typeof tokens.access_token !== "string" ||
      !tokens.access_token.length ||
      tokens.access_token.length > 32000 ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in < 60 ||
      tokens.expires_in > 86400 ||
      (tokens.refresh_token != null &&
        (typeof tokens.refresh_token !== "string" ||
          !tokens.refresh_token.length ||
          tokens.refresh_token.length > 32000)) ||
      (tokens.scope != null && (typeof tokens.scope !== "string" || tokens.scope.length > 16000))
    )
      throw new Error("google_invalid_provider_response");
    return {
      accessToken: await encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? await encrypt(tokens.refresh_token) : null,
      expiresAt: new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString(),
      scopes: tokens.scope ?? "",
    };
  }
  async function cleanup({ receiptId, limit = 1 } = {}) {
    let processed = 0;
    for (let index = 0; index < Math.min(2, Math.max(1, limit)); index++) {
      const workerId = crypto.randomUUID();
      const row = await rpc(null, "cleanup_claim", {
        workerId,
        ...(receiptId ? { receiptId } : {}),
      });
      if (!row) break;
      if (row.protected || row.busy) {
        processed++;
        continue;
      }
      const args = { workerId, receiptId: row.id };
      try {
        if (row.staged) {
          let staged = row.payload;
          if (Date.parse(staged.expiresAt) <= Date.now() + 5000) {
            if (!staged.refreshToken) {
              await rpc(null, "cleanup_done", args);
              processed++;
              continue;
            }
            if (!refresh) throw new Error("google_recovery_unavailable");
            const previousRefresh = await decrypt(staged.refreshToken);
            let renewed;
            try {
              renewed = await refresh(previousRefresh);
            } catch (error) {
              if (error?.message !== "google_staged_refresh_invalid") throw error;
              await rpc(null, "cleanup_expired", args);
              processed++;
              continue;
            }
            staged = await tokenPayload({
              ...renewed,
              refresh_token: renewed.refresh_token ?? previousRefresh,
              scope: renewed.scope ?? staged.scopes,
            });
            await rpc(null, "refresh_staged", { claimId: row.id, workerId, payload: staged });
          }
          const owner = await identity(await decrypt(staged.accessToken));
          await rpc(null, "recover_settle", {
            claimId: row.id,
            workerId,
            payload: { googleSub: owner.sub, email: owner.email },
          });
          processed++;
          continue;
        }
        const token = await decrypt(row.token);
        const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        let invalidToken = false;
        if (response.status === 400) {
          try {
            const error = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                await readResponseBytesBounded(response, 4096, { timeoutMs: 5000 }),
              ),
            );
            invalidToken = error?.error === "invalid_token";
          } catch {
            /* An unrecognized error is not proof of revocation. */
          }
        } else void response.body?.cancel().catch(() => {});
        if (response.status !== 200 && !invalidToken) throw new Error("google_revoke_unavailable");
        await rpc(null, "cleanup_done", args);
        processed++;
      } catch {
        await rpc(null, "cleanup_retry", args).catch(() => {});
      }
    }
    await rpc(null, "prune", {}).catch(() => {});
    return { processed };
  }
  async function finish(userId, attemptId, code, request, verifier) {
    const claimId = crypto.randomUUID();
    // Only a successfully acknowledged durable claim permits code exchange.
    await rpc(userId, "claim", { attemptId, claimId });
    const tokens = await exchange(code, request, verifier);
    const staged = { claimId, payload: await tokenPayload(tokens) };
    try {
      await rpc(userId, "stage", staged);
    } catch {
      const status = await rpc(userId, "status", { claimId });
      if (status.state === "claimed") await rpc(userId, "stage", staged);
      else if (status.state !== "staged") throw new Error("google_connection_unavailable");
    }
    // Even a failed identity request now leaves encrypted credentials in a
    // leased recovery receipt; a one-use code never needs to be exchanged again.
    const owner = await identity(tokens.access_token);
    const data = { claimId, payload: { googleSub: owner.sub, email: owner.email } };
    let settled;
    try {
      settled = await rpc(userId, "settle", data);
    } catch {
      // Reconcile the immutable receipt before considering compensation. A
      // timeout can mean the accepted commit succeeded and its response was lost.
      const status = await rpc(userId, "status", { claimId });
      settled = status.state === "staged" ? await rpc(userId, "settle", data) : status;
    }
    if (settled.state === "accepted") return settled.result;
    if (["rejected", "protected", "revoked"].includes(settled.state)) {
      await cleanup({ receiptId: claimId }).catch(() => {});
      throw new Error("google_connection_changed");
    }
    throw new Error("google_connection_unavailable");
  }
  return { finish, cleanup };
}
