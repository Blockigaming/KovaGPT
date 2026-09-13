import { quoteRequest, reconcileCharge, PricingUnavailableError } from "./cost-plus.mjs";

const fail = (code) => {
  throw new PricingUnavailableError(code);
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const finite = (value, maximum = 1e9) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
const integer = (value) => finite(value, 1e7) && Number.isSafeInteger(value);
const dimensionsByMeter = {
  responses_tokens: ["input_tokens", "cached_input_tokens", "output_tokens"],
  embedding_tokens: ["input_tokens"],
  image_tokens: ["input_tokens", "image_input_tokens", "output_tokens"],
};

/** Only source-controlled meter names and owner-approved bounds are accepted. */
export function prepareDeveloperQuote(config, request, at = new Date()) {
  const { version, registry } = config;
  if (
    !object(version) ||
    version.status !== "approved" ||
    !version.approved_by ||
    !version.approved_at ||
    !(Date.parse(version.effective_at) <= +at) ||
    !(Date.parse(version.expires_at) > +at)
  )
    fail("pricing_version_unapproved");
  const contracts = version.public_price_configuration?.contracts;
  const contract =
    Array.isArray(contracts) &&
    contracts.find(
      (row) =>
        row.provider === request.provider &&
        row.upstreamModel === request.body.model &&
        row.capability === request.capability,
    );
  if (!contract || !dimensionsByMeter[contract.meter] || !object(contract.maximumUsage))
    fail("billing_contract_missing");
  const dimensions = dimensionsByMeter[contract.meter];
  if (
    Object.keys(contract.maximumUsage).sort().join() !== [...dimensions].sort().join() ||
    dimensions.some((key) => !integer(contract.maximumUsage[key])) ||
    !finite(contract.maximumRequestBytes, 1048576) ||
    contract.maximumRequestBytes < 1
  )
    fail("billing_contract_invalid");
  if (
    new TextEncoder().encode(JSON.stringify(request.body)).byteLength > contract.maximumRequestBytes
  )
    fail("billing_request_too_large");
  if (
    contract.meter !== "image_tokens" &&
    (!Array.isArray(contract.expectedResponseModels) ||
      !contract.expectedResponseModels.length ||
      contract.expectedResponseModels.some(
        (model) => typeof model !== "string" || !model || model.length > 200,
      ))
  )
    fail("billing_model_identity_missing");
  if (
    new TextEncoder().encode(JSON.stringify(request.body)).byteLength >
    contract.maximumUsage.input_tokens
  )
    fail("billing_input_bound_exceeded");
  if (
    contract.meter === "image_tokens" &&
    (!integer(contract.maximumImages) ||
      contract.maximumImages < 1 ||
      !integer(request.body.n ?? 1) ||
      (request.body.n ?? 1) < 1 ||
      (request.body.n ?? 1) > contract.maximumImages ||
      !Array.isArray(contract.allowedSizes) ||
      !contract.allowedSizes.includes(request.body.size ?? "auto") ||
      !Array.isArray(contract.allowedQualities) ||
      !contract.allowedQualities.includes(request.body.quality ?? "auto"))
  )
    fail("billing_image_bound_missing");
  if (contract.meter === "responses_tokens") {
    if (
      !["chat", "streaming", "reasoning", "tool_calls", "vision", "file_analysis"].includes(
        request.capability,
      ) ||
      !integer(request.body.max_output_tokens) ||
      request.body.max_output_tokens < 1 ||
      request.body.max_output_tokens > contract.maximumUsage.output_tokens
    )
      fail("billing_output_unbounded");
    // Hosted tools and media have additional charges; no token-only guess is accepted.
    if (
      request.body.tools?.some((tool) => tool.type !== "function") ||
      /"type"\s*:\s*"(?:input_image|input_file|input_audio)"/.test(
        JSON.stringify(request.body.input),
      )
    )
      fail("billing_dimensions_unsupported");
  } else if (contract.meter === "embedding_tokens" && request.capability !== "embeddings")
    fail("billing_contract_invalid");
  else if (contract.meter === "image_tokens" && request.capability !== "image_generation")
    fail("billing_contract_invalid");
  if (
    !object(version.allowance_configuration) ||
    !object(version.allowance_configuration.fixed) ||
    !object(version.allowance_configuration.percentages)
  )
    fail("billing_allowances_missing");
  const allowanceValues = [
    ...Object.values(version.allowance_configuration.fixed),
    ...Object.values(version.allowance_configuration.percentages),
    version.allowance_configuration.collectionPercentage,
    version.allowance_configuration.collectionFixed,
  ];
  if (
    allowanceValues.some((value) => !finite(value)) ||
    !finite(version.margin_floor, 1) ||
    version.margin_floor < 0.5 ||
    version.margin_floor >= 1 ||
    !finite(version.risk_buffer_percentage, 1) ||
    !finite(version.minimum_request_charge) ||
    version.minimum_request_charge < 0.00000001 ||
    !finite(version.rounding_increment) ||
    version.rounding_increment < 0.00000001
  )
    fail("billing_allowances_invalid");
  const records = registry
    .map((row) => ({
      id: row.id,
      provider: row.provider,
      upstreamModel: row.upstream_model,
      billingDimension: row.billing_dimension,
      unitQuantity: Number(row.unit_quantity),
      unitPrice: Number(row.unit_price),
      currency: row.currency,
      verificationStatus: row.verification_status,
      effectiveAt: row.effective_at,
      expiresAt: row.expires_at,
      active: row.active,
    }))
    .filter(
      (row) =>
        finite(row.unitPrice) &&
        finite(row.unitQuantity) &&
        row.unitQuantity > 0 &&
        Date.parse(row.effectiveAt) <= +at &&
        Date.parse(row.expiresAt) > +at,
    );
  for (const key of dimensions) {
    if (
      !records.some(
        (row) =>
          row.billingDimension === key &&
          row.provider === request.provider &&
          row.upstreamModel === request.body.model &&
          row.currency === version.currency &&
          row.active &&
          row.verificationStatus === "approved" &&
          Date.parse(row.effectiveAt) <= +at &&
          Date.parse(row.expiresAt) > +at &&
          finite(row.unitPrice) &&
          finite(row.unitQuantity) &&
          row.unitQuantity > 0,
      )
    )
      fail("upstream_price_missing");
  }
  const options = {
    registry: records,
    provider: request.provider,
    upstreamModel: request.body.model,
    currency: version.currency,
    usage: { capability: request.capability, dimensions: contract.maximumUsage },
    allowances: version.allowance_configuration,
    pricingVersion: { id: version.id, status: version.status, marginFloor: version.margin_floor },
    publicPrice: { model: contract.publicModel, meter: contract.meter },
    riskBufferPercentage: version.risk_buffer_percentage,
    minimumRequestCharge: version.minimum_request_charge,
    roundingIncrement: version.rounding_increment,
    at,
  };
  const quote = quoteRequest(options);
  if (!finite(quote.maximumReservedCharge) || quote.maximumReservedCharge <= 0)
    fail("billing_quote_invalid");
  return {
    quote: { ...quote, acceptedPricing: { ...options, at: at.toISOString() } },
    options,
    contract,
  };
}

export function authoritativeUsage(value, meter, fallbackId, expectedModels) {
  const response = value?.response ?? value;
  if (!object(response?.usage) || (expectedModels && !expectedModels.includes(response.model)))
    return null;
  const usage = response.usage;
  let dimensions;
  if (meter === "responses_tokens") {
    if (!["completed", "incomplete"].includes(response.status)) return null;
    const cached = usage.input_tokens_details?.cached_tokens;
    if (
      ![usage.input_tokens, cached, usage.output_tokens].every(integer) ||
      cached > usage.input_tokens
    )
      return null;
    dimensions = {
      input_tokens: usage.input_tokens - cached,
      cached_input_tokens: cached,
      output_tokens: usage.output_tokens,
    };
  } else if (meter === "embedding_tokens") {
    if (!integer(usage.prompt_tokens)) return null;
    dimensions = { input_tokens: usage.prompt_tokens };
  } else if (meter === "image_tokens") {
    if (
      usage.output_tokens_details &&
      (usage.output_tokens_details.text_tokens !== 0 ||
        usage.output_tokens_details.image_tokens !== usage.output_tokens)
    )
      return null;
    const text = usage.input_tokens_details?.text_tokens;
    const images = usage.input_tokens_details?.image_tokens;
    if (
      ![text, images, usage.input_tokens, usage.output_tokens].every(integer) ||
      text + images !== usage.input_tokens
    )
      return null;
    dimensions = {
      input_tokens: text,
      image_input_tokens: images,
      output_tokens: usage.output_tokens,
    };
  } else return null;
  const providerResponseId = response.id ?? fallbackId;
  if (
    typeof providerResponseId !== "string" ||
    !providerResponseId ||
    providerResponseId.length > 200
  )
    return null;
  return { dimensions, providerResponseId };
}

export function settleDeveloperQuote(prepared, actual) {
  // Use the accepted immutable rates, even if current prices are revoked/expired later.
  const finalQuote = quoteRequest({
    ...prepared.options,
    usage: { ...prepared.options.usage, dimensions: actual.dimensions },
  });
  const customerCharge = Math.min(prepared.quote.maximumReservedCharge, finalQuote.customerCharge);
  const allowances = prepared.options.allowances;
  const costBreakdown = { ...allowances.fixed };
  for (const [key, percentage] of Object.entries(allowances.percentages))
    costBreakdown[key] = (costBreakdown[key] ?? 0) + finalQuote.estimatedUpstreamCost * percentage;
  costBreakdown.payment_processing =
    (costBreakdown.payment_processing ?? 0) +
    allowances.collectionFixed +
    customerCharge * allowances.collectionPercentage;
  const result = reconcileCharge({
    quote: { ...prepared.quote, customerCharge },
    actualUpstreamCost: finalQuote.estimatedUpstreamCost,
    actualAllowances: costBreakdown,
  });
  return {
    ...result,
    usage: actual.dimensions,
    providerResponseId: actual.providerResponseId,
    costBreakdown: { ...costBreakdown, upstream: finalQuote.estimatedUpstreamCost },
  };
}

/** Retain only top-level accounting fields; image bytes and model output are never buffered. */
export function createUsageCollector() {
  const selected = new Set(["usage", "id", "status", "model"]);
  let depth = 0,
    inString = false,
    escaped = false,
    stage = "key",
    key = "",
    token = "",
    started = false,
    ended = false,
    bad = false;
  const values = {};
  const finish = () => {
    if (selected.has(key)) {
      try {
        values[key] = JSON.parse(token);
      } catch {
        bad = true;
      }
    }
    token = "";
    key = "";
  };
  return {
    push(text) {
      for (const character of text) {
        if (bad) return;
        if (!started) {
          if (/\s/.test(character)) continue;
          if (character !== "{") {
            bad = true;
            return;
          }
          started = true;
          depth = 1;
          continue;
        }
        if (ended) {
          if (!/\s/.test(character)) bad = true;
          continue;
        }
        if (!inString && depth === 1 && stage === "key") {
          if (/\s/.test(character) || character === ",") continue;
          if (character === "}") {
            ended = true;
            depth = 0;
            continue;
          }
          if (character !== '"') {
            bad = true;
            return;
          }
          token = '"';
          inString = true;
          stage = "key_string";
          continue;
        }
        if (stage === "key_string") {
          token += character;
          if (token.length > 1024) {
            bad = true;
            return;
          }
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') {
            try {
              key = JSON.parse(token);
            } catch {
              bad = true;
            }
            token = "";
            inString = false;
            stage = "colon";
          }
          continue;
        }
        if (stage === "colon") {
          if (/\s/.test(character)) continue;
          if (character !== ":") {
            bad = true;
            return;
          }
          stage = "value";
          continue;
        }
        if (!inString && depth === 1 && (character === "," || character === "}")) {
          finish();
          stage = "key";
          if (character === "}") {
            ended = true;
            depth = 0;
          }
          continue;
        }
        if (selected.has(key)) {
          token += character;
          if (token.length > 16384) {
            bad = true;
            return;
          }
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
        } else if (character === '"') inString = true;
        else if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") depth--;
        if (depth < 1 || depth > 100) bad = true;
      }
    },
    value() {
      return !bad && ended && !inString && depth === 0 ? values : null;
    },
  };
}

