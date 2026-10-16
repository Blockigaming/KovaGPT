export function promptEvaluationIdentity(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  actor: string,
  payload: { prompt_id: string; rating: number; notes: string },
  isCurrent: () => boolean,
  intentionalNew?: boolean,
  cryptoApi?: Crypto,
): Promise<string>;
