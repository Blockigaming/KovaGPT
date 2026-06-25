import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FinancialAccount = {
  id: string;
  institution_name: string | null;
  account_name: string;
  account_type: string | null;
  account_subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  currency: string | null;
  updated_at: string;
};

export type FinanceStatus = {
  plaidConfigured: boolean;
  accounts: FinancialAccount[];
};

export const getMyFinanceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceStatus> => {
    // Plaid is intentionally not wired up until secrets exist.
    // We probe via process.env so the UI can show the correct empty state.
    const plaidConfigured =
      Boolean(process.env.PLAID_CLIENT_ID) &&
      Boolean(process.env.PLAID_SECRET) &&
      Boolean(process.env.PLAID_ENV);

    const { data, error } = await context.supabase
      .from("financial_accounts")
      .select(
        "id, institution_name, account_name, account_type, account_subtype, mask, current_balance, available_balance, currency, updated_at",
      )
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[getMyFinanceStatus]", error.message);
      return { plaidConfigured, accounts: [] };
    }
    return { plaidConfigured, accounts: (data ?? []) as FinancialAccount[] };
  });
