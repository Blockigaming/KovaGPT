export const SUPPORT_RETRY_STORAGE: string;
export function supportRetryIdentity(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  actor: string | null,
  body: string,
  isCurrent: () => boolean,
  cryptoApi?: Crypto,
  intentionalNewRequest?: boolean,
): Promise<{ requestId: string; persisted: boolean }>;
