import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listNotifications, markNotificationsRead } from "@/lib/notification-center.functions";
import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import {
  pendingPersistedNotices,
  persistedNoticeKind,
  safePersistedNoticeActionUrl,
  readSessionSeen,
  rememberSessionSeen,
} from "@/lib/persisted-notification-policy.mjs";

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reuse the existing account-scoped, durable in-app inbox. No interval polling:
 * refresh on initial authenticated mount and returning to the tab.
 * The first two unread recognized events receive a quiet surface while the
 * remaining notifications stay in /notifications. Preference controls and
 * server insertion govern which rows are delivered.
 */
export function PersistedNoticeBridge({ ownerId }: { ownerId: string | null }) {
  const navigate = useNavigate();
  const list = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;

  useEffect(() => {
    if (!ownerId) return;
    const seen = readSessionSeen(safeSessionStorage(), ownerId);
    let cancelled = false;
    let busy = false;
    let lastReadAt = 0;
    const isCurrent = () => !cancelled && ownerRef.current === ownerId;
    const check = async () => {
      const now = Date.now();
      if (!isCurrent() || busy || now - lastReadAt < 15000) return;
      busy = true;
      lastReadAt = now;
      try {
        const notices = await list({ data: { expectedOwnerId: ownerId } });
        if (!isCurrent()) return;
        const eligible = pendingPersistedNotices(notices, seen, 2);
        for (const notice of eligible) {
          const type = persistedNoticeKind(notice);
          if (!type) continue;
          seen.add(notice.id);
          rememberSessionSeen(safeSessionStorage(), ownerId, seen);
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
                  onPrimary: () => {
                    if (isCurrent()) void navigate({ href: actionUrl });
                  },
                }
              : {}),
            onDismiss: () => {
              if (!isCurrent()) return;
              void markRead({
                data: { ids: [notice.id], source: notice.source, expectedOwnerId: ownerId },
              }).catch(() => {});
            },
          });
        }
      } catch {
        // Inbox pages preserve errors and retries. Do not interrupt another
        // feature with a background notification-read failure.
      } finally {
        busy = false;
      }
    };
    void check();
    const focus = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [list, markRead, navigate, ownerId]);
  return null;
}
