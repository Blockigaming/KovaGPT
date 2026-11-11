import { NOTIFICATION_IDS } from "./notification-catalog.mjs";
const CATALOG=new Set(NOTIFICATION_IDS);
const SERVER_KIND_TO_NOTICE={
  task_result:"task_completed",
  task_failure:"task_failed",
};
/**
 * Only server-persisted, unread events map to user-visible notifications.
 * Unknown types stay in the notifications inbox; never invent a generic
 * "success" for an unrecognized provider status.
 */
export function persistedNoticeKind(row){
  if (!row || typeof row!=="object" || row.readAt!==null) return null;
  const raw=typeof row.type==="string" ? row.type : "";
  const mapped=SERVER_KIND_TO_NOTICE[raw]??raw;
  return CATALOG.has(mapped)?mapped:null;
}
/** Keep notification click targets inside this app; never follow untrusted redirects. */
export function safePersistedNoticeActionUrl(value){
  if(typeof value!=="string" || !value.startsWith("/") || value.startsWith("//") ||
    value.length>1000 || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url=new URL(value,"https://kovagpt.com");
    if(url.origin!=="https://kovagpt.com" || !/^\/[a-z0-9_/-]*$/i.test(url.pathname))return null;
    return url.pathname+url.search;
  }catch{return null;}
}
export function pendingPersistedNotices(rows,seen,limit=2){
  if(!Array.isArray(rows))return [];
  const result=[];
  for(const row of rows){
    if(result.length>=limit)break;
    if(typeof row?.id!=="string" || !/^[0-9a-f-]{36}$/i.test(row.id) ||
      seen?.has(row.id) || !persistedNoticeKind(row) ||
      typeof row.title!=="string" || row.title.length>240 ||
      typeof row.preview!=="string" || row.preview.length>2000) continue;
    result.push(row);
  }
  return result;
}
