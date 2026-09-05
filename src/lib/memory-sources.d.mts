export type MemorySourceRef =
  | { kind: "chat_memory" | "conversation_summary"; id: string }
  | { kind: "project_memory"; id: string; projectId: string };
export type MemorySources = { ownerId: string; sources: MemorySourceRef[] };
export const MAX_MEMORY_SOURCES: number;
export const MEMORY_SOURCES_CHANGED_EVENT: string;
export function normalizeMemorySourceRefs(value: unknown): MemorySourceRef[];
export function normalizeMemorySources(
  value: unknown,
  ownerId: string | null,
  temporary?: boolean,
): MemorySources | undefined;
export function memorySourcesDelta(
  ownerId: string | null,
  sources: MemorySourceRef[],
  temporary?: boolean,
): { kind: string; owner_id: string | null; sources: MemorySourceRef[] };
export function createMemorySourceReceiver(
  ownerId: string | null,
  temporary?: boolean,
): (delta: unknown) => MemorySources | undefined;
export function attachMemorySources<
  T extends { id: string; messages: { id: string; role: string }[] },
>(conversations: T[], conversationId: string, messageId: string, memorySources: MemorySources): T[];
export function createMemorySourceUpdater<
  T extends { id: string; messages: { id: string; role: string }[] },
>(
  ownerId: string | null,
  temporary: boolean,
  conversationId: string,
  messageId: string,
  isCurrent: () => boolean,
  update: (next: (previous: T[]) => T[]) => void,
): (delta: unknown) => void;
