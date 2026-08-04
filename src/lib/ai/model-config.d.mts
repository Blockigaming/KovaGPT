export type ModelRole =
  | "DEFAULT_CHAT"
  | "ADVANCED_REASONING"
  | "PREMIUM_REASONING"
  | "UTILITY"
  | "IMAGE_ANALYSIS"
  | "IMAGE_GENERATION"
  | "EMBEDDING";

export const MODEL_ROLES: readonly ModelRole[];
export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>>;
export const ROLE_ENV_KEYS: Readonly<Record<ModelRole, string>>;
export const MODEL_COST_PER_MTOK: Readonly<Record<string, { input: number; output: number }>>;
export const MODE_MAX_OUTPUT_TOKENS: Readonly<Record<string, number>>;
export const UTILITY_MAX_OUTPUT_TOKENS: number;
export const DEFAULT_MAX_OUTPUT_TOKENS: number;
export const ROUTING_THRESHOLDS: Readonly<{
  advancedComplexityScore: number;
  contextUpgradeChars: number;
  attachmentUpgradeCount: number;
  historyUpgradeTurns: number;
}>;

export function isValidModelId(value: unknown): boolean;
export function resolveRoleModel(
  role: ModelRole,
  env?: Record<string, string | undefined>,
): { modelId: string; source: "env" | "default"; invalidOverride?: string };
export function getModelConfig(env?: Record<string, string | undefined>): Record<ModelRole, string>;
export function costPerMTok(modelId: string): { input: number; output: number };
