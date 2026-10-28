export function isExplicitWebSearchRequest(value: unknown): boolean;
export function classifySearchProviderError(error: unknown): {
  status: number | null;
  code: string;
};
