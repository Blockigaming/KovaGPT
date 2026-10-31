import { readProviderJsonObject } from "../lib/provider-response.server.mjs";

export const SALESFORCE_PROFILE_ENDPOINT =
  "https://login.salesforce.com/services/oauth2/userinfo?version=latest";
const idMatches = (value, prefix) =>
  typeof value === "string" &&
  new RegExp(`^${prefix}[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$`, "u").test(value);
export function salesforceQueryUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("invalid_salesforce_binding");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_salesforce_binding");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.sandbox)?\.(?:my\.)?salesforce\.com$/u.test(
      url.hostname,
    ) ||
    !/^\/services\/data\/v[1-9]\d{1,2}\.0\/query\/?$/u.test(url.pathname)
  )
    throw new Error("invalid_salesforce_binding");
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}
export function packSalesforceCredential(accessToken, profile) {
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    accessToken.length > 8192 ||
    /\s/u.test(accessToken) ||
    !profile ||
    profile.active !== true ||
    !idMatches(profile.organization_id, "00D") ||
    !idMatches(profile.user_id, "005")
  )
    throw new Error("invalid_salesforce_binding");
  const queryUrl = salesforceQueryUrl(profile.urls?.query);
  return JSON.stringify({
    version: 1,
    access_token: accessToken,
    query_url: queryUrl.href,
    organization_id: profile.organization_id,
    user_id: profile.user_id,
  });
}
export function unpackSalesforceCredential(packed) {
  if (typeof packed !== "string" || packed.length > 16_384)
    throw new Error("invalid_salesforce_binding");
  let value;
  try {
    value = JSON.parse(packed);
  } catch {
    throw new Error("invalid_salesforce_binding");
  }
  if (value?.version !== 1) throw new Error("invalid_salesforce_binding");
  // Revalidate every stored binding before sending its token anywhere.
  return JSON.parse(
    packSalesforceCredential(value.access_token, {
      active: true,
      organization_id: value.organization_id,
      user_id: value.user_id,
      urls: { query: value.query_url },
    }),
  );
}
export function salesforceOAuthEndpoint(packed, operation) {
  if (!["token", "revoke"].includes(operation)) throw new Error("invalid_salesforce_operation");
  return `${salesforceQueryUrl(unpackSalesforceCredential(packed).query_url).origin}/services/oauth2/${operation}`;
}
export async function renewSalesforceCredential(
  packed,
  accessToken,
  ensureCurrent,
  fetchImpl = fetch,
) {
  const original = unpackSalesforceCredential(packed);
  await ensureCurrent();
  const response = await fetchImpl(SALESFORCE_PROFILE_ENDPOINT, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("salesforce_identity_unavailable");
  }
  const renewed = packSalesforceCredential(
    accessToken,
    await readProviderJsonObject(response, 128_000),
  );
  const identity = unpackSalesforceCredential(renewed);
  if (
    identity.organization_id.slice(0, 15) !== original.organization_id.slice(0, 15) ||
    identity.user_id.slice(0, 15) !== original.user_id.slice(0, 15)
  )
    throw new Error("salesforce_identity_changed");
  await ensureCurrent();
  return renewed;
}
