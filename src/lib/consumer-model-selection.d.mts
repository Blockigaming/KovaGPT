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
