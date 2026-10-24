/** Display only supplied suggestions. Never derive actions or execute them. */
export function normalizeResponseFollowups(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 240)
        .map((item) => item.trim()),
    ),
  ].slice(0, 3);
}
export function appendFollowupToDraft(draft, suggestion) {
  return draft.length ? `${draft}\n\n${suggestion}` : suggestion;
}
