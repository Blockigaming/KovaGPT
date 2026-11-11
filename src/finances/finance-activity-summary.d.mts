import type { FinanceSnapshot } from "./finance-read.server.mjs";

type Record = Pick<
  FinanceSnapshot["transactions"][number],
  "amount" | "date" | "currency" | "pending"
>;
export type FinanceActivitySummary = {
  spent: number;
  received: number;
  days: { date: string; spent: number; received: number }[];
  excludedPending: number;
  excludedCurrency: number;
  excludedInvalid: number;
};
export function summarizeUsdActivity(records: ReadonlyArray<Record>): FinanceActivitySummary;
