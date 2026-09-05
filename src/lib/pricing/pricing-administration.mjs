import { prepareDeveloperQuote } from "./developer-metering.mjs";

const fail = (code) => {
  throw new Error(`pricing_admin_${code}`);
};
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max = 200) =>
  typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max;
const number = (v, max = 1e9) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= max &&
  Math.round(v * 1e8) / 1e8 === v;
const keys = (v, allowed) => object(v) && Object.keys(v).every((key) => allowed.includes(key));
const meters = {
  responses_tokens: ["input_tokens", "cached_input_tokens", "output_tokens"],
  embedding_tokens: ["input_tokens"],
  image_tokens: ["input_tokens", "image_input_tokens", "output_tokens"],
};
export function canonicalPricingJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalPricingJson).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPricingJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Validates explicit owner-entered terms; contains no commercial rate defaults. */
export function validatePricingProposal(raw, now = Date.now()) {
  if (
    !keys(raw, ["version", "registry"]) ||
    !object(raw.version) ||
    !Array.isArray(raw.registry) ||
    raw.registry.length < 1 ||
    raw.registry.length > 256
  )
    fail("proposal_invalid");
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 131072) fail("proposal_too_large");
  const v = raw.version;
  if (
    !keys(v, [
      "version",
      "currency",
      "margin_floor",
      "risk_buffer_percentage",
      "minimum_request_charge",
      "rounding_increment",
      "allowance_configuration",
      "public_price_configuration",
      "effective_at",
      "expires_at",
    ]) ||
    !Number.isSafeInteger(v.version) ||
    v.version < 1 ||
    v.version > 2147483647 ||
    !/^[A-Z]{3}$/.test(v.currency ?? "") ||
    !number(v.margin_floor, 1) ||
    Math.round(v.margin_floor * 1e5) / 1e5 !== v.margin_floor ||
    v.margin_floor < 0.5 ||
    v.margin_floor >= 1 ||
    !number(v.risk_buffer_percentage, 1) ||
    Math.round(v.risk_buffer_percentage * 1e5) / 1e5 !== v.risk_buffer_percentage ||
    !number(v.minimum_request_charge) ||
    v.minimum_request_charge < 1e-8 ||
    !number(v.rounding_increment) ||
    v.rounding_increment < 1e-8
  )
    fail("version_invalid");
  const effective = Date.parse(v.effective_at),
    expires = Date.parse(v.expires_at);
  if (
    !Number.isFinite(effective) ||
    !Number.isFinite(expires) ||
    expires <= Math.max(now, effective) ||
    expires - now > 90 * 86400000
  )
    fail("expiry_invalid");
  const a = v.allowance_configuration;
  if (
    !keys(a, ["fixed", "percentages", "collectionPercentage", "collectionFixed"]) ||
    !object(a.fixed) ||
    !object(a.percentages) ||
    [a.fixed, a.percentages].some(
      (group) =>
        Object.keys(group).length > 32 ||
        Object.entries(group).some(
          ([key, value]) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) || !number(value),
        ),
    ) ||
    !number(a.collectionPercentage, 1) ||
    a.collectionPercentage + v.margin_floor >= 1 ||
    !number(a.collectionFixed)
  )
    fail("allowances_invalid");
  if (
    !keys(v.public_price_configuration, ["contracts"]) ||
    !Array.isArray(v.public_price_configuration.contracts) ||
    v.public_price_configuration.contracts.length < 1 ||
    v.public_price_configuration.contracts.length > 64
  )
    fail("contracts_invalid");
  const seen = new Set(),
    registryKeys = new Set();
  for (const row of raw.registry) {
    if (
      !keys(row, [
        "provider",
        "upstream_model",
        "billing_dimension",
        "unit",
        "unit_quantity",
        "unit_price",
        "currency",
        "source",
        "effective_at",
        "expires_at",
        "evidence",
      ]) ||
      !["azure_openai", "openai"].includes(row.provider) ||
      !text(row.upstream_model) ||
      !text(row.billing_dimension, 80) ||
      !text(row.unit, 80) ||
      !number(row.unit_quantity) ||
      row.unit_quantity <= 0 ||
      !number(row.unit_price) ||
      row.currency !== v.currency ||
      !text(row.source, 500) ||
      !Number.isFinite(Date.parse(row.effective_at)) ||
      Date.parse(row.effective_at) > effective ||
      !Number.isFinite(Date.parse(row.expires_at)) ||
      Date.parse(row.expires_at) < expires
    )
      fail("registry_invalid");
    const evidence = row.evidence;
    if (
      !keys(evidence, ["reference", "sha256", "verifiedAt"]) ||
      !text(evidence.reference, 500) ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "") ||
      !Number.isFinite(Date.parse(evidence.verifiedAt)) ||
      Date.parse(evidence.verifiedAt) > now ||
      Date.parse(evidence.verifiedAt) < now - 90 * 86400000
    )
      fail("evidence_required");
    const key = [row.provider, row.upstream_model, row.billing_dimension].join("\0");
    if (registryKeys.has(key)) fail("registry_duplicate");
    registryKeys.add(key);
  }
  const proofVersion = {
    ...v,
    id: "review-preview",
    status: "approved",
    approved_by: "review-preview",
    approved_at: new Date(now).toISOString(),
  };
  const registry = raw.registry.map((row, i) => ({
    ...row,
    id: `preview-${i}`,
    active: true,
    verification_status: "approved",
  }));
  const quotes = [];
  for (const c of v.public_price_configuration.contracts) {
    if (
      !keys(c, [
        "provider",
        "upstreamModel",
        "publicModel",
        "capability",
        "meter",
        "maximumUsage",
        "maximumRequestBytes",
        "expectedResponseModels",
        "maximumImages",
        "allowedSizes",
        "allowedQualities",
      ]) ||
      !["azure_openai", "openai"].includes(c.provider) ||
      !text(c.upstreamModel) ||
      !text(c.publicModel) ||
      !text(c.capability, 80) ||
      !meters[c.meter]
    )
      fail("contract_invalid");
    const key = [c.provider, c.publicModel, c.capability].join("\0");
    const upstreamKey = [c.provider, c.upstreamModel, c.capability].join("\0");
    if (seen.has(key) || seen.has(`upstream:${upstreamKey}`)) fail("contract_duplicate");
    seen.add(key);
    seen.add(`upstream:${upstreamKey}`);
    if (
      c.meter === "image_tokens" &&
      (!Array.isArray(c.allowedSizes) ||
        !c.allowedSizes.length ||
        c.allowedSizes.length > 16 ||
        c.allowedSizes.some((x) => !["auto", "1024x1024", "1024x1536", "1536x1024"].includes(x)) ||
        !Array.isArray(c.allowedQualities) ||
        !c.allowedQualities.length ||
        c.allowedQualities.some((x) => !["auto", "low", "medium", "high"].includes(x)))
    )
      fail("image_bounds_invalid");
    const body = { model: c.upstreamModel, input: "" };
    if (c.meter === "responses_tokens") body.max_output_tokens = 1;
    if (c.meter === "image_tokens")
      Object.assign(body, { n: 1, size: c.allowedSizes[0], quality: c.allowedQualities[0] });
    try {
      const prepared = prepareDeveloperQuote(
        { version: proofVersion, registry },
        { provider: c.provider, capability: c.capability, body },
        new Date(Math.max(now, effective)),
      );
      quotes.push({
        publicModel: c.publicModel,
        capability: c.capability,
        maximumReservedCharge: prepared.quote.maximumReservedCharge,
        currency: v.currency,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "quote_invalid");
    }
  }
  const usedKeys = new Set(
    v.public_price_configuration.contracts.flatMap((c) =>
      meters[c.meter].map((dimension) => [c.provider, c.upstreamModel, dimension].join("\0")),
    ),
  );
  if (registryKeys.size !== usedKeys.size || [...registryKeys].some((key) => !usedKeys.has(key)))
    fail("registry_scope_invalid");
  return { proposal: structuredClone(raw), canonical: canonicalPricingJson(raw), quotes };
}

