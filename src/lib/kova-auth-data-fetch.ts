import {
  clearKovaAuthCache,
  getKovaCompatibilityToken,
  isKovaSessionActive,
} from "@/lib/kova-auth-browser";

/** Discard rejected JWTs; only safe reads may be repeated, once, with a fresh token. */
export function createKovaDataFetch(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status !== 401 || !isKovaSessionActive()) return response;
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const headers = new Headers(init?.headers ?? request?.headers);
    if (
      url.origin !== origin ||
      !/^\/(?:rest|storage|graphql)\/v1(?:\/|$)/u.test(url.pathname) ||
      !headers.get("Authorization")?.startsWith("Bearer ")
    )
      return response;

    clearKovaAuthCache();
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signal = init?.signal ?? request?.signal;
    // Retrying a mutation can duplicate side effects. Its next explicit attempt
    // will get a fresh token, but this transport never repeats it automatically.
    if (!["GET", "HEAD"].includes(method) || signal?.aborted) return response;
    const token = await getKovaCompatibilityToken();
    if (!token || !isKovaSessionActive() || signal?.aborted) return response;
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  };
}
