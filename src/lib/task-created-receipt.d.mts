export type TaskCreatedReceipt = {
  operation: "created";
  source: "persisted-result";
  taskId: string;
};
export function normalizeTaskCreatedReceipt(value: unknown): TaskCreatedReceipt | null;
export function taskCreatedReceiptFromResult(task: unknown): TaskCreatedReceipt | null;
export function taskCreationNotice(
  activity: unknown,
): { success: boolean; text: string; taskId?: string; reason?: string } | null;

export type TaskCreationFailureReceipt = {
  operation: "not-created";
  source: "confirmed-result";
  reason: string;
};
export function normalizeTaskCreationFailureReceipt(
  value: unknown,
): TaskCreationFailureReceipt | null;
