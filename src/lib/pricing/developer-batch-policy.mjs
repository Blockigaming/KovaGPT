import { normalizeDeveloperOperation } from "./developer-api-aliases.mjs";
import { parseDeveloperAgentTurn } from "./developer-agent-policy.mjs";
import { parseDeveloperInput } from "./developer-platform-policy.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_batch_invalid");
};
function exact(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value.toLowerCase();
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > max
  )
    fail();
  return value;
}
export function batchChargeTicks(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1000000) fail();
  // Round the accepted per-item maximum upwards, not downwards.
  return Math.ceil(value * 100000000);
}
export function batchBudgetTicks(value) {
  const ticks = batchChargeTicks(value);
  const rounded = Math.round(value * 100000000);
  if (Math.abs(value * 100000000 - rounded) > 0.00001 || !Number.isSafeInteger(rounded)) fail();
  if (ticks < rounded || rounded < 1) fail();
  return rounded;
}
const batchCapabilities = Object.freeze({
  "chat/completions": "chat",
  "agent-turns": "chat",
  responses: "chat",
  moderations: "moderation",
  embeddings: "embeddings",
  decisions: "decisions",
  search: "chat",
  analysis: "file_analysis",
});
export function developerBatchCapability(operation) {
  if (typeof operation !== "string" || !Object.hasOwn(batchCapabilities, operation)) fail();
  return batchCapabilities[operation];
}
function directInput(operation, value) {
  if (operation === "responses") {
    exact(
      value,
      ["model", "input", "max_output_tokens"],
      [
        "instructions",
        "stream",
        "reasoning",
        "text",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
      ],
    );
    // Native function proposals and strict structured output are supported, not
    // hosted execution, file references or vision. Keep queued history bounded.
    if (
      (typeof value.input !== "string" &&
        (!Array.isArray(value.input) ||
          value.input.length < 1 ||
          value.input.length > 16 ||
          value.input.some(
            (item) =>
              Array.isArray(item?.content) &&
              item.content.some((part) => part?.type === "input_image"),
          ))) ||
      (value.tools !== undefined &&
        (!Array.isArray(value.tools) ||
          value.tools.length < 1 ||
          value.tools.length > 4 ||
          value.tools.some((tool) => tool?.type !== "function"))) ||
      value.max_output_tokens > 2048 ||
      (value.stream !== undefined && value.stream !== false)
    )
      fail();
  } else if (operation === "embeddings") {
    exact(value, ["model", "input", "dimensions"]);
    if (
      !Number.isSafeInteger(value.dimensions) ||
      value.dimensions < 1 ||
      value.dimensions > 1024 ||
      (Array.isArray(value.input) && value.input.length > 2)
    )
      fail();
  } else if (operation === "moderations") {
    exact(value, ["model", "input"]);
  } else if (operation === "decisions") {
    exact(value, ["model", "input", "questions"]);
  } else if (operation === "search") {
    exact(value, ["model", "query", "max_output_tokens", "max_tool_calls"]);
    if (
      !Number.isSafeInteger(value.max_output_tokens) ||
      value.max_output_tokens < 1 ||
      value.max_output_tokens > 2048
    )
      fail();
  } else if (operation === "analysis") {
    exact(value, ["model", "input", "max_output_tokens"]);
  } else fail();
  const normalized = normalizeDeveloperOperation(operation, value);
  const parsed = parseDeveloperInput(normalized.operation, normalized.input);
  if (parsed.capability !== developerBatchCapability(operation)) fail();
  return value;
}

