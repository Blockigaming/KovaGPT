export function developerSearchOptions(input: Record<string, unknown>): {
  tools: { type: "web_search"; search_context_size: "low" }[];
  tool_choice: "required";
  max_tool_calls: number;
} | null;
