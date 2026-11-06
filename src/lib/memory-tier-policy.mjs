/** Bounded context and retained notes grow with the account's verified plan. */
export const MEMORY_TIERS = Object.freeze({
  free: Object.freeze({ returned: 4, stored: 25, characters: 500 }),
  plus: Object.freeze({ returned: 12, stored: 250, characters: 1000 }),
  pro: Object.freeze({ returned: 32, stored: 1000, characters: 1500 }),
});

/** Brief extractive summaries of user topics and the attributed reply.
 * Reply text stays labeled as assistant output, never as a personal fact. */
export function conversationMemoryNotes(messages, tier) {
  const policy = MEMORY_TIERS[tier];
  if (!policy || !Array.isArray(messages)) throw new Error("Invalid memory source");
  const topics = messages
    .filter((message) => message?.role === "user" && typeof message.content === "string")
    .flatMap((message) => message.content.split(/(?<=[.!?])\s+|\n+/u))
    .map((text) => text.replace(/\s+/gu, " ").trim())
    .filter(
      (text) =>
        text &&
        !/(?:password|api[ -]?key|verification code|private key|ignore .*instructions|system prompt|sk-[a-z0-9_-]+)/iu.test(
          text,
        ),
    );
  const unique = [...new Set(topics)];
  // Keep the opening subject and the latest topics without storing a transcript.
  const selected = unique.length > 3 ? [unique[0], ...unique.slice(-2)] : unique;
  if (!selected.length) return "Conversation summary: private details omitted.";
  const lastReply =
    messages
      .slice()
      .reverse()
      .find((message) => message?.role === "assistant" && typeof message.content === "string")
      ?.content ?? "";
  const reply =
    lastReply
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((text) => text.replace(/\s+/gu, " ").trim())
      .find(
        (text) =>
          text &&
          !/^(?:my |i |i'm\b)/iu.test(text) &&
          !/(?:password|api[ -]?key|verification code|private key|ignore .*instructions|system prompt|sk-[a-z0-9_-]+)/iu.test(
            text,
          ),
      ) ?? "";
  const replyBudget = Math.min(200, Math.floor(policy.characters * 0.4));
  const excerpt =
    reply.length > replyBudget ? `${reply.slice(0, replyBudget - 1).trimEnd()}…` : reply;
  const result = excerpt ? ` Kova replied: ${excerpt}` : "";
  const budget = Math.floor((policy.characters - 32 - result.length) / selected.length) - 3;
  return `Discussed: ${selected.map((text) => (text.length > budget ? `${text.slice(0, budget - 1).trimEnd()}…` : text)).join(" · ")}${result}`;
}
