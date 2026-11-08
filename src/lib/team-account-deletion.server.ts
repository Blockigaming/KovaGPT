import { loose } from "./supabase-loose";

/** Read only the deleting owner's durable mappings after the account fence is held. */
export async function teamCustomersForAccountDeletion(
  admin: Parameters<typeof loose>[0],
  ownerId: string,
): Promise<string[]> {
  const result = await loose(admin)
    .from("team_workspaces")
    .select("customer_id")
    .eq("owner_id", ownerId)
    .abortSignal(AbortSignal.timeout(10000));
  // An older installation cannot create Team customers before this additive table exists.
  if (["42P01", "PGRST205"].includes(result.error?.code ?? "")) return [];
  if (result.error || !Array.isArray(result.data))
    throw new Error("team_billing_retirement_unavailable");
  const customers = result.data
    .map((row: { customer_id: unknown }) => row.customer_id)
    .filter((id: unknown) => id !== null);
  if (
    customers.some((id: unknown) => typeof id !== "string" || !/^cus_[A-Za-z0-9]+$/u.test(id)) ||
    new Set(customers).size !== customers.length
  )
    throw new Error("team_billing_retirement_identity_invalid");
  return customers as string[];
}

export async function acknowledgeTeamCustomerRetired(
  admin: Parameters<typeof loose>[0],
  ownerId: string,
  customerId: string,
): Promise<void> {
  const result = await loose(admin)
    .from("team_workspaces")
    .update({ status: "canceled", paid_until: new Date().toISOString(), billing_hold: true })
    .eq("owner_id", ownerId)
    .eq("customer_id", customerId)
    .abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw new Error("team_billing_retirement_unconfirmed");
}
