export const MEMORY_TIERS: Readonly<
  Record<
    "free" | "plus" | "pro",
    { readonly returned: number; readonly stored: number; readonly characters: number }
  >
>;
export function conversationMemoryNotes(
  messages: Array<{ role: string; content: string }>,
  tier: "free" | "plus" | "pro",
): string;
