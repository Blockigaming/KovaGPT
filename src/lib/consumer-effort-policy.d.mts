export type ConsumerEffortId = "instant" | "thinking" | "high" | "extra_high" | "max" | "ultra";
export type EffortProfile = {
  id: ConsumerEffortId;
  label: string;
  outputTokens: number;
  reviewTokens: number;
  reviews: number;
  effort: "none" | "low" | "high" | "max";
};
export const CONSUMER_EFFORTS: readonly Readonly<EffortProfile>[];
export function consumerEffort(mode: string): Readonly<EffortProfile> | null;
export function hostedEffortProfile(
  model: string,
  mode: string,
): EffortProfile & { nativeReasoning: boolean; parallel: boolean };
export function hostedEffortBudget(
  model: string,
  mode: string,
  inputTokens: number,
  outputTokens: number,
  outerCalls?: number,
): { inputTokens: number; outputTokens: number; reservedTokens: number; providerCalls: number };
