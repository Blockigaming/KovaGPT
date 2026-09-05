import type { Conversation } from "./chat-store.ts";
import type { SummarySnapshot } from "./chat-summary-policy.server.mjs";
import type { NormalizedChatPayload } from "./chat-ingress.server.mjs";
export type SummaryDescriptor = {
  id: string;
  completed_start: number | null;
  completed_count: number | null;
  completed_digest: string | null;
  requested_start: number;
  requested_count: number;
  requested_digest: string;
  status: string;
};
type Dependencies = {
  getSession?: () => Promise<{
    data: { session: { user: { id: string }; access_token: string } | null };
  }>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  contextOnly?: boolean;
};
export function createChatSummarySnapshot(
  messages: Conversation["messages"],
  memoryStartIndex?: number,
  descriptor?: SummaryDescriptor | null,
): Promise<SummarySnapshot | null>;
export function createMemoryWritePayload(
  active: Conversation,
  descriptor?: SummaryDescriptor | null,
): Promise<
  | (import("./endpoint-reliability.mjs").MemoryPayload & {
      memoryEnabled: true;
      temporary: false;
      contextSummary: SummarySnapshot | null;
    })
  | null
>;
export function writeMemoryForPrincipal(
  active: Conversation,
  principal: string,
  dependencies?: Dependencies,
): Promise<{ continue: boolean }>;
export function startMemoryWrites(active: Conversation, principal: string): () => void;
export function scheduleMemoryWrites(
  active: Conversation,
  principal: string,
  signal: AbortSignal,
): void;
export function fetchForPrincipal(
  principal: string | null,
  input: RequestInfo | URL,
  init?: RequestInit,
  dependencies?: Dependencies,
): Promise<Response>;
export function createChatHistoryPayload(
  messages: Array<Pick<import("./chat-store.ts").Message, "role" | "content" | "attachments">>,
  memoryStartIndex?: number,
  options?: Dependencies & {
    temporary?: boolean;
    memoryEnabled?: boolean;
    principal?: string | null;
    chatId?: string;
  },
): Promise<
  Pick<NormalizedChatPayload, "memoryStartIndex" | "historyOffset" | "summaryProof"> & {
    messages: Array<Pick<import("./chat-store.ts").Message, "role" | "content" | "attachments">>;
  }
>;

export function chatRequestProfile(
  settings: import("../components/SettingsDialog").Settings,
): Record<string, unknown>;
