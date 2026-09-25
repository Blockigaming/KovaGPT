import {
  clearKovaAuthCache,
  fetchKovaSession,
  getKovaCompatibilityToken,
  getKovaTokenBinding,
  isKovaSessionActive,
} from "@/lib/kova-auth-browser";

/** Discard rejected JWTs; only safe reads may be repeated, once, with a fresh token. */
export function createKovaDataFetch(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    const authorization = headers.get("Authorization");
    // Capture the token's owner before a slow 401 response can observe another
    // tab's principal. The rejected bearer alone cannot authorize a new owner.
    const expected = authorization?.startsWith("Bearer ")
      ? getKovaTokenBinding(authorization.slice(7))
      : null;
    const response = await fetchImpl(input, init);
    if (response.status !== 401 || !isKovaSessionActive()) return response;
    const url = new URL(request ? request.url : String(input));
    if (
      url.origin !== origin ||
      !/^\/(?:rest|storage|graphql)\/v1(?:\/|$)/u.test(url.pathname) ||
      !authorization?.startsWith("Bearer ")
    )
      return response;

    clearKovaAuthCache();
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signal = init?.signal ?? request?.signal;
    // Retrying a mutation can duplicate side effects. Its next explicit attempt
    // will get a fresh token, but this transport never repeats it automatically.
    if (!["GET", "HEAD"].includes(method) || signal?.aborted || !expected) return response;
    const principal = await fetchKovaSession().catch(() => null);
    if (
      !principal ||
      principal.accountId !== expected.accountId ||
      principal.sessionId !== expected.sessionId
    ) {
      clearKovaAuthCache();
      return response;
    }
    const token = await getKovaCompatibilityToken(expected);
    if (!token || !isKovaSessionActive() || signal?.aborted) return response;
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  };
}
