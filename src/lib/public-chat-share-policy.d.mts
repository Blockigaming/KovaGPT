export type PublicChatSnapshot = {
  title: string;
  snapshot: { messages: { role: "user" | "assistant"; content: string }[] };
};
export function publicShareSnapshot(conversation: unknown): PublicChatSnapshot;
export function validShareToken(value: unknown): boolean;
export function shareTokenHash(value: string): Promise<string>;
export function createShareToken(): string;
