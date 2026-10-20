import { readAccountPolicy } from "@/lib/account-lifecycle-policy.mjs";

export type AccountDeletionState = {
  state: "active" | "scheduled" | "deleting" | "deleted";
  startedAt: string | null;
};

/** Retain the old internal deleting spelling only for irreversible finalization.
 * A missing policy row is not proof that Auth was deleted. */
export async function readAccountDeletionState(
  admin: unknown,
  userId: string,
): Promise<AccountDeletionState> {
  const value = await readAccountPolicy(admin, userId);
  return {
    state: value.state === "finalizing" ? "deleting" : value.state,
    startedAt: value.state === "finalizing" ? value.scheduledAt : null,
  };
}
