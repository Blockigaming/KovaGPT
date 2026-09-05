export const CHAT_SUMMARY_LIMITS: Readonly<{
  recentMessages: number;
  minimumMessages: number;
  maximumMessages: number;
  inputMessageChars: number;
  outputChars: number;
  batchSize: number;
}>;
export type SummaryMessage = { role: "user" | "assistant"; content: string };
export type SummaryInput = {
  messages: SummaryMessage[];
  memoryStartIndex?: number;
  historyOffset?: number;
  summaryProof?: { id: string; start: number; count: number; digest: string };
  temporary: boolean;
  memoryEnabled: boolean;
};
export type SummarySnapshot = {
  start: number;
  count: number;
  digest: string;
  messages: SummaryMessage[];
  baseCount?: number;
  baseDigest?: string | null;
  baseId?: string | null;
};
export type SummaryContext = { block: string; source: { id: string; updatedAt: string } };
export function prepareChatSummary(input: SummaryInput): SummarySnapshot | null;
export function acceptChatSummary(row: unknown, input: SummaryInput): SummaryContext | null;
export function processChatSummaryBatch(dependencies: {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error?: unknown }>;
  summarize: (messages: SummaryMessage[], previousSummary: string | null) => Promise<string | null>;
}): Promise<{
  claimed: number;
  completed: number;
  retrying: number;
  failed: number;
  superseded: number;
}>;

export function parseChatSummarySnapshot(value: unknown): SummarySnapshot | null;
