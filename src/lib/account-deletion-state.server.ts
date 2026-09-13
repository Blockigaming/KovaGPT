export type AccountDeletionState = {
  state: "active" | "deleting" | "deleted";
  startedAt: string | null;
};
type Admin = { rpc: unknown };
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
export async function readAccountDeletionState(
  admin: Admin,
  userId: string,
): Promise<AccountDeletionState> {
  if (typeof admin.rpc !== "function") throw new Error("account_deletion_status_unavailable");
  const result = await (admin.rpc as Rpc)
    .call(admin, "read_account_deletion_state", {
      p_user_id: userId,
    })
    .abortSignal(AbortSignal.timeout(10000));
  const row = result.data as Partial<AccountDeletionState> | null;
  if (
    result.error ||
    !row ||
    !["active", "deleting", "deleted"].includes(row.state ?? "") ||
    (row.state === "deleting"
      ? typeof row.startedAt !== "string" || !Number.isFinite(Date.parse(row.startedAt))
      : row.startedAt !== null)
  )
    throw new Error("account_deletion_status_unavailable");
  return row as AccountDeletionState;
}
