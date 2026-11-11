export type PersistedNoticeInput={
 id?:string|null;
 type?:string|null;
 title?:string|null;
 preview?:string|null;
 actionUrl?:string|null;
 readAt?:string|null;
 source?:string|null;
};
export declare function persistedNoticeKind(row:PersistedNoticeInput|null|undefined):string|null;
export declare function safePersistedNoticeActionUrl(value:unknown):string|null;
export declare function pendingPersistedNotices(
 rows:unknown,
 seen:ReadonlySet<string>|null|undefined,
 limit?:number
):PersistedNoticeInput[];
