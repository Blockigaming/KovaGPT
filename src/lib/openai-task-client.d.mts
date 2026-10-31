export type OpenAiTaskOperation = "agent" | "browser" | "decisions" | "moderation";
export type OpenAiTaskAvailability = { configured: boolean } & Record<OpenAiTaskOperation, boolean>;
export function loadOpenAiTaskAvailability(
  ownerId: string,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<OpenAiTaskAvailability>;
export function submitOpenAiTask(
  task: {
    ownerId: string;
    operation: OpenAiTaskOperation;
    input: string;
    requestId: string;
    question?: string;
  },
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ text: string; toolCalls?: number }>;
