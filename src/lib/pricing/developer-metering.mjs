import { quoteRequest, reconcileCharge, PricingUnavailableError } from "./cost-plus.mjs";
import { developerInlineImage } from "./developer-responses-policy.mjs";
import { developerImageEditValue } from "./developer-image-edit-policy.mjs";
import { developerSearchOptions } from "./developer-search-policy.mjs";
import { validModerationRequest, validModerationResult } from "./developer-moderation-policy.mjs";
import {
  validDeveloperDecisionRequest,
  developerDecisionUsage,
} from "./developer-decisions-policy.mjs";
import {
  analysisContainerReceipt,
  validDeveloperAnalysisRequest,
} from "./developer-analysis-policy.mjs";
import { validDeveloperComputerRequest } from "./developer-computer-policy.mjs";

const fail = (code) => {
  throw new PricingUnavailableError(code);
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const finite = (value, maximum = 1e9) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
const integer = (value) => finite(value, 1e7) && Number.isSafeInteger(value);
const dimensionsByMeter = {
  responses_tokens: ["input_tokens", "cached_input_tokens", "output_tokens"],
  responses_computer: ["input_tokens", "cached_input_tokens", "output_tokens"],
  responses_search: ["input_tokens", "cached_input_tokens", "output_tokens", "web_search_calls"],
  responses_analysis: [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "container_1g_sessions",
  ],
  embedding_tokens: ["input_tokens"],
  decisions_tokens: ["decision_input_tokens"],
  moderation_requests: ["moderation_requests"],
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
  const imageEdit = request.body.image !== undefined;
  const editTokens = contract.maximumImageEditInputTokens;
  if (
    request.body.mask !== undefined ||
    (editTokens !== undefined &&
      (contract.meter !== "image_tokens" ||
        request.provider !== "openai" ||
        !integer(editTokens) ||
        editTokens < 1 ||
        editTokens > contract.maximumUsage.image_input_tokens)) ||
    (imageEdit && !editTokens)
  )
    fail("billing_image_edit_contract_invalid");
  if (imageEdit) {
    try {
      developerImageEditValue(request.body.image);
    } catch {
      fail("billing_image_edit_contract_invalid");
    }
  }
  const dimensions = dimensionsByMeter[contract.meter];
  const moderationMeter = contract.meter === "moderation_requests";
  const decisionsMeter = contract.meter === "decisions_tokens";
  const searchMeter = contract.meter === "responses_search";
  const analysisMeter = contract.meter === "responses_analysis";
  const computerMeter = contract.meter === "responses_computer";
  const responsesMeter =
    searchMeter || analysisMeter || computerMeter || contract.meter === "responses_tokens";
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
  const textBody = { ...request.body };
  if (imageEdit) delete textBody.image;
  if (
    !moderationMeter &&
    new TextEncoder().encode(JSON.stringify(textBody)).byteLength >
      (decisionsMeter
        ? contract.maximumUsage.decision_input_tokens
        : contract.maximumUsage.input_tokens)
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
  if (
    moderationMeter !== (request.capability === "moderation") ||
    (moderationMeter &&
      (request.provider !== "openai" ||
        contract.maximumUsage.moderation_requests !== 1 ||
        !validModerationRequest(request.body)))
  )
    fail("billing_moderation_contract_invalid");
  if (
    decisionsMeter !== (request.capability === "decisions") ||
    (decisionsMeter &&
      (request.provider !== "openai" || !validDeveloperDecisionRequest(request.body)))
  )
    fail("billing_decision_contract_invalid");
  if (
    analysisMeter !== (request.capability === "file_analysis") ||
    (analysisMeter &&
      (request.provider !== "openai" ||
        contract.maximumUsage.container_1g_sessions !== 1 ||
        !integer(contract.maximumAnalysisInputTokens) ||
        contract.maximumAnalysisInputTokens < 1 ||
        new TextEncoder().encode(JSON.stringify(request.body)).byteLength +
          contract.maximumAnalysisInputTokens >
          contract.maximumUsage.input_tokens ||
        !validDeveloperAnalysisRequest(request.body))) ||
    (!analysisMeter && contract.maximumAnalysisInputTokens !== undefined)
  )
    fail("billing_analysis_contract_invalid");
  if (
    computerMeter !== (request.capability === "computer_use") ||
    (computerMeter &&
      (request.provider !== "openai" ||
        !integer(contract.maximumComputerInputTokens) ||
        contract.maximumComputerInputTokens < 1 ||
        !integer(contract.maximumInlineImageTokens) ||
        contract.maximumInlineImageTokens < 1 ||
        !validDeveloperComputerRequest(request.body))) ||
    (!computerMeter && contract.maximumComputerInputTokens !== undefined)
  )
    fail("billing_computer_contract_invalid");
  let search;
  try {
    search = analysisMeter ? null : developerSearchOptions(request.body);
  } catch {
    fail("billing_dimensions_unsupported");
  }
  if (search && !searchMeter) fail("billing_dimensions_unsupported");
  if (
    searchMeter &&
    (request.provider !== "openai" ||
      request.capability !== "chat" ||
      request.body.stream === true ||
      contract.searchContentAccounting !== "included_in_input_tokens" ||
      !integer(contract.maximumWebSearchInputTokens) ||
      contract.maximumWebSearchInputTokens < 1 ||
      contract.maximumWebSearchInputTokens > contract.maximumUsage.input_tokens ||
      contract.maximumUsage.web_search_calls < 1 ||
      contract.maximumUsage.web_search_calls > 3 ||
      /^gpt-(?:4o-mini|4\.1-mini)(?:-|$)/.test(request.body.model))
  )
    fail("billing_search_contract_invalid");
  if (
    !searchMeter &&
    (contract.maximumWebSearchInputTokens !== undefined ||
      contract.searchContentAccounting !== undefined)
  )
    fail("billing_search_contract_invalid");
  if (search) {
    const bytes = new TextEncoder().encode(JSON.stringify(request.body)).byteLength;
    if (
      search.max_tool_calls > contract.maximumUsage.web_search_calls ||
      bytes + contract.maximumWebSearchInputTokens > contract.maximumUsage.input_tokens
    )
      fail("billing_search_bound_exceeded");
  }
  const inlineImageTokens = contract.maximumInlineImageTokens;
  if (
    inlineImageTokens !== undefined &&
    ((contract.meter !== "responses_tokens" && !computerMeter) ||
      !integer(inlineImageTokens) ||
      inlineImageTokens < 1 ||
      inlineImageTokens > contract.maximumUsage.input_tokens)
  )
    fail("billing_vision_contract_invalid");
  const allowedEfforts = contract.allowedReasoningEfforts;
  if (
    allowedEfforts !== undefined &&
    (!responsesMeter ||
      !Array.isArray(allowedEfforts) ||
      !allowedEfforts.length ||
      new Set(allowedEfforts).size !== allowedEfforts.length ||
      allowedEfforts.some(
        (effort) => !["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort),
      ))
  )
    fail("billing_reasoning_contract_invalid");
  if (request.body.reasoning !== undefined) {
    const reasoning = request.body.reasoning;
    if (
      !object(reasoning) ||
      Object.keys(reasoning).length !== 1 ||
      !Array.isArray(allowedEfforts) ||
      !allowedEfforts.includes(reasoning.effort)
    )
      fail("billing_reasoning_effort_unapproved");
  }
  if (responsesMeter) {
    if (
      !["chat", "streaming", "reasoning", "tool_calls", "vision", "file_analysis", "computer_use"].includes(
        request.capability,
      ) ||
      !integer(request.body.max_output_tokens) ||
      request.body.max_output_tokens < 1 ||
      request.body.max_output_tokens > contract.maximumUsage.output_tokens
    )
      fail("billing_output_unbounded");
    // Inline images and web search require their separately approved contracts.
    // Other hosted tools and media remain fail-closed.
    const images = Array.isArray(request.body.input)
      ? request.body.input.flatMap((item) =>
          Array.isArray(item?.content)
            ? item.content.filter((part) => part?.type === "input_image")
            : [],
        )
      : [];
    const encodedInput = JSON.stringify(request.body.input);
    const imageMarkers = encodedInput?.match(/"type"\s*:\s*"input_image"/g)?.length ?? 0;
    if (
      (!search && !analysisMeter && !computerMeter && request.body.tools?.some((tool) => tool.type !== "function")) ||
      /"type"\s*:\s*"(?:input_file|input_audio)"/.test(encodedInput) ||
      imageMarkers !== images.length ||
      images.length > 1
    )
      fail("billing_dimensions_unsupported");
    if (images.length) {
      if (!inlineImageTokens) fail("billing_dimensions_unsupported");
      try {
        developerInlineImage(images[0]);
      } catch {
        fail("billing_dimensions_unsupported");
      }
      const requestBytes = new TextEncoder().encode(JSON.stringify(request.body)).byteLength;
      if (
        requestBytes + inlineImageTokens + (computerMeter ? contract.maximumComputerInputTokens : 0) >
        contract.maximumUsage.input_tokens
      )
        fail("billing_input_bound_exceeded");
    }
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
    usage: {
      capability: request.capability,
      dimensions: searchMeter
        ? { ...contract.maximumUsage, web_search_calls: search?.max_tool_calls ?? 0 }
        : contract.maximumUsage,
    },
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
    imageEdit,
  };
}

export function authoritativeUsage(value, meter, fallbackId, expectedModels) {
  const response = value?.response ?? value;
  if (!object(response) || (expectedModels && !expectedModels.includes(response.model)))
    return null;
  if (meter !== "moderation_requests" && !object(response.usage)) return null;
  const usage = response.usage;
  let dimensions;
  if (["responses_tokens", "responses_search", "responses_analysis", "responses_computer"].includes(meter)) {
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
    if (meter === "responses_analysis") {
      if (!analysisContainerReceipt(response.output)) return null;
      dimensions.container_1g_sessions = 1;
    }
    if (meter === "responses_search") {
      if (!Array.isArray(response.output) || response.output.length > 256) return null;
      const ids = new Set();
      for (const item of response.output) {
        if (!object(item)) return null;
        if (item.type === "web_search_call") {
          if (
            typeof item.id !== "string" ||
            !/^ws_[A-Za-z0-9_-]{1,180}$/.test(item.id) ||
            ids.has(item.id) ||
            item.status !== "completed"
          )
            return null;
          ids.add(item.id);
        } else if (!["message", "reasoning", "function_call"].includes(item.type)) return null;
      }
      dimensions.web_search_calls = ids.size;
    }
  } else if (meter === "moderation_requests") {
    if (!validModerationResult(response)) return null;
    dimensions = { moderation_requests: 1 };
  } else if (meter === "decisions_tokens") {
    dimensions = developerDecisionUsage(usage);
    if (!dimensions) return null;
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

/** Retain accounting fields. Only the search meter temporarily collects bounded output metadata. */
export function createUsageCollector(includeOutput = false, includeResults = false) {
  const selected = new Set(["usage", "id", "status", "model"]);
  if (includeOutput) selected.add("output");
  if (includeResults) selected.add("results");
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
          if (token.length > (key === "output" ? 1048576 : 16384)) {
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
      collector = createUsageCollector(
        ["responses_search", "responses_analysis"].includes(prepared.contract.meter),
        prepared.contract.meter === "moderation_requests",
      );
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
      const requestedSearch =
        prepared.contract.meter === "responses_search" &&
        prepared.options.usage.dimensions.web_search_calls > 0;
      if (requestedSearch && actual?.dimensions.web_search_calls === 0) actual = null;
      if (prepared.imageEdit && actual?.dimensions.image_input_tokens === 0) actual = null;
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
