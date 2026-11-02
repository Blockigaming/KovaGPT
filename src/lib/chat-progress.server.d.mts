export function createChatProgressResponse(
  operation: (progress: {
    emit: (delta: Record<string, unknown>) => void;
    signal: AbortSignal;
  }) => Promise<Response>,
  options?: { signal?: AbortSignal; requestId?: string; maxBytes?: number },
): Response;
