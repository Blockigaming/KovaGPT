export function readDeviceRecord(
  storage: Pick<Storage, "getItem"> | null,
  base: string,
  actor: string | null | undefined,
  target: string,
): { revision: string | null; value: unknown; deletionEpoch: string | null };
export function saveDeviceRecord(options: {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  locks: LockManager | undefined;
  base: string;
  actor: string | null | undefined;
  target: string;
  expectedRevision: string | null;
  expectedDeletionEpoch?: string | null;
  value: unknown;
  current: () => boolean;
  randomUUID?: () => string;
}): Promise<string>;
