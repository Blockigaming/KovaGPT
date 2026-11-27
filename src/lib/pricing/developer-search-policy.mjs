export function developerSearchOptions(input) {
  const hasSearch =
    Array.isArray(input.tools) && input.tools.some((tool) => tool?.type === "web_search");
  if (!hasSearch && input.max_tool_calls === undefined) return null;
  const tool = input.tools?.[0];
  if (
    !hasSearch ||
    input.tools.length !== 1 ||
    !tool ||
    Object.keys(tool).some((key) => !["type", "search_context_size"].includes(key)) ||
    tool.search_context_size !== "low" ||
    !Number.isSafeInteger(input.max_tool_calls) ||
    input.max_tool_calls < 1 ||
    input.max_tool_calls > 3 ||
    input.stream === true ||
    (input.tool_choice !== undefined && input.tool_choice !== "required") ||
    input.parallel_tool_calls !== undefined ||
    input.text !== undefined
  )
    throw new Error("developer_responses_invalid");
  return {
    tools: [{ type: "web_search", search_context_size: "low" }],
    tool_choice: "required",
    max_tool_calls: input.max_tool_calls,
  };
}
