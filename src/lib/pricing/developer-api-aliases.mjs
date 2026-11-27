const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fail = () => {
  throw new Error("developer_input_invalid");
};
function exact(value, fields) {
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key))) fail();
}

// These are explicitly bounded compatibility surfaces, not an arbitrary
// upstream proxy. They share the canonical Responses validation and meter.
export function normalizeDeveloperOperation(kind, input) {
  if (kind === "search") {
    exact(input, ["model", "query", "max_output_tokens", "max_tool_calls"]);
    if (
      typeof input.query !== "string" ||
      !input.query.trim() ||
      input.query.length > 8000 ||
      !Number.isSafeInteger(input.max_tool_calls) ||
      input.max_tool_calls < 1 ||
      input.max_tool_calls > 3
    )
      fail();
    return {
      operation: "responses",
      input: {
        model: input.model,
        input: input.query,
        max_output_tokens: input.max_output_tokens,
        tools: [{ type: "web_search", search_context_size: "low" }],
        max_tool_calls: input.max_tool_calls,
        stream: false,
      },
    };
  }
  if (kind === "chat/completions") {
    exact(input, [
      "model",
      "messages",
      "max_tokens",
      "max_completion_tokens",
      "stream",
      "reasoning_effort",
    ]);
    if (
      !Array.isArray(input.messages) ||
      !input.messages.length ||
      input.messages.length > 100 ||
      (input.max_tokens === undefined) === (input.max_completion_tokens === undefined) ||
      (input.stream !== undefined && typeof input.stream !== "boolean")
    )
      fail();
    const messages = input.messages.map((message) => {
      exact(message, ["role", "content"]);
      if (
        !["system", "developer", "user", "assistant"].includes(message.role) ||
        typeof message.content !== "string"
      )
        fail();
      return { role: message.role, content: message.content };
    });
    return {
      operation: "responses",
      input: {
        model: input.model,
        input: messages,
        max_output_tokens: input.max_completion_tokens ?? input.max_tokens,
        stream: input.stream === true,
        ...(input.reasoning_effort !== undefined
          ? { reasoning: { effort: input.reasoning_effort } }
          : {}),
      },
    };
  }
  return { operation: kind, input };
}
