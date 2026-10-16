export const WORK_INSPECTOR_CATEGORIES: readonly string[];
export function classifySpecialistEvents<
  T extends { type: string; payload: { [key: string]: unknown } },
>(events: readonly T[], taskId: string | null): Record<string, T[]>;
