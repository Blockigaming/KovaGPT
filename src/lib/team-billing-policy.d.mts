export type TeamSelection = { standard: number; premium: number; interval: "month" | "year" };
export const TEAM_PRICES: Record<string, { key: string; amount: number; interval: string }>;
export function validateTeamSelection(value: unknown): TeamSelection;
export function validateTeamPrice(
  price: unknown,
  definition: { key: string; amount: number; interval: string },
  live?: boolean,
): string;
export function teamCheckoutUrl(value: string): string;
