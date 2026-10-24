export function createOpenAiWebhookHandler(
  input: Record<string, unknown>,
): (request: Request) => Promise<Response>;
