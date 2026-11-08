export const HOSTED_MODEL_MAP: Readonly<Record<string, string>>;
export const KOVA_MODEL_LABELS: Readonly<Record<string, string>>;
export function supportedKovaReasoningEfforts(model: string): string[];
export function resolveKovaReasoningEffort(
  model: string,
  effort?: string,
): "none" | "low" | "medium" | "high" | "xhigh" | "max";
