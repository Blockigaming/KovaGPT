export type FinanceSnapshot = {
  fetchedAt: string;
  startDate: string;
  endDate: string;
  limited: boolean;
  accounts: {
    id: string | null;
    name: string | null;
    mask: string | null;
    type: string | null;
    subtype: string | null;
    current: number | null;
    available: number | null;
    currency: string | null;
  }[];
  transactions: {
    id: string | null;
    accountId: string | null;
    name: string | null;
    date: string | null;
    amount: number | null;
    currency: string | null;
    pending: boolean;
  }[];
};
export function readFinanceSnapshot(
  accessToken: string,
  requestPlaid: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ensureCurrent: () => Promise<void>,
  now?: number,
): Promise<FinanceSnapshot>;
