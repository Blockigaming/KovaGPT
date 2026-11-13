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

export const RESPONSE_FOLLOWUP_INSTRUCTIONS = `
When helpful, end your response with up to three short, distinct questions the user might send next. Make each specific to this response and phrase it in the user's voice. Suggestions should request information or content, and should never ask to take actions outside chat. Omit suggestions for simple answers, exact-format outputs, or when awaiting confirmation. Put them after the answer in one fenced kova-followups block as a single-line JSON array of strings, with no heading or text after it. Do not repeat choices already offered by an interactive control.
`;

/** Read a bounded metadata block only when it follows an answer and ends the response. */
export function extractResponseFollowups(content) {
  const match =
    /\r?\n```kova-followups[ \t]*\r?\n([^\r\n]{1,2048})\r?\n```[ \t]*(?:\r?\n[ \t]*)*$/.exec(
      content,
    );
  if (!match || !content.slice(0, match.index).trim()) return { content, followups: [] };
  try {
    const followups = normalizeResponseFollowups(JSON.parse(match[1]));
    if (followups.length) return { content: content.slice(0, match.index).trimEnd(), followups };
  } catch {
    // A malformed block stays in the response.
  }
  return { content, followups: [] };
}
