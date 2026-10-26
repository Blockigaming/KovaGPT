export type OpenAiTaskOperation = "agent" | "browser";
export type OpenAiTaskAvailability = { configured: boolean; agent: boolean; browser: boolean };
export function loadOpenAiTaskAvailability(
  ownerId: string,
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<OpenAiTaskAvailability>;
export function submitOpenAiTask(
  task: { ownerId: string; operation: OpenAiTaskOperation; input: string; requestId: string },
  options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ text: string; toolCalls?: number }>;
