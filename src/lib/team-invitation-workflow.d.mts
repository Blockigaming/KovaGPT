import type Stripe from "stripe";
import type { TeamEmailInvitation } from "./team-invitations.server";
export function settleTeamInvitation(
  invite: TeamEmailInvitation & { customer_id: string | null },
  deps: {
    stripe: Stripe;
    reconcile: () => Promise<void>;
    finalize: () => Promise<unknown>;
    saveInvoice: (id: string) => Promise<void>;
    dispatch?: boolean;
    now?: () => number;
  },
): Promise<{ ready: boolean; paymentUrl: string | null }>;
