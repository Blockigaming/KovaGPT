export type AccountIdentity = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  app_metadata: { provider: "kova" | "supabase" };
  user_metadata: { full_name: string | null };
};
export function readAccountIdentity(
  client: unknown,
  accountId: string,
  requireVerified?: boolean,
): Promise<AccountIdentity | null>;