function chatInput(value) {
  exact(value, ["model", "messages", "max_completion_tokens"], ["stream", "reasoning_effort"]);
  if (
    typeof value.model !== "string" ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/.test(value.model) ||
    value.model.length < 2 ||
    value.model.length > 80 ||
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > 16 ||
    !Number.isSafeInteger(value.max_completion_tokens) ||
    value.max_completion_tokens < 1 ||
    value.max_completion_tokens > 2048 ||
    (value.stream !== undefined && value.stream !== false) ||
    (value.reasoning_effort !== undefined &&
      !["none", "minimal", "low", "medium", "high", "xhigh"].includes(value.reasoning_effort))
  )
    fail();
  const messages = value.messages.map((message) => {
    exact(message, ["role", "content"]);
    if (!["user", "assistant", "system", "developer"].includes(message.role)) fail();
    return { role: message.role, content: text(message.content, 8000) };
  });
  const input = {
    model: value.model,
    messages,
    max_completion_tokens: value.max_completion_tokens,
    stream: false,
    ...(value.reasoning_effort === undefined ? {} : { reasoning_effort: value.reasoning_effort }),
  };
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 12288) fail();
  return input;
}
export function parseDeveloperBatchRequest(
  method,
  params,
  body,
  resourceKind = "batch",
  now = Date.now(),
  replayLookup = false,
) {
  if (
    !["batch", "automation", "response", "research"].includes(resourceKind) ||
    !Number.isSafeInteger(now) ||
    typeof replayLookup !== "boolean"
  )
    fail();
  if (resourceKind === "response") {
    // A response job is one non-streaming, explicitly authorized bounded invocation.
    if (params.has("item_id")) fail();
    if (method === "POST" && body?.operation === "create") {
      exact(body, ["operation", "id", "currency", "maximum_charge", "input", "quote_token"]);
      const { input, quote_token, ...metadata } = body;
      body = {
        ...metadata,
        items: [{ id: body.id, operation: "responses", input, quote_token }],
      };
    }
  }
  if (resourceKind === "research" && params.has("item_id")) fail();
  const scheduled = resourceKind === "automation";
  for (const key of params.keys())
    if (!["id", "item_id"].includes(key) || params.getAll(key).length !== 1) fail();
  if (method === "POST") {
    if ([...params.keys()].length) fail();
    if (
      body?.operation === "cancel" ||
      (scheduled && ["pause", "resume"].includes(body?.operation))
    ) {
      exact(body, ["operation", "id"]);
      return { operation: body.operation, input: { id: id(body.id) } };
    }
    exact(body, ["operation", "id", "currency", "maximum_charge", "items"]);
    if (resourceKind === "response" && body.items?.length !== 1) fail();
    if (
      body.operation !== "create" ||
      typeof body.currency !== "string" ||
      !/^[A-Z]{3}$/.test(body.currency) ||
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 8 ||
      (resourceKind === "research" && (body.items.length < 2 || body.items.length > 4))
    )
      fail();
    const items = body.items.map((item) => {
      exact(item, ["id", "input", "quote_token", ...(scheduled ? ["run_at"] : [])], ["operation"]);
      const operation = item.operation ?? "chat/completions";
      developerBatchCapability(operation);
      if (resourceKind === "response" && operation !== "responses") fail();
      if (resourceKind === "research" && operation !== "search") fail();
      if (
        typeof item.quote_token !== "string" ||
        item.quote_token.length > 2048 ||
        !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(item.quote_token)
      )
        fail();
      if (scheduled) {
        if (typeof item.run_at !== "string") fail();
        const runAt = Date.parse(item.run_at);
        if (
          !Number.isSafeInteger(runAt) ||
          new Date(runAt).toISOString() !== item.run_at ||
          (!replayLookup && (runAt < now + 60000 || runAt > now + 23 * 3600000))
        )
          fail();
      }
      const input =
        operation === "agent-turns"
          ? parseDeveloperAgentTurn(item.input)
          : operation === "chat/completions"
            ? chatInput(item.input)
            : directInput(operation, item.input);
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 12288) fail();
      return {
        id: id(item.id),
        operation,
        input,
        quote_token: item.quote_token,
        ...(scheduled ? { run_at: item.run_at } : {}),
      };
    });
    if (new Set(items.map((item) => item.id)).size !== items.length) fail();
    if (
      scheduled &&
      items.some((item, index) => index > 0 && item.run_at <= items[index - 1].run_at)
    )
      fail();
    if (new TextEncoder().encode(JSON.stringify(items)).byteLength > 60000) fail();
    return {
      operation: "create",
      input: {
        id: id(body.id),
        currency: body.currency,
        maximum_ticks: batchBudgetTicks(body.maximum_charge),
        items,
      },
    };
  }
  if (method !== "GET") fail();
  const batch = params.get("id");
  const item = params.get("item_id");
  if (batch === null) {
    if (item !== null) fail();
    return { operation: "list", input: {} };
  }
  return item === null
    ? { operation: "get", input: { id: id(batch) } }
    : { operation: "get_item", input: { id: id(batch), item_id: id(item) } };
}
export function developerBatchRequestKey(batch, item) {
  return "batch:" + id(batch) + ":" + id(item);
}
export function assertBatchBudget(maximumTicks, itemTicks) {
  if (
    !Number.isSafeInteger(maximumTicks) ||
    maximumTicks < 1 ||
    !Array.isArray(itemTicks) ||
    !itemTicks.length ||
    itemTicks.length > 8 ||
    itemTicks.some((ticks) => !Number.isSafeInteger(ticks) || ticks < 1) ||
    itemTicks.reduce((sum, ticks) => sum + ticks, 0) > maximumTicks
  )
    throw new Error("developer_batch_budget_invalid");
}

