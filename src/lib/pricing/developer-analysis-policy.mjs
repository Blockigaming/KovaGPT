const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const invalid = () => {
  throw new Error("developer_analysis_invalid");
};
export function developerAnalysisFields(value) {
  if (
    !object(value) ||
    typeof value.input !== "string" ||
    !value.input.trim() ||
    value.input.includes("\0") ||
    new TextEncoder().encode(value.input).byteLength > 16000 ||
    !Number.isSafeInteger(value.max_output_tokens) ||
    value.max_output_tokens < 1 ||
    value.max_output_tokens > 2048
  )
    invalid();
  return {
    input: value.input,
    instructions: "Analyze the supplied data in isolated Python. Return the result as text.",
    max_output_tokens: value.max_output_tokens,
    stream: false,
    store: false,
    service_tier: "default",
    tools: [
      {
        type: "code_interpreter",
        container: { type: "auto", memory_limit: "1g", network_policy: { type: "disabled" } },
      },
    ],
    tool_choice: "required",
    max_tool_calls: 1,
  };
}
export function validDeveloperAnalysisRequest(body) {
  if (!object(body) || typeof body.model !== "string" || !body.model) return false;
  try {
    const expected = developerAnalysisFields(body);
    return (
      Object.keys(body).length === Object.keys(expected).length + 1 &&
      Object.entries(expected).every(([key, value]) => JSON.stringify(body[key]) === JSON.stringify(value))
    );
  } catch {
    return false;
  }
}
export function analysisContainerReceipt(output) {
  if (!Array.isArray(output) || output.length > 256) return null;
  let container = null;
  for (const item of output) {
    if (!object(item)) return null;
    if (item.type === "code_interpreter_call") {
      if (
        container !== null ||
        item.status !== "completed" ||
        typeof item.id !== "string" ||
        !/^ci_[A-Za-z0-9_-]{1,180}$/.test(item.id) ||
        typeof item.container_id !== "string" ||
        !/^cntr_[A-Za-z0-9_-]{1,180}$/.test(item.container_id)
      )
        return null;
      container = item.container_id;
    } else if (!["message", "reasoning"].includes(item.type)) return null;
  }
  return container;
}
export function validateDeveloperAnalysisResult(value, expectedModels, publicModel) {
  if (
    !analysisContainerReceipt(value?.output) ||
    value.status !== "completed" ||
    !Array.isArray(expectedModels) ||
    !expectedModels.includes(value.model) ||
    typeof value.id !== "string" ||
    !/^resp_[A-Za-z0-9_-]{1,180}$/.test(value.id) ||
    !object(value.usage)
  )
    invalid();
  const usage = value.usage, cached = usage.input_tokens_details?.cached_tokens;
  if (
    ![usage.input_tokens, usage.output_tokens, usage.total_tokens, cached].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000000,
    ) ||
    cached > usage.input_tokens ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens
  )
    invalid();
  const parts = [];
  for (const item of value.output) {
    if (item.type !== "message") continue;
    if (item.role !== "assistant" || !Array.isArray(item.content)) invalid();
    for (const part of item.content) {
      if (part?.type !== "output_text" || typeof part.text !== "string") invalid();
      parts.push(part.text);
    }
  }
  const text = parts.join("\n");
  if (!text.trim() || new TextEncoder().encode(text).byteLength > 65536) invalid();
  return {
    id: value.id, object: "analysis.result", model: publicModel, text,
    usage: { input_tokens: usage.input_tokens, cached_input_tokens: cached,
      output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, container_1g_sessions: 1 },
  };
}
export async function readDeveloperAnalysisResponse(response, expectedModels, publicModel, dispose) {
  if (!response.ok || !response.body ||
    (response.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    invalid();
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "", bytes = 0, container = null;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 524288) invalid();
      body += decoder.decode(part.value, { stream: true });
    }
    const value = JSON.parse(body + decoder.decode());
    container = analysisContainerReceipt(value?.output);
    return validateDeveloperAnalysisResult(value, expectedModels, publicModel);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (container) await dispose(container);
  }
}
