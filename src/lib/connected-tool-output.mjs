/** Bound the serialized UTF-8 payload, including JSON escaping and all metadata.
 * Never cut JSON or label an omitted file/page complete. Oversized results are
 * rejected as a whole: there is no fabricated continuation or partial cursor.
 */
export const CONNECTED_TOOL_OUTPUT_BYTES = 96 * 1024;
export function serializeConnectedToolOutput(value) {
  const result =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...value, contentIsUntrusted: true }
      : { result: value, contentIsUntrusted: true };
  const json = JSON.stringify(result);
  if (new TextEncoder().encode(json).byteLength <= CONNECTED_TOOL_OUTPUT_BYTES) return json;
  return JSON.stringify({
    error: "connected_result_too_large",
    complete: false,
    contentOmitted: true,
    contentIsUntrusted: true,
    nextCursor: null,
    message:
      "No provider content was supplied: the serialized result exceeds the 96 KiB tool-message limit. Use a smaller file or narrower query. This response offers no continuation; do not claim the file or page was read or complete.",
  });
}