/** A reviewed version never inherits rates from a later, unrelated approval. */
export function pricingRegistryIds(version) {
  const ids = version?.public_price_configuration?.registryIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 256 ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id),
    )
  )
    fail("registry_binding_required");
  return ids;
}

export function validateCreditOfferProposal(raw, now = Date.now()) {
  if (
    !keys(raw, [
      "name",
      "environment",
      "stripe_price_id",
      "currency",
      "subtotal_amount",
      "credits_amount",
      "refund_reserve",
      "dispute_reserve",
      "maximum_processor_fee",
      "tax_mode",
      "tax_review_reference",
      "expires_at",
    ]) ||
    !text(raw.name, 80) ||
    !["sandbox", "live"].includes(raw.environment) ||
    !/^price_[A-Za-z0-9]+$/.test(raw.stripe_price_id ?? "") ||
    !/^[A-Z]{3}$/.test(raw.currency ?? "") ||
    !["automatic", "reviewed_exempt"].includes(raw.tax_mode) ||
    !text(raw.tax_review_reference, 500)
  )
    fail("credit_offer_invalid");
  const amounts = [
    raw.subtotal_amount,
    raw.credits_amount,
    raw.refund_reserve,
    raw.dispute_reserve,
    raw.maximum_processor_fee,
  ];
  if (
    amounts.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 100000000) ||
    raw.subtotal_amount < 1 ||
    raw.credits_amount < 1 ||
    amounts.some((amount) => amount > raw.subtotal_amount)
  )
    fail("credit_offer_budget_invalid");
  const expiry = Date.parse(raw.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 90 * 86400000)
    fail("expiry_invalid");
  return { proposal: structuredClone(raw), canonical: canonicalPricingJson(raw), quotes: [] };
}

export function verifyCreditOfferPrice(
  proposal,
  price,
  registrations = [],
  taxSettings = null,
  account = null,
) {
  const live = proposal.environment === "live";
  if (account?.default_currency?.toUpperCase() !== proposal.currency)
    fail("settlement_currency_unsupported");
  if (
    !price ||
    price.id !== proposal.stripe_price_id ||
    price.livemode !== live ||
    price.active !== true ||
    price.type !== "one_time" ||
    price.recurring ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity ||
    price.custom_unit_amount ||
    price.currency?.toUpperCase() !== proposal.currency ||
    price.unit_amount !== proposal.subtotal_amount ||
    !object(price.product) ||
    price.product.deleted ||
    price.product.active !== true ||
    price.product.livemode !== live
  )
    fail("stripe_price_mismatch");
  if (
    proposal.tax_mode === "automatic" &&
    (price.tax_behavior !== "exclusive" ||
      !price.product.tax_code ||
      taxSettings?.status !== "active" ||
      taxSettings?.livemode !== live ||
      !registrations.some(
        (r) =>
          r.status === "active" &&
          r.livemode === live &&
          r.active_from * 1000 <= Date.now() &&
          (!r.expires_at || r.expires_at * 1000 > Date.now()),
      ))
  )
    fail("tax_readiness_required");
}
