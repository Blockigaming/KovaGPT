export const DISCOVERY_MODES = Object.freeze(["web", "images", "shopping", "local"]);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
export function publicDiscoveryUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    // Never navigate to credentials, IP literals, local names, or alternate ports.
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      host.endsWith(".") ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host) ||
      /\.(?:localhost|local|internal|invalid|test|example|lan|home|arpa)$/.test(host)
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
function positive(value, max) {
  return typeof value === "string" &&
    /^[1-9][0-9]*$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= max
    ? Number(value)
    : null;
}
export function discoveryConfiguration(env) {
  const globalDailyLimit = positive(env.KOVA_DISCOVERY_GLOBAL_DAILY_REQUESTS, 100000);
  const userDailyLimit = positive(env.KOVA_DISCOVERY_USER_DAILY_REQUESTS, 1000);
  const apiKey = typeof env.FIRECRAWL_API_KEY === "string" ? env.FIRECRAWL_API_KEY.trim() : "";
  const signingSecret =
    typeof env.KOVA_DISCOVERY_SOURCE_SECRET === "string" ? env.KOVA_DISCOVERY_SOURCE_SECRET : "";
  return {
    enabled:
      env.KOVA_DISCOVERY_ENABLED === "true" &&
      env.KOVA_GENERATION_DISABLED !== "true" &&
      Boolean(apiKey) &&
      signingSecret.length >= 32 &&
      signingSecret.length <= 512 &&
      Boolean(globalDailyLimit && userDailyLimit),
    apiKey,
    signingSecret,
    globalDailyLimit,
    userDailyLimit,
  };
}
export function discoveryInput(value) {
  if (!record(value)) throw new Error("discovery_input_invalid");
  if (value.operation === "product") {
    if (
      Object.keys(value).some((k) => !["operation", "sourceToken"].includes(k)) ||
      typeof value.sourceToken !== "string" ||
      value.sourceToken.length > 4096
    )
      throw new Error("discovery_input_invalid");
    return { operation: "product", sourceToken: value.sourceToken };
  }
  if (
    Object.keys(value).some((k) => !["operation", "mode", "query", "location"].includes(k)) ||
    value.operation !== "search" ||
    !DISCOVERY_MODES.includes(value.mode) ||
    typeof value.query !== "string" ||
    value.query.length > 300 ||
    (value.location !== undefined &&
      (typeof value.location !== "string" || value.location.length > 160))
  )
    throw new Error("discovery_input_invalid");
  const query = text(value.query, 300),
    location = text(value.location, 160);
  if (!query || (value.mode === "local" && !location) || (value.mode !== "local" && location))
    throw new Error("discovery_input_invalid");
  return { operation: "search", mode: value.mode, query, location };
}
export function normalizeDiscoverySearch(payload, mode, observedAt) {
  if (!record(payload) || payload.success !== true || !record(payload.data))
    throw new Error("discovery_provider_unavailable");
  const sourceType = mode === "images" ? "images" : "web";
  if (!Array.isArray(payload.data[sourceType])) throw new Error("discovery_provider_unavailable");
  const seen = new Set();
  const results = [];
  for (const row of payload.data[sourceType].slice(0, 20)) {
    if (!record(row)) continue;
    const url = publicDiscoveryUrl(row.url),
      imageUrl = mode === "images" ? publicDiscoveryUrl(row.imageUrl) : null;
    if (!url || (mode === "images" && !imageUrl)) continue;
    const key = `${url}\n${imageUrl ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      url,
      title: text(row.title, 220) || new URL(url).hostname,
      snippet: text(row.description ?? row.snippet, 600),
      source: new URL(url).hostname,
      observedAt,
      ...(imageUrl ? { imageUrl } : {}),
    });
    if (results.length === 6) break;
  }
  return results;
}
export function normalizeDiscoveryProduct(payload, requestedUrl, observedAt) {
  if (!record(payload) || payload.success !== true || !record(payload.data))
    throw new Error("discovery_provider_unavailable");
  const data = payload.data,
    status = data.metadata?.statusCode;
  const sourceUrl = publicDiscoveryUrl(data.metadata?.sourceURL);
  if (
    !Number.isInteger(status) ||
    !((status >= 200 && status < 300) || status === 304) ||
    !sourceUrl ||
    new URL(sourceUrl).origin !== new URL(requestedUrl).origin
  )
    throw new Error("discovery_page_unavailable");
  const product = data.product,
    productUrl = publicDiscoveryUrl(product?.url);
  if (
    !record(product) ||
    !text(product.title, 220) ||
    !productUrl ||
    new URL(productUrl).origin !== new URL(sourceUrl).origin ||
    !Array.isArray(product.variants) ||
    product.variants.filter(record).length === 0 ||
    product.variants.length > 30
  )
    return { status: "unknown", sourceUrl, observedAt, variants: [] };
  return {
    status: "observed",
    sourceUrl,
    url: productUrl,
    title: text(product.title, 220),
    brand: text(product.brand, 120),
    observedAt,
    variants: product.variants.filter(record).map((v, index) => {
      const amount = v.price?.amount,
        currency = v.price?.currency;
      const price =
        typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount >= 0 &&
        amount <= 1e12 &&
        typeof currency === "string" &&
        /^[A-Z]{3}$/.test(currency)
          ? { amount, currency }
          : null;
      const values = record(v.values)
        ? Object.fromEntries(
            Object.entries(v.values)
              .slice(0, 12)
              .filter(([, value]) => typeof value === "string")
              .map(([k, value]) => [text(k, 60), text(value, 120)]),
          )
        : {};
      return {
        ordinal: index,
        id: text(v.id, 150),
        sku: text(v.sku, 150),
        title: text(v.title, 220),
        values,
        price,
        inStock: typeof v.availability?.inStock === "boolean" ? v.availability.inStock : null,
      };
    }),
  };
}
export function localMapHandoff(query, location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${text(query, 300)} ${text(location, 160)}`.trim())}`;
}

/** Merchant IDs/SKUs survive provider order changes; unidentified entries retain explicit ordinals. */
export function discoveryComparisonKey(product, variant) {
  const values = Object.entries(variant.values).sort(([a], [b]) => a.localeCompare(b));
  const identity = variant.id
    ? ["id", variant.id]
    : variant.sku
      ? ["sku", variant.sku, values]
      : values.length
        ? ["options", variant.title, values]
        : ["unidentified", variant.title, variant.ordinal];
  return JSON.stringify([product.url ?? product.sourceUrl, identity]);
}
