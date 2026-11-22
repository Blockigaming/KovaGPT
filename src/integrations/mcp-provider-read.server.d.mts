export function verifyTanaRead(
  token: string,
  fetchImpl?: typeof fetch,
  beforeRequest?: () => Promise<void>,
): Promise<void>;
