export declare function notificationDismissalKey(input?: {
  accountId?: string | null;
  id?: string | null;
  campaignId?: string | null;
  group?: string | null;
}): string | null;
export declare function noticeIsDismissed(
  storage: Pick<Storage, "getItem"> | null | undefined,
  details: {
    accountId?: string | null;
    id?: string | null;
    campaignId?: string | null;
    group?: string | null;
  },
): boolean;
export declare function rememberNoticeDismissal(
  storage: Pick<Storage, "setItem"> | null | undefined,
  details: {
    accountId?: string | null;
    id?: string | null;
    campaignId?: string | null;
    group?: string | null;
  },
): boolean;
