export type WorkModelMode = "instant" | "normal" | "thinking" | "deep";
export type WorkReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type WorkModelCapability = {
  model: string;
  reasoningEfforts: WorkReasoningEffort[];
  maxOutputTokens: number;
};
export type WorkModelSelection = {
  mode: WorkModelMode;
  reasoningEffort: WorkReasoningEffort | null;
  maxOutputTokens: number;
  service: "provider_default";
};
export type WorkModelOption = {
  mode: WorkModelMode;
  label: string;
  model: string | null;
  available: boolean;
  reason: string | null;
  reasoningEfforts: WorkReasoningEffort[];
  maxOutputTokens: number;
  service: "provider_default";
};
export const WORK_MODEL_MODES: readonly {
  id: WorkModelMode;
  label: string;
  role: string;
  outputCeiling: number;
}[];
export const WORK_REASONING_EFFORTS: readonly WorkReasoningEffort[];
export function parseWorkModelChoice(input: { mode?: unknown; reasoningEffort?: unknown }): {
  mode: WorkModelMode;
  reasoningEffort: WorkReasoningEffort | null;
};
export function parseWorkModelCapabilities(input: unknown): WorkModelCapability[];
export function workModelOptions(input: {
  capabilities: WorkModelCapability[];
  models: readonly {
    id: string;
    reasoning: boolean;
    tools: boolean;
    tiers: readonly string[];
    maxOutputTokens: number;
  }[];
  roles: Record<string, string>;
  plan: string | null;
}): WorkModelOption[];
export function selectWorkModel(
  choice: { mode?: unknown; reasoningEffort?: unknown },
  options: WorkModelOption[],
): { model: string; premium: boolean; selection: WorkModelSelection };
export function assertWorkRunnerModel(
  run: { model: string; modelSelection?: WorkModelSelection },
  runner: { modelCapabilities?: WorkModelCapability[] },
): void;
