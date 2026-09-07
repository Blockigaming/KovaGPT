import { createHmac, timingSafeEqual } from "node:crypto";
import { readBoundedJsonObject } from "../bounded-json.server.mjs";
import {
  discoveryInput,
  publicDiscoveryUrl,
  normalizeDiscoverySearch,
  normalizeDiscoveryProduct,
} from "./discovery-policy.mjs";
const signature = (value, secret) =>
  createHmac("sha256", secret).update(`kova:discovery:source:v1\n${value}`).digest("base64url");
export function issueDiscoverySource(owner, url, secret, now) {
  const body = Buffer.from(JSON.stringify({ owner, url, exp: now + 15 * 60 * 1000 })).toString(
    "base64url",
  );
  return `${body}.${signature(body, secret)}`;
}
export function verifyDiscoverySource(token, owner, secret, now) {
  try {
    if (typeof token !== "string" || token.length > 4096) throw new Error();
    const [body, mac, extra] = token.split(".");
    const expected = signature(body, secret);
    if (
      extra ||
      !mac ||
      mac.length !== expected.length ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    )
      throw new Error();
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const url = publicDiscoveryUrl(value.url);
    if (
      value.owner !== owner ||
      !url ||
      !Number.isSafeInteger(value.exp) ||
      value.exp <= now ||
      value.exp > now + 15 * 60 * 1000
    )
      throw new Error();
    return url;
  } catch {
    throw new Error("discovery_source_expired");
  }
}
/** One admitted provider request, no provider retry and no direct merchant fetch. */
export async function runDiscovery({
  owner,
  input,
  config,
  admit,
  signal,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!config.enabled) throw new Error("discovery_disabled");
  const value = discoveryInput(input);
  const url =
    value.operation === "product"
      ? verifyDiscoverySource(value.sourceToken, owner, config.signingSecret, now())
      : null;
  if (signal?.aborted) throw new Error("discovery_cancelled");
  const allowed = await admit();
  if (!allowed) throw new Error("discovery_daily_limit");
  if (signal?.aborted) throw new Error("discovery_cancelled");
  const activeSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
    : AbortSignal.timeout(20000);
  const body =
    value.operation === "product"
      ? { url, formats: ["product"], maxAge: 0, parsers: [], timeout: 15000 }
      : {
          query: value.query,
          sources: [value.mode === "images" ? "images" : "web"],
          limit: 6,
          safe: true,
          timeout: 15000,
          ...(value.location ? { location: value.location } : {}),
        };
  let response, payload;
  try {
    response = await fetchImpl(
      `https://api.firecrawl.dev/v2/${value.operation === "product" ? "scrape" : "search"}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: activeSignal,
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
    );
    if (!response.ok) throw new Error();
    payload = await readBoundedJsonObject(response, 262144, activeSignal);
  } catch {
    throw new Error(
      activeSignal.aborted ? "discovery_cancelled" : "discovery_provider_unavailable",
    );
  }
  const observedAt = new Date(now()).toISOString();
  if (value.operation === "product")
    return { operation: "product", product: normalizeDiscoveryProduct(payload, url, observedAt) };
  const results = normalizeDiscoverySearch(payload, value.mode, observedAt).map((row) => ({
    ...row,
    ...(value.mode === "shopping"
      ? { sourceToken: issueDiscoverySource(owner, row.url, config.signingSecret, now()) }
      : {}),
  }));
  return {
    operation: "search",
    mode: value.mode,
    query: value.query,
    location: value.location,
    observedAt,
    results,
  };
}
