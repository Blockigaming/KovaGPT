import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listNotifications, markNotificationsRead } from "@/lib/notification-center.functions";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  pendingPersistedNotices,
  persistedNoticeKind,
  safePersistedNoticeActionUrl,
} from "@/lib/persisted-notification-policy.mjs";

/**
 * Reuse the existing account-scoped, durable in-app inbox. No interval polling:
 * refresh on initial authenticated mount and returning to the tab.
 * The first two unread recognized events receive a quiet surface while the
 * remaining notifications stay in /notifications. Preference controls and
 * server insertion govern which rows are delivered.
 */
export function PersistedNoticeBridge({ ownerId }: { ownerId: string | null }) {
  const list = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  const seenRef = useRef(new Set<string>());
  const requestRef = useRef({ busy: false, lastReadAt: 0 });

  useEffect(() => {
    seenRef.current.clear();
    requestRef.current = { busy: false, lastReadAt: 0 };
    if (!ownerId) return;
    let cancelled = false;
    const check = async () => {
      const now = Date.now();
      if (requestRef.current.busy || now - requestRef.current.lastReadAt < 15000) return;
      requestRef.current.busy = true;
      requestRef.current.lastReadAt = now;
      try {
        const notices = await list();
        if (cancelled || ownerRef.current !== ownerId) return;
        const eligible = pendingPersistedNotices(notices, seenRef.current, 2);
        for (const notice of eligible) {
          const type = persistedNoticeKind(notice);
          if (!type) continue;
          seenRef.current.add(notice.id);
          const actionUrl = safePersistedNoticeActionUrl(notice.actionUrl);
          publishKovaNotice({
            id: type,
            key: "persisted:" + notice.id,
            title: notice.title,
            message: notice.preview || undefined,
            confirmed: true,
            ...(actionUrl
              ? {
                  primaryLabel: "View",
                  onPrimary: () => { window.location.assign(actionUrl); },
                }
              : {}),
            onDismiss: () => {
              void markRead({ data: { ids: [notice.id], source: notice.source } }).catch(() => {});
            },
          });
        }
      } catch {
        // Inbox pages preserve errors and retries. Do not interrupt another
        // feature with a background notification-read failure.
      } finally {
        requestRef.current.busy = false;
      }
    };
    void check();
    const focus = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [list, markRead, ownerId]);
  return null;
}
