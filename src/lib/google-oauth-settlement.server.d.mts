export function createGoogleOAuthSettlement(input: {
  rpc: (
    userId: string | null,
    operation: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  exchange: (code: string, request: Request, verifier: string) => Promise<unknown>;
  refresh?: (token: string) => Promise<unknown>;
  identity: (token: string) => Promise<{ sub: string; email: string }>;
  encrypt: (value: string) => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  fetchImpl?: typeof fetch;
}): {
  finish: (
    userId: string,
    attemptId: string,
    code: string,
    request: Request,
    verifier: string,
  ) => Promise<{ id: string; grantId: string }>;
  cleanup: (options?: { receiptId?: string; limit?: number }) => Promise<{ processed: number }>;
};
