import type { ModelRole } from "./model-config.d.mts";

export type RouterTask =
  | "chat"
  | "utility"
  | "deep_research"
  | "image_generation"
  | "image_analysis"
  | "embedding";

export type UtilityTask =
  | "chat_title"
  | "summary"
  | "memory_summary"
  | "classification"
  | "json_format"
  | "keyword_extraction"
  | "language_detection"
  | "sentiment"
  | "safety_label"
  | "search_query"
  | "suggestion";

export const UTILITY_TASKS: readonly UtilityTask[];

export type RouteInput = {
  task: RouterTask;
  utilityTask?: UtilityTask | string;
  mode?: string;
  tier?: "free" | "plus" | "pro" | "business";
  deepMode?: boolean;
  hasImages?: boolean;
  needsTools?: boolean;
  text?: string;
  contextChars?: number;
  attachmentCount?: number;
  historyTurns?: number;
  env?: Record<string, string | undefined>;
};

export type RouteDecision = {
  role: ModelRole;
  modelId: string;
  maxOutputTokens: number;
  complexityScore: number;
  reasons: string[];
  estimatedCostUsd: number;
  downgradedFrom?: ModelRole;
};

export function approxTokens(chars: number): number;
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number;
export function scoreComplexity(
  text: string,
  signals?: {
    contextChars?: number;
    attachmentCount?: number;
    historyTurns?: number;
    needsTools?: boolean;
  },
): { score: number; reasons: string[] };
export function routeModel(input: RouteInput): RouteDecision;
