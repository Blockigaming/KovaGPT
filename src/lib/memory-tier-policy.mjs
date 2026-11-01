/** Bounded context and retained notes grow with the account's verified plan. */
export const MEMORY_TIERS = Object.freeze({
  free: Object.freeze({ returned: 4, stored: 25, characters: 500 }),
  plus: Object.freeze({ returned: 12, stored: 250, characters: 1000 }),
  pro: Object.freeze({ returned: 32, stored: 1000, characters: 1500 }),
});

/** Extract only explicit first-person statements; assistant text and instructions
 * are never promoted to facts. Notes remain verbatim, inspectable and editable. */
export function conversationMemoryNotes(messages, tier) {
  const policy = MEMORY_TIERS[tier];
  if (!policy || !Array.isArray(messages)) throw new Error("Invalid memory source");
  const statements = messages
    .filter((m) => m?.role === "user" && typeof m.content === "string")
    .flatMap((m) => m.content.split(/(?<=[.!?])\s+|\n+/u))
    .map((text) => text.replace(/\s+/gu, " ").trim())
    .filter(
      (text) =>
        /^(?:my (?:name|job|work|project|preferred|favorite)|i (?:am|prefer|like|live|work|study|use|have)|i'm|please call me|remember (?:that |my ))\b/iu.test(
          text,
        ) &&
        text.length >= 8 &&
        text.length <= 500 &&
        !/(?:password|api[ -]?key|verification code|private key|ignore .*instructions|system prompt|for (?:this|one) (?:answer|response)|just this once)/iu.test(
          text,
        ),
    );
  const unique = [...new Set(statements)].reverse();
  const result = [];
  let remaining = policy.characters;
  for (const text of unique) {
    if (text.length + 2 > remaining) continue;
    result.unshift(`• ${text}`);
    remaining -= text.length + 3;
    if (remaining < 10) break;
  }
  return result.join("\n");
}