// Return only the job state and settled result; never expose stored input, authorization or leases.
export function developerResponseJobView(value, expectedId) {
  if (
    !value ||
    value.id !== expectedId ||
    value.batch_id !== expectedId ||
    value.operation_kind !== "responses" ||
    !["queued", "running", "completed", "uncertain", "canceled"].includes(value.state)
  )
    throw new Error("developer_batch_unavailable");
  const completed = value.state === "completed";
  if (
    completed &&
    (value.settlement_state !== "settled" ||
      !value.output ||
      typeof value.output !== "object" ||
      Array.isArray(value.output))
  )
    throw new Error("developer_batch_unavailable");
  return {
    object: "response.job",
    id: expectedId,
    status: value.state,
    output: completed ? value.output : null,
    finished_at: value.finished_at ?? null,
    request_id: value.request_id ?? null,
    settlement_state: value.settlement_state ?? null,
    final_customer_charge: value.final_customer_charge ?? null,
  };
}

// Project only settled search results; annotations are provider evidence, not a verification of their claims.
export function developerResearchRunView(value, expectedId) {
  if (
    !value ||
    value.id !== expectedId ||
    value.resource_kind !== "research" ||
    !Array.isArray(value.items) ||
    value.items.length < 2 ||
    value.items.length > 4
  )
    throw new Error("developer_batch_unavailable");
  const items = value.items.map((item) => {
    if (
      item.operation_kind !== "search" ||
      typeof item.query !== "string" ||
      !["queued", "running", "completed", "uncertain", "canceled"].includes(item.state)
    )
      throw new Error("developer_batch_unavailable");
    const settled = item.state === "completed" && item.settlement_state === "settled";
    const output = settled ? item.output : null;
    const status = output?.status;
    const texts = [],
      citations = new Map();
    if (["completed", "incomplete"].includes(status) && Array.isArray(output.output)) {
      for (const message of output.output) {
        if (
          message?.type !== "message" ||
          message.role !== "assistant" ||
          !Array.isArray(message.content)
        )
          continue;
        for (const part of message.content) {
          if (part?.type !== "output_text" || typeof part.text !== "string") continue;
          texts.push(part.text);
          for (const annotation of Array.isArray(part.annotations) ? part.annotations : []) {
            if (
              annotation?.type !== "url_citation" ||
              typeof annotation.url !== "string" ||
              annotation.url.length > 4096
            )
              continue;
            try {
              const url = new URL(annotation.url);
              if (
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password ||
                citations.size >= 64
              )
                continue;
              if (!citations.has(url.href))
                citations.set(url.href, {
                  url: url.href,
                  title:
                    typeof annotation.title === "string" ? annotation.title.slice(0, 512) : null,
                });
            } catch {
              /* Invalid provider annotations are not sources. */
            }
          }
        }
      }
    }
    const text = texts.join("\n");
    return {
      id: item.id,
      query: item.query,
      status: item.state,
      result_status: settled ? (text ? status : "unavailable") : null,
      text: text || null,
      citations: [...citations.values()],
      request_id: item.request_id ?? null,
      settlement_state: item.settlement_state ?? null,
      final_customer_charge: item.final_customer_charge ?? null,
    };
  });
  const pending = items.some((item) => item.status === "queued" || item.status === "running");
  const all = items.every(
    (item) => item.result_status === "completed" && item.citations.length > 0,
  );
  const status = pending
    ? items.every((item) => item.status === "queued")
      ? "queued"
      : "running"
    : all
      ? "completed"
      : items.every((item) => item.status === "canceled")
        ? "canceled"
        : items.some((item) => item.text)
          ? "partial"
          : "uncertain";
  return {
    object: "research.run",
    id: expectedId,
    status,
    currency: value.currency,
    created_at: value.created_at,
    expires_at: value.expires_at,
    items,
  };
}
