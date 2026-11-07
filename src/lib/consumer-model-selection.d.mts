export type ConsumerModelId = "kova-argon-4.6" | "kova-neon-4.6" | "kova-xenon-5";
export type ConsumerModel = Readonly<{
  id: ConsumerModelId;
  label: string;
  description: string;
  role: "DEFAULT_CHAT" | "ADVANCED_REASONING" | "PREMIUM_REASONING";
  tiers: readonly string[];
  vision: boolean;
}>;
export const CONSUMER_MODELS: readonly ConsumerModel[];
export function consumerModel(value: unknown): ConsumerModel | null;

export type ConsumerModelChoice = {
  principal: string;
  conversationId: string | null;
  id: ConsumerModelId;
};
export function resolveConsumerModelChoice(
  choice: ConsumerModelChoice | null,
  principal: string,
  conversationId: string | null,
  savedModel?: ConsumerModelId,
): ConsumerModelId;
export function createConsumerModelChoice(
  id: ConsumerModelId,
  tier: string,
  available: boolean,
  principal: string,
  conversationId: string | null,
): ConsumerModelChoice | null;

export function latestCompletedModelReply<
  T extends { role: string; generationStatus?: unknown; pendingImage?: unknown },
>(messages?: readonly T[]): T | undefined;

export function latestSavedModelReply(
  chat?: {
    id: string;
    temporary?: boolean;
    messages: readonly {
      role: string;
      generationStatus?: unknown;
      pendingImage?: unknown;
      voiceModelReceipt?: unknown;
      id: string;
      content: string;
    }[];
  } | null,
): { chatId: string; messageId: string; content: string } | undefined;
