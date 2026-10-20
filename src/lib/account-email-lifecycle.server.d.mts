import type { AccountPolicyState } from "./account-lifecycle-policy.mjs";
export type AccountEmailEnqueueState = "queued" | "disabled" | "unconfirmed" | "not_applicable";
export function recordAccountLifecycleNotification(
  admin: unknown,
  accountId: string,
  event: "account_deletion_scheduled" | "account_recovered",
  originalSchedule: AccountPolicyState | null | undefined,
  occurredAt?: string,
): Promise<AccountEmailEnqueueState>;
export function prepareAccountDeletionNotification(
  admin: unknown,
  accountId: string,
  attemptId: string,
): Promise<void>;
