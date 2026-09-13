import type { Conversation } from "./chat-store";
export type ChatHistoryStatus = {
  ownerId: string | null;
  phase: string;
  error: string | null;
  pending: number;
  migration: number;
  conflicts: {
    id: string;
    title: string;
    local: Conversation | null;
    cloud: Conversation | null;
    epochChanged: boolean;
  }[];
};
export type ChatHistoryState = {
  version: number;
  ownerId: string;
  localEpoch: string;
  epoch: string | null;
  cursor: number;
  complete: boolean;
  cleared?: boolean;
  records: Record<string, Record<string, unknown>>;
};
export function createChatHistoryController(options: {
  ownerId: string;
  signal: AbortSignal;
  loadDevice(ownerId: string): Promise<ChatHistoryState | null>;
  commitDevice(
    previous: ChatHistoryState | null,
    next: ChatHistoryState,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  getLegacy(): { active: Conversation[]; archived: Conversation[] };
  transport(request: {
    method: string;
    epoch?: string | null;
    cursor?: number;
    body?: unknown;
    signal: AbortSignal;
  }): Promise<unknown>;
  changed(value: {
    active: Conversation[];
    archived: Conversation[];
    source: "local" | "cloud";
    dirty: boolean;
  }): void;
  status(value: ChatHistoryStatus): void;
}): {
  initialize(): Promise<void>;
  write(items: Conversation[], archived: boolean, automatic?: boolean): Promise<boolean>;
  markDirty(): void;
  pump(): Promise<void>;
  getState(): ChatHistoryState | null;
  readonly dirty: boolean;
  migrate(): Promise<void>;
  resolve(id: string, choice: "cloud" | "keep"): Promise<void>;
  retry(): Promise<void>;
  stop(): void;
};
