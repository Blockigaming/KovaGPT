import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type KovaNotice = {
  id: string;
  title: string;
  message?: string;
  confirmed?: boolean;
  key?: string;
  campaignId?: string;
  anchorSelector?: string;
  primaryLabel?: string;
  onPrimary?: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onDismiss?: () => void;
};

/** Emit only from a verified operation stage; never from a speculative click. */
export function publishKovaNotice(notice: KovaNotice) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kova:notice", { detail: notice }));
  }
}

type NoticeReceiver = (notice: KovaNotice) => void;
export type SubscribeToNotices = (receive: NoticeReceiver) => () => void;
type NotificationController =
  typeof import("./KovaNotificationController").KovaNotificationController;

/** Browser connectivity feedback stays available even before the other notice UI loads. */
export function KovaNotificationSurface({ accountId }: { accountId?: string | null }) {
  const scope = useId();
  const pending = useRef<KovaNotice[]>([]);
  const receive = useRef<NoticeReceiver | null>(null);
  const [Controller, setController] = useState<NotificationController | null>(null);
  const subscribe: SubscribeToNotices = useCallback((listener) => {
    receive.current = listener;
    for (const notice of pending.current.splice(0)) listener(notice);
    return () => {
      if (receive.current === listener) receive.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    let active = true;
    let loading = false;
    const offlineId = scope + ":network-offline";
    const restoredId = scope + ":network-restored";
    const load = () => {
      if (loading || receive.current || !navigator.onLine || pending.current.length === 0) return;
      loading = true;
      void import("./KovaNotificationController")
        .then(({ KovaNotificationController }) => {
          if (active) setController(() => KovaNotificationController);
        })
        .catch(() => {
          loading = false;
          if (active)
            toast.error("Notifications could not load. Reload KovaGPT to try again.", {
              id: scope + ":notification-load-failed",
            });
        });
    };
    const relay = (event: Event) => {
      const notice = (event as CustomEvent<KovaNotice>).detail;
      if (
        !notice ||
        typeof notice.id !== "string" ||
        typeof notice.title !== "string" ||
        !notice.title.trim() ||
        notice.title.length > 160 ||
        (notice.message !== undefined &&
          (typeof notice.message !== "string" || notice.message.length > 2000))
      )
        return;
      if (notice.id === "network_offline") {
        toast.error(notice.title, {
          id: offlineId,
          description: notice.message,
          duration: Infinity,
        });
        return;
      }
      if (notice.id === "network_restored") {
        toast.dismiss(offlineId);
        toast.success(notice.title, {
          id: restoredId,
          description: notice.message,
          duration: 3000,
        });
        return;
      }
      if (receive.current) {
        receive.current(notice);
        return;
      }
      const key = notice.key ?? notice.id;
      if (!pending.current.some((item) => (item.key ?? item.id) === key)) {
        if (pending.current.length === 24) pending.current.shift();
        pending.current.push(notice);
      }
      load();
    };
    window.addEventListener("kova:notice", relay);
    window.addEventListener("online", load);
    const queue = pending.current;
    return () => {
      active = false;
      window.removeEventListener("kova:notice", relay);
      window.removeEventListener("online", load);
      queue.length = 0;
      toast.dismiss(offlineId);
      toast.dismiss(restoredId);
      toast.dismiss(scope + ":notification-load-failed");
    };
  }, [accountId, scope]);
  return Controller ? <Controller accountId={accountId} subscribe={subscribe} /> : null;
}
