export function librarySaveFingerprint(values: unknown, bytes?: Uint8Array): Promise<string>;
export function assertLibrarySaveReplay(
  row: { id: string; metadata: unknown },
  fingerprint: string,
): { id: string };
