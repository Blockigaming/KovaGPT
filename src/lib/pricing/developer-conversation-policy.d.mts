export function parseDeveloperConversationRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): { operation: string; input: Record<string, unknown> };

export type ConversationReference = { id: string; revision: number };
export type ConversationBinding = ConversationReference & { createdAt: string };
export function developerConversationReference(
  kind: string,
  input: unknown,
): { body: Record<string, unknown>; reference: ConversationReference | null };
export function expandDeveloperConversation(
  reference: ConversationReference,
  body: Record<string, unknown>,
  saved: unknown,
  projectId: string,
  now?: number,
): { body: Record<string, unknown>; binding: ConversationBinding; expiresAt: number };
