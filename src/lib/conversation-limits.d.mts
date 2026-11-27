export const CONVERSATION_MESSAGE_LIMITS: Readonly<{ free: number; plus: number; pro: number }>;
export function conversationMessageLimit(tier: string | null | undefined): number;
export function conversationLimitReached(
  tier: string | null | undefined,
  messageCount: number,
): boolean;
export function conversationLimitMessage(tier: string | null | undefined): string;
