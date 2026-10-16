import { ConnectorError } from "./launch-contracts.mjs";
import { readBoundedUtf8 } from "../lib/bounded-json.server.mjs";
export async function providerRequest(
  url,
  init = {},
  { fetchImpl = fetch, signal, allowEmpty = false } = {},
) {
  const timeout = AbortSignal.timeout(15_000);
  const boundedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: boundedSignal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const code =
        response.status === 401
          ? "reauthorization_required"
          : response.status === 403
            ? "permission_incomplete"
            : response.status === 429
              ? "provider_rate_limited"
              : "provider_request_failed";
      throw new ConnectorError(
        code,
        [401, 403, 429].includes(response.status) ? response.status : 502,
      );
    }
    const raw = await readBoundedUtf8(response, 1_048_576, boundedSignal);
    if (!raw && allowEmpty) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new ConnectorError("provider_response_invalid");
    if (data.ok === false || data.error || (Array.isArray(data.errors) && data.errors.length)) {
      const unauthorized = [
        "invalid_grant",
        "invalid_auth",
        "token_revoked",
        "token_expired",
        "not_authed",
      ].includes(data.error);
      throw new ConnectorError(
        unauthorized ? "reauthorization_required" : "provider_request_failed",
        unauthorized ? 401 : 502,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    // Never include upstream bodies, request URLs, secrets or network diagnostics.
    throw new ConnectorError(
      signal?.aborted ? "request_aborted" : "provider_request_failed",
      signal?.aborted ? 499 : 502,
    );
  }
}
export const bearerHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
});
export const jsonPost = (data, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(data),
});
export const formPost = (data, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  body: new URLSearchParams(data),
});
export function salesforceOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.salesforce\.com$/.test(url.hostname)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new ConnectorError("provider_origin_invalid");
  }
}
