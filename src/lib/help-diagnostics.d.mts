export const HELP_ENVIRONMENTS: readonly { id: string; label: string; step: string }[];
export const HELP_CONNECTIONS: readonly { id: string; label: string; step: string }[];
export const HELP_PLANS: readonly ("free" | "plus" | "pro")[];
export function diagnosticCoverage(answerCount: number): number;
export function contextualHelp(
  faq: { answer: string; category: string },
  setup: { environment: string; connection: string; plan: string },
): string[];