/** DB and fetch are injectable for executable transport fault tests. No body/pricing comes from HTTP clients. */
export async function runMeteredProvider({ prepared, admit, dispatch, finish, send, signal }) {
  signal?.throwIfAborted();
  const admission = await admit();
  if (admission.decision !== "admitted") fail("developer_request_already_admitted");
  let dispatchAttempted = false,
    dispatched = false,
    terminal,
    actual = null;
  const finalize = (outcome, result) => (terminal ??= finish(admission, outcome, result));
  try {
    signal?.throwIfAborted();
    dispatchAttempted = true;
    dispatched = await dispatch(admission);
    if (!dispatched) {
      dispatchAttempted = false;
      fail("developer_dispatch_refused");
    }
    signal?.throwIfAborted();
    const response = await send();
    if (!response.ok || !response.body) {
      await finalize("uncertain");
      return response;
    }
    const fallbackId =
      response.headers.get("x-request-id") || response.headers.get("apim-request-id");
    const reader = response.body.getReader(),
      decoder = new TextDecoder(),
      collector = createUsageCollector();
    const streaming = response.headers.get("content-type")?.includes("text/event-stream");
    let pending = "",
      overflow = false;
    const observe = (text) => {
      if (!streaming) {
        collector.push(text);
        return;
      }
      pending += text;
      pending = pending.replace(/\r\n/g, "\n");
      if (pending.length > 1048576) {
        overflow = true;
        pending = "";
        return;
      }
      let end;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!overflow && data && data !== "[DONE]") {
          try {
            const event = JSON.parse(data);
            if (["response.completed", "response.incomplete"].includes(event.type))
              actual = authoritativeUsage(
                event,
                prepared.contract.meter,
                fallbackId,
                prepared.contract.expectedResponseModels,
              );
          } catch {
            overflow = true;
          }
        }
      }
    };
    const complete = async () => {
      if (!streaming && !actual)
        actual = authoritativeUsage(
          collector.value(),
          prepared.contract.meter,
          fallbackId,
          prepared.contract.expectedResponseModels,
        );
      if (actual) await finalize("settled", settleDeveloperQuote(prepared, actual));
      else await finalize("uncertain");
    };
    const abort = () => {
      void reader.cancel(signal?.reason).catch(() => {});
      void complete().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              observe(decoder.decode());
              if (!streaming)
                actual = authoritativeUsage(
                  collector.value(),
                  prepared.contract.meter,
                  fallbackId,
                  prepared.contract.expectedResponseModels,
                );
              await complete();
              cleanup();
              controller.close();
              return;
            }
            observe(decoder.decode(next.value, { stream: true }));
            controller.enqueue(next.value);
          } catch (error) {
            cleanup();
            await reader.cancel(error).catch(() => {});
            await complete().catch(() => {});
            controller.error(error);
          }
        },
        async cancel(reason) {
          cleanup();
          await reader.cancel(reason).catch(() => {});
          await complete();
        },
      }),
      { status: response.status, statusText: response.statusText, headers: response.headers },
    );
  } catch (error) {
    await finalize(dispatchAttempted || dispatched ? "uncertain" : "released").catch(() => {});
    throw error;
  }
}
