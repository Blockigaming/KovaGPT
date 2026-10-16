export const ACADEMY_CATEGORIES: readonly string[];
export function academyCategory(slug: string): string;
export function academyReturnSearch(search: Record<string, unknown>): {
  q: string;
  category: string;
};
export type AcademyProgress = { notes: string; completed: boolean; checked: string[] };
export const EMPTY_ACADEMY_PROGRESS: AcademyProgress;
export function isAcademyProgress(value: unknown): value is AcademyProgress;
