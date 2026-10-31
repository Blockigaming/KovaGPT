export function savePlaidLinkSession(
  storage: Pick<Storage, "setItem">,
  owner: string,
  linkToken: string,
  expiration: string,
  now?: number,
): void;
export function readPlaidLinkSession(
  storage: Pick<Storage, "getItem">,
  owner: string,
  now?: number,
): string | null;
export function clearPlaidLinkSession(
  storage: Pick<Storage, "getItem" | "removeItem">,
  owner: string,
): void;
