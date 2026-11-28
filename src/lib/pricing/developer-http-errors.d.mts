export function developerHttpError(error: unknown): {
  status: number;
  code: string;
  message: string;
};
export function developerRateError(result: unknown): Error | null;
export function developerRetryHeaders(status: number): Record<string, string>;
