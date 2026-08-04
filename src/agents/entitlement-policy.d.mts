export type AgentSubscriptionRow = {
  price_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  environment?: string | null;
};

export function resolveAgentEntitlement(
  rows: AgentSubscriptionRow[] | null | undefined,
  options: {
    billingEnvironment: string;
    tierForLookupKey: (value: string | null | undefined) => "free" | "plus" | "pro";
    now?: number;
  },
): "plus" | "pro" | null;
