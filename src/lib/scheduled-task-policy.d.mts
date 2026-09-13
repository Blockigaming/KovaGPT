export type TaskProvider = "gmail" | "slack" | "github";
export type TaskContextRef =
  | { kind: "snapshot"; text: string; sourceChatId: string; capturedAt: string }
  | { kind: "library"; id: string }
  | { kind: "project_file"; id: string; projectId: string }
  | { kind: "connected"; grantId: string; provider: TaskProvider; resource: string };
export type TaskTrigger = {
  provider: TaskProvider;
  grantId: string;
  resource: string;
  author?: string;
  contains?: string;
  label?: string;
  includeReplies?: boolean;
  activities?: string[];
};
export type TaskPayload = {
  title?: string;
  prompt?: string;
  run_at?: string;
  localTime?: string;
  repeat?: "none" | "daily" | "weekly" | "monthly";
  timezone?: string;
  triggerMode?: "time" | "event";
  contextRefs?: TaskContextRef[];
  eventTriggers?: TaskTrigger[];
};
export const TASK_CONTEXT_MAX_CHARS: number;
export const TASK_PROVIDERS: readonly TaskProvider[];
export function taskTimezone(value?: unknown): string;
export function taskResource(provider: unknown, value: unknown): string;
export function parseTaskContext(value?: unknown): TaskContextRef[];
export function parseTaskTriggers(value?: unknown): TaskTrigger[];
export function parseTaskPayload(value: unknown, partial?: boolean): TaskPayload;
export function consumerTaskBounds(
  model: {
    outputCeiling: number;
    maxOutputTokens: number;
    pricePerMillion: { input: number; output: number };
  },
  config: { generationEnabled: boolean; maxCostUsdPerRequest: number },
  estimatedInputTokens: number,
): { maxOutput: number; inputTokens: number; maxCost: number };
