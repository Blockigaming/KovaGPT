type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
type Admin = { rpc: unknown };
export class OrganizationAccountDeletionError extends Error {
  constructor(
    readonly status: 409 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function prepareOrganizationAccountDeletion(
  admin: Admin,
  userId: string,
): Promise<void> {
  if (typeof admin.rpc !== "function")
    throw new OrganizationAccountDeletionError(503, "organization_deletion_preflight_unavailable");
  const result = await (admin.rpc as Rpc).call(admin, "prepare_org_account_deletion", {
    p_user_id: userId,
  });
  if (result.error?.message === "developer_payment_reconciliation_pending") {
    throw new OrganizationAccountDeletionError(409, "developer_payment_reconciliation_pending");
  }
  if (result.error?.message === "organization_ownership_transfer_required") {
    throw new OrganizationAccountDeletionError(409, "organization_ownership_transfer_required");
  }
  if (result.error || result.data !== true)
    throw new OrganizationAccountDeletionError(503, "organization_deletion_preflight_unavailable");
}
