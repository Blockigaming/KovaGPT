import type { Conversation } from "./chat-store";
export function homePromptSuggestions(
  draft: string,
  conversations?: readonly Conversation[],
  memories?: readonly { title: string }[],
  connectedIds?: readonly string[],
): string[];
