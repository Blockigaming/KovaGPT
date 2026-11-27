export type BatchOperation =
  | "chat/completions"
  | "agent-turns"
  | "responses"
  | "moderations"
  | "embeddings"
  | "decisions";
export type BatchItem = {
  id: string;
  operation: BatchOperation;
  input: Record<string, unknown>;
  quote_token: string;
  run_at?: string;
};
export type BatchRequest =
  | {
      operation: "create";
      input: { id: string; currency: string; maximum_ticks: number; items: BatchItem[] };
    }
  | { operation: "list"; input: Record<string, never> }
  | { operation: "get" | "cancel" | "pause" | "resume"; input: { id: string } }
  | { operation: "get_item"; input: { id: string; item_id: string } };
export function parseDeveloperBatchRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
  resourceKind?: "batch" | "automation",
  now?: number,
): BatchRequest;
export function developerBatchCapability(
  operation: unknown,
): "chat" | "moderation" | "embeddings" | "decisions";
export function batchChargeTicks(value: unknown): number;
export function batchBudgetTicks(value: unknown): number;
export function assertBatchBudget(maximumTicks: number, itemTicks: number[]): void;
export function developerBatchRequestKey(batch: string, item: string): string;
