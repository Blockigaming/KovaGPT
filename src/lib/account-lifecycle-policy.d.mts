export const ACCOUNT_RECOVERY_MS: number;
export const MONTHLY_POLICY_VERSION: string;
export type AccountPolicyState = {
  state: "active" | "scheduled" | "finalizing";
  scheduledAt: string | null;
  recoverUntil: string | null;
};
export function accountPolicyRpc(
  admin: unknown,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown>;
export function validateAccountPolicyState(value: unknown): AccountPolicyState;
export function readAccountPolicy(admin: unknown, userId: string): Promise<AccountPolicyState>;
export function scheduleAccountPolicyDeletion(
  admin: unknown,
  userId: string,
): Promise<AccountPolicyState>;
export function recoverAccountPolicy(admin: unknown, userId: string): Promise<AccountPolicyState>;
export function renewAccountFinalization(
  admin: unknown,
  userId: string,
  attemptId: string,
): Promise<{ attemptId: string; leaseUntil: string }>;
export function acknowledgePolicyCustomerRetired(
  admin: unknown,
  userId: string,
  attemptId: string,
  environment: "live" | "sandbox",
  customerId: string,
): Promise<void>;
export function confirmAccountFinalization(
  admin: unknown,
  userId: string,
  attemptId: string,
): Promise<void>;
export type AccountFinalizationClaim = {
  state: "finalizing";
  attemptId: string;
  leaseUntil: string;
  customers: Array<{
    environment: "live" | "sandbox";
    customerId: string;
    retiredAt: string | null;
  }>;
};
export function validateAccountFinalizationClaim(value: unknown): AccountFinalizationClaim;
export function runAccountPolicyFinalizerBatch(options: {
  admin: unknown;
  reconcileCheckout: (userId: string) => Promise<unknown>;
  finalize: (userId: string, claim: AccountFinalizationClaim) => Promise<{ status: number }>;
  limit?: number;
}): Promise<{ attempted: number; completed: number; pending: number }>;
