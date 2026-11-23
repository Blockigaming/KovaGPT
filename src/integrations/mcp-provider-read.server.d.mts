export function verifyTanaRead(
  token: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
): Promise<void>;
export function runReviewedMcpWrite(
  credential: string,
  operation: string,
  text: string,
  beforeRequest: () => Promise<void>,
  transport?: typeof fetch,
): Promise<boolean>;
