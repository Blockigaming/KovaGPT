export type BatchItem = { id: string; input: Record<string, unknown>; quote_token: string };
export type BatchRequest =
  | {
      operation: "create";
      input: { id: string; currency: string; maximum_ticks: number; items: BatchItem[] };
    }
  | { operation: "list"; input: Record<string, never> }
  | { operation: "get" | "cancel"; input: { id: string } }
  | { operation: "get_item"; input: { id: string; item_id: string } };
export function parseDeveloperBatchRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): BatchRequest;
export function batchChargeTicks(value: unknown): number;
export function batchBudgetTicks(value: unknown): number;
export function assertBatchBudget(maximumTicks: number, itemTicks: number[]): void;
export function developerBatchRequestKey(batch: string, item: string): string;
