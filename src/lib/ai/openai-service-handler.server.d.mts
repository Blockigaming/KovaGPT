export function parseOpenAiServiceTask(value: unknown): Record<string, unknown>;
export function createOpenAiServiceHandler(
  dependencies: Record<string, unknown>,
): (request: Request) => Promise<Response>;
