export function parseDeveloperPlaygroundOptions(raw) {
  if (typeof raw !== "string" || raw.length > 32768)
    throw new Error("Advanced request options are too large.");
  if (!raw.trim()) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Advanced request options must be valid JSON.");
  }
  const allowed = [
    "instructions",
    "text",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "max_tool_calls",
    "file_ids",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error("Advanced options contain an unsupported field.");
  return value;
}
