export type PersistedNoticeInput = {
  id?: string | null;
  type?: string | null;
  title?: string | null;
  preview?: string | null;
  actionUrl?: string | null;
  readAt?: string | null;
  source?: string | null;
};
export type EligiblePersistedNotice = {
  id: string;
  type: string;
  title: string;
  preview: string;
  actionUrl: string | null;
  readAt: null;
  source: "application" | "agent";
};
export declare function persistedNoticeKind(
  row: PersistedNoticeInput | null | undefined,
): string | null;
export declare function safePersistedNoticeActionUrl(value: unknown): string | null;
export declare function pendingPersistedNotices(
  rows: unknown,
  seen: ReadonlySet<string> | null | undefined,
  limit?: number,
): EligiblePersistedNotice[];

export declare function notificationSessionSeenKey(ownerId: unknown): string | null;
export declare function readSessionSeen(
  storage: Pick<Storage, "getItem"> | null | undefined,
  ownerId: string | null,
): Set<string>;
export declare function rememberSessionSeen(
  storage: Pick<Storage, "setItem"> | null | undefined,
  ownerId: string | null,
  seen: ReadonlySet<string>,
): boolean;
